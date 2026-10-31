import Busboy from 'busboy';
import { HttpError } from './http-error.js';

const DEFAULT_UPLOAD_LIMITS = {
  maxFiles: 5,
  maxRequestBytes: 20 * 1024 * 1024,
};

function readLimit(environmentName, defaultValue) {
  const value = process.env[environmentName];
  if (value === undefined || value === '') {
    return defaultValue;
  }

  const parsedValue = Number(value);
  if (!Number.isSafeInteger(parsedValue) || parsedValue < 1) {
    throw new Error(`${environmentName} must be a positive safe integer.`);
  }
  return parsedValue;
}

export function getPdfUploadLimits() {
  return {
    maxFiles: readLimit('PDF_MAX_UPLOAD_FILES', DEFAULT_UPLOAD_LIMITS.maxFiles),
    maxRequestBytes: readLimit('PDF_MAX_REQUEST_BYTES', DEFAULT_UPLOAD_LIMITS.maxRequestBytes),
  };
}

function validateFilename(filename) {
  return typeof filename === 'string'
    && filename.length > 0
    && Buffer.byteLength(filename, 'utf8') <= 255
    && filename !== '.'
    && filename !== '..'
    && !/[\/\\\u0000-\u001f\u007f]/u.test(filename)
    && filename.toLowerCase().endsWith('.pdf');
}

export function readMultipartPdfs(request, {
  maxFiles = getPdfUploadLimits().maxFiles,
  maxRequestBytes = getPdfUploadLimits().maxRequestBytes,
  maxFileBytes,
} = {}) {
  const contentType = request.headers['content-type'] ?? '';
  if (!/^multipart\/form-data\s*;/i.test(contentType)) {
    request.resume();
    return Promise.reject(new HttpError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Content-Type must be multipart/form-data.'));
  }

  const contentLength = Number(request.headers['content-length']);
  if (Number.isFinite(contentLength) && contentLength > maxRequestBytes) {
    request.resume();
    return Promise.reject(new HttpError(413, 'PDF_REQUEST_TOO_LARGE', 'The PDF upload request exceeds the configured request-size limit.'));
  }

  let parser;
  try {
    parser = Busboy({
      headers: request.headers,
      preservePath: true,
      limits: {
        files: maxFiles,
        fileSize: maxFileBytes,
        fields: 0,
        parts: maxFiles,
      },
    });
  } catch {
    request.resume();
    return Promise.reject(new HttpError(400, 'INVALID_MULTIPART', 'The multipart request is malformed or has no valid boundary.'));
  }

  return new Promise((resolve, reject) => {
    const records = [];
    const names = new Set();
    let firstError;
    let totalBytes = 0;
    let requestTooLarge = false;

    function setError(error) {
      firstError ??= error;
    }

    function countRequestBytes(chunk) {
      totalBytes += chunk.length;
      if (totalBytes > maxRequestBytes && !requestTooLarge) {
        requestTooLarge = true;
        setError(new HttpError(413, 'PDF_REQUEST_TOO_LARGE', 'The PDF upload request exceeds the configured request-size limit.'));
        for (const record of records) {
          record.chunks.length = 0;
        }
      }
    }
    request.on('data', countRequestBytes);

    parser.on('file', (fieldName, stream, info) => {
      const { filename, mimeType } = info;
      const normalizedName = typeof filename === 'string' ? filename.toLowerCase() : '';
      let accepted = true;

      if (fieldName !== 'documents') {
        setError(new HttpError(400, 'INVALID_MULTIPART_FIELD', 'PDF files must use the "documents" multipart field.'));
        accepted = false;
      } else if (!validateFilename(filename)) {
        setError(new HttpError(400, 'INVALID_PDF_FILENAME', 'PDF filenames must be plain filenames ending in .pdf, without path separators or control characters.'));
        accepted = false;
      } else if (mimeType.toLowerCase() !== 'application/pdf') {
        setError(new HttpError(415, 'INVALID_PDF_MEDIA_TYPE', `File "${filename}" must have Content-Type application/pdf.`));
        accepted = false;
      } else if (names.has(normalizedName)) {
        setError(new HttpError(400, 'DUPLICATE_PDF_FILENAME', `The upload contains duplicate filename "${filename}".`));
        accepted = false;
      } else {
        names.add(normalizedName);
      }

      const record = { filename, chunks: [], size: 0, accepted };
      records.push(record);
      stream.on('limit', () => {
        setError(new HttpError(413, 'PDF_FILE_TOO_LARGE', `File "${filename}" exceeds the configured PDF file-size limit.`));
        record.chunks.length = 0;
        record.accepted = false;
      });
      stream.on('data', (chunk) => {
        if (!record.accepted || requestTooLarge) {
          return;
        }
        record.size += chunk.length;
        record.chunks.push(Buffer.from(chunk));
      });
      stream.on('error', () => {
        setError(new HttpError(400, 'INVALID_MULTIPART', 'Could not read the complete PDF upload.'));
      });
    });

    parser.on('field', () => {
      setError(new HttpError(400, 'INVALID_MULTIPART_FIELD', 'Only PDF files in the "documents" field are accepted.'));
    });
    parser.on('fieldsLimit', () => {
      setError(new HttpError(400, 'INVALID_MULTIPART_FIELD', 'Only PDF files in the "documents" field are accepted.'));
    });
    parser.on('filesLimit', () => {
      setError(new HttpError(413, 'PDF_FILE_COUNT_EXCEEDED', `The upload exceeds the supported ${maxFiles} PDF files.`));
    });
    parser.on('partsLimit', () => {
      setError(new HttpError(413, 'PDF_FILE_COUNT_EXCEEDED', `The upload exceeds the supported ${maxFiles} PDF files.`));
    });
    parser.on('error', () => {
      setError(new HttpError(400, 'INVALID_MULTIPART', 'The multipart request could not be parsed.'));
    });
    parser.on('close', () => {
      request.off('data', countRequestBytes);
      request.off('aborted', handleAborted);
      request.off('error', handleRequestError);
      if (firstError) {
        reject(firstError);
        return;
      }
      if (records.length === 0) {
        reject(new HttpError(400, 'PDF_REQUIRED', 'Upload at least one PDF using the "documents" field.'));
        return;
      }
      resolve(records.map(({ filename, chunks, size }) => ({
        filename,
        bytes: Buffer.concat(chunks, size),
      })));
    });

    function handleAborted() {
      setError(new HttpError(400, 'INVALID_REQUEST_BODY', 'The PDF upload was interrupted.'));
      parser.destroy();
    }
    function handleRequestError() {
      setError(new HttpError(400, 'INVALID_REQUEST_BODY', 'Could not read the complete PDF upload.'));
      parser.destroy();
    }
    request.on('aborted', handleAborted);
    request.once('error', handleRequestError);
    request.pipe(parser);
  });
}
