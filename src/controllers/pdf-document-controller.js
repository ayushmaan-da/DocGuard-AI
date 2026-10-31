import { uploadPdfDocuments } from '../services/pdf-upload-service.js';
import { getOriginalPdf } from '../services/pdf-document-service.js';
import { HttpError } from '../utils/http-error.js';
import { sendJson } from '../utils/http-response.js';

export async function uploadPdfDocumentation(request, response, processUpload = uploadPdfDocuments) {
  const result = await processUpload(request);
  sendJson(response, 201, result);
}

export function downloadOriginalPdf(request, response, referenceId, getPdf = getOriginalPdf) {
  const { bytes, filename } = getPdf(referenceId);
  if (!Buffer.isBuffer(bytes)) {
    throw new HttpError(500, 'PDF_STORAGE_ERROR', 'The original PDF is unavailable.');
  }

  const encodedFilename = encodeURIComponent(filename).replace(/['()*]/g, (character) => (
    `%${character.charCodeAt(0).toString(16).toUpperCase()}`
  ));
  response.writeHead(200, {
    'Content-Type': 'application/pdf',
    'Content-Length': bytes.length,
    'Content-Disposition': `attachment; filename*=UTF-8''${encodedFilename}`,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  response.end(bytes);
}
