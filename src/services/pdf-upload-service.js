import { extractPdfDocument, getPdfLimits, storePdfDocuments } from './pdf-document-service.js';
import { readMultipartPdfs, getPdfUploadLimits } from '../utils/read-multipart-pdfs.js';
import { HttpError } from '../utils/http-error.js';

export async function uploadPdfDocuments(request, {
  limits = getPdfLimits(),
  uploadLimits = getPdfUploadLimits(),
} = {}) {
  const uploadedFiles = await readMultipartPdfs(request, {
    ...uploadLimits,
    maxFileBytes: limits.maxFileBytes,
  });
  const pendingDocuments = [];
  let aggregateTextCharacters = 0;

  for (const file of uploadedFiles) {
    const extracted = await extractPdfDocument(file.bytes, {
      filename: file.filename,
      source: 'uploaded',
      maxFileBytes: limits.maxFileBytes,
      maxPages: limits.maxPages,
      extractionTimeoutMs: limits.extractionTimeoutMs,
      maxExtractedTextCharacters: limits.maxExtractedTextCharacters,
    });
    aggregateTextCharacters += extracted.document.extractedText.length;
    if (aggregateTextCharacters > limits.maxAggregateTextCharacters) {
      throw new HttpError(413, 'PDF_AGGREGATE_TEXT_LIMIT_EXCEEDED', 'The uploaded PDFs contain more extracted text than the configured combined limit.');
    }
    pendingDocuments.push(extracted);
  }

  const documentation = storePdfDocuments(pendingDocuments, { limits });
  return {
    documentation,
    warnings: documentation.flatMap((document) => document.warnings),
  };
}
