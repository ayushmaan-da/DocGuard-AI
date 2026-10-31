import { createHash, randomUUID } from 'node:crypto';
import { getDocument, VerbosityLevel } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { HttpError } from '../utils/http-error.js';

const DEFAULT_LIMITS = {
  maxFileBytes: 10 * 1024 * 1024,
  maxPages: 500,
  extractionTimeoutMs: 10_000,
  maxExtractedTextCharacters: 2 * 1024 * 1024,
  maxAggregateTextCharacters: 10 * 1024 * 1024,
  maxStoredBytes: 50 * 1024 * 1024,
  maxStoredDocuments: 100,
  maxStoredTextCharacters: 20 * 1024 * 1024,
  referenceTtlMs: 15 * 60 * 1000,
};
const PDF_REFERENCES = new Map();
let storedBytes = 0;
let storedTextCharacters = 0;

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

export function getPdfLimits() {
  return {
    maxFileBytes: readLimit('PDF_MAX_FILE_BYTES', DEFAULT_LIMITS.maxFileBytes),
    maxPages: readLimit('PDF_MAX_PAGES', DEFAULT_LIMITS.maxPages),
    extractionTimeoutMs: readLimit('PDF_EXTRACTION_TIMEOUT_MS', DEFAULT_LIMITS.extractionTimeoutMs),
    maxExtractedTextCharacters: readLimit(
      'PDF_MAX_EXTRACTED_TEXT_CHARACTERS',
      DEFAULT_LIMITS.maxExtractedTextCharacters,
    ),
    maxAggregateTextCharacters: readLimit(
      'PDF_MAX_AGGREGATE_TEXT_CHARACTERS',
      DEFAULT_LIMITS.maxAggregateTextCharacters,
    ),
    maxStoredBytes: readLimit('PDF_MAX_STORED_BYTES', DEFAULT_LIMITS.maxStoredBytes),
    maxStoredDocuments: readLimit('PDF_MAX_STORED_DOCUMENTS', DEFAULT_LIMITS.maxStoredDocuments),
    maxStoredTextCharacters: readLimit(
      'PDF_MAX_STORED_TEXT_CHARACTERS',
      DEFAULT_LIMITS.maxStoredTextCharacters,
    ),
    referenceTtlMs: readLimit('PDF_REFERENCE_TTL_MS', DEFAULT_LIMITS.referenceTtlMs),
  };
}

function getDocumentTextCharacters(document) {
  return document.extractedText.length
    + document.pages.reduce((total, page) => total + page.text.length, 0);
}

function hasPdfStructure(bytes) {
  const header = bytes.subarray(0, Math.min(bytes.length, 1024)).toString('latin1');
  const footer = bytes.subarray(Math.max(0, bytes.length - 1024)).toString('latin1');
  return /%PDF-\d\.\d/.test(header) && footer.includes('%%EOF');
}

function getPageText(textContent) {
  let text = '';
  const items = textContent.items.filter((item) => typeof item.str === 'string');
  for (const [index, item] of items.entries()) {
    text += item.str;
    if (item.hasEOL) {
      text += '\n';
    } else if (index < items.length - 1) {
      text += ' ';
    }
  }
  return text;
}

function createPdfError(error) {
  if (error?.name === 'PasswordException' || error?.name === 'PDFPasswordException') {
    return new HttpError(422, 'PDF_ENCRYPTED', 'The PDF is encrypted or password-protected.');
  }
  return new HttpError(422, 'PDF_EXTRACTION_FAILED', 'The PDF is malformed or its text could not be extracted.');
}

export async function extractPdfDocument(bytes, {
  filename,
  source,
  path,
  maxFileBytes = getPdfLimits().maxFileBytes,
  maxPages = getPdfLimits().maxPages,
  extractionTimeoutMs = getPdfLimits().extractionTimeoutMs,
  maxExtractedTextCharacters = getPdfLimits().maxExtractedTextCharacters,
  getDocumentImpl = getDocument,
} = {}) {
  if (!Buffer.isBuffer(bytes)) {
    throw new TypeError('PDF content must be provided as a Buffer.');
  }
  if (bytes.length === 0) {
    throw new HttpError(400, 'PDF_EMPTY', 'The uploaded PDF is empty.');
  }
  if (bytes.length > maxFileBytes) {
    throw new HttpError(413, 'PDF_FILE_TOO_LARGE', 'The PDF exceeds the configured file-size limit.');
  }
  if (!hasPdfStructure(bytes)) {
    throw new HttpError(415, 'INVALID_PDF', 'The file does not have a valid PDF signature and end marker.');
  }

  let loadingTask;
  let timeout;
  let timedOut = false;
  try {
    loadingTask = getDocumentImpl({
      data: new Uint8Array(bytes),
      disableFontFace: true,
      isEvalSupported: false,
      stopAtErrors: true,
      useSystemFonts: false,
      verbosity: VerbosityLevel.ERRORS,
    });

    const extraction = async () => {
      const pdf = await loadingTask.promise;
      if (pdf.numPages < 1) {
        throw new HttpError(400, 'PDF_EMPTY', 'The PDF does not contain any pages.');
      }
      if (pdf.numPages > maxPages) {
        throw new HttpError(413, 'PDF_PAGE_LIMIT_EXCEEDED', `The PDF contains more than the supported ${maxPages} pages.`);
      }

      const pages = [];
      let extractedTextCharacters = 0;
      for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
        const page = await pdf.getPage(pageNumber);
        const textContent = await page.getTextContent();
        const text = getPageText(textContent);
        extractedTextCharacters += text.length;
        if (extractedTextCharacters > maxExtractedTextCharacters) {
          throw new HttpError(413, 'PDF_TEXT_LIMIT_EXCEEDED', 'The PDF contains more extracted text than the configured limit.');
        }
        pages.push({ pageNumber, text });
        page.cleanup();
      }

      const containsText = pages.some((page) => page.text.trim().length > 0);
      const extractionStatus = containsText ? 'success' : 'requires_ocr';
      const warnings = containsText
        ? []
        : [{
          code: 'PDF_OCR_REQUIRED',
          message: 'No selectable text was found. The original PDF is preserved, but OCR is required to read scanned pages.',
        }];

      return {
        ...(path ? { path } : {}),
        filename,
        source,
        format: 'text/plain',
        originalFormat: 'application/pdf',
        extractedText: pages.map((page) => `--- Page ${page.pageNumber} ---\n${page.text}`).join('\n\n'),
        pages,
        extractionStatus,
        warnings,
        original: {
          sizeBytes: bytes.length,
          sha256: createHash('sha256').update(bytes).digest('hex'),
        },
      };
    };

    const timedExtraction = new Promise((resolve, reject) => {
      timeout = setTimeout(() => {
        timedOut = true;
        void loadingTask.destroy().catch(() => {});
        reject(new HttpError(504, 'PDF_EXTRACTION_TIMEOUT', 'PDF text extraction exceeded the configured time limit.'));
      }, extractionTimeoutMs);
    });
    const document = await Promise.race([extraction(), timedExtraction]);
    return { document, bytes };
  } catch (error) {
    if (error instanceof HttpError) {
      throw error;
    }
    if (timedOut) {
      throw new HttpError(504, 'PDF_EXTRACTION_TIMEOUT', 'PDF text extraction exceeded the configured time limit.');
    }
    throw createPdfError(error);
  } finally {
    clearTimeout(timeout);
    if (loadingTask) {
      await loadingTask.destroy().catch(() => {});
    }
  }
}

function removeExpiredReferences(now = Date.now()) {
  for (const [id, record] of PDF_REFERENCES) {
    if (record.expiresAt <= now) {
      storedBytes -= record.bytes.length;
      storedTextCharacters -= record.textCharacters;
      PDF_REFERENCES.delete(id);
    }
  }
}

const referenceCleanupTimer = setInterval(removeExpiredReferences, 60_000);
referenceCleanupTimer.unref();

export function storePdfDocuments(pendingDocuments, {
  limits = getPdfLimits(),
  now = Date.now(),
} = {}) {
  removeExpiredReferences(now);
  const addedBytes = pendingDocuments.reduce((total, item) => total + item.bytes.length, 0);
  const addedTextCharacters = pendingDocuments.reduce(
    (total, item) => total + getDocumentTextCharacters(item.document),
    0,
  );
  if (PDF_REFERENCES.size + pendingDocuments.length > limits.maxStoredDocuments
    || storedBytes + addedBytes > limits.maxStoredBytes
    || storedTextCharacters + addedTextCharacters > limits.maxStoredTextCharacters) {
    throw new HttpError(503, 'PDF_ORIGINAL_STORE_FULL', 'The temporary PDF preservation limit has been reached. Try again after existing references expire.');
  }

  return pendingDocuments.map(({ bytes, document }) => {
    const referenceId = randomUUID();
    const original = {
      ...document.original,
      referenceId,
      downloadUrl: `/api/documents/${referenceId}/original`,
      expiresAt: new Date(now + limits.referenceTtlMs).toISOString(),
    };
    const publicDocument = { ...document, original };
    PDF_REFERENCES.set(referenceId, {
      bytes: Buffer.from(bytes),
      document: publicDocument,
      expiresAt: now + limits.referenceTtlMs,
      textCharacters: getDocumentTextCharacters(document),
    });
    storedBytes += bytes.length;
    storedTextCharacters += getDocumentTextCharacters(document);
    return publicDocument;
  });
}

export function getStoredPdfDocument(referenceId) {
  removeExpiredReferences();
  const record = PDF_REFERENCES.get(referenceId);
  if (!record) {
    throw new HttpError(410, 'PDF_REFERENCE_EXPIRED', 'The PDF reference is invalid or has expired.');
  }
  return record.document;
}

export function getOriginalPdf(referenceId) {
  removeExpiredReferences();
  const record = PDF_REFERENCES.get(referenceId);
  if (!record) {
    throw new HttpError(410, 'PDF_REFERENCE_EXPIRED', 'The PDF reference is invalid or has expired.');
  }
  return {
    bytes: Buffer.from(record.bytes),
    filename: record.document.filename,
  };
}

export function getStoredUploadedPdfDocuments(referenceIds) {
  if (referenceIds === undefined) {
    return [];
  }
  if (!Array.isArray(referenceIds) || referenceIds.some((id) => typeof id !== 'string')) {
    throw new HttpError(400, 'INVALID_PDF_REFERENCES', 'uploadedDocumentIds must be an array of PDF reference IDs.');
  }
  if (new Set(referenceIds).size !== referenceIds.length) {
    throw new HttpError(400, 'DUPLICATE_PDF_REFERENCE', 'uploadedDocumentIds must not contain duplicate references.');
  }

  return referenceIds.map((id) => {
    const document = getStoredPdfDocument(id);
    if (document.source !== 'uploaded') {
      throw new HttpError(400, 'INVALID_PDF_REFERENCE', 'Only separately uploaded PDF references can be attached to a repository.');
    }
    return document;
  });
}
