import assert from 'node:assert/strict';
import test from 'node:test';
import {
  extractPdfDocument,
  getOriginalPdf,
  getPdfLimits,
  storePdfDocuments,
} from '../src/services/pdf-document-service.js';
import { createPdf } from '../test-fixtures/pdf-fixture.js';

test('extracts readable text while preserving page numbers and page boundaries', async () => {
  const bytes = createPdf(['First page text', 'Second page text']);
  const result = await extractPdfDocument(bytes, {
    filename: 'guide.pdf',
    source: 'uploaded',
  });

  assert.equal(result.bytes, bytes);
  assert.equal(result.document.filename, 'guide.pdf');
  assert.equal(result.document.source, 'uploaded');
  assert.equal(result.document.originalFormat, 'application/pdf');
  assert.equal(result.document.format, 'text/plain');
  assert.equal(result.document.extractionStatus, 'success');
  assert.deepEqual(result.document.pages, [
    { pageNumber: 1, text: 'First page text' },
    { pageNumber: 2, text: 'Second page text' },
  ]);
  assert.equal(result.document.extractedText, '--- Page 1 ---\nFirst page text\n\n--- Page 2 ---\nSecond page text');
  assert.deepEqual(result.document.warnings, []);
});

test('marks scanned pages without selectable text as requiring OCR', async () => {
  const result = await extractPdfDocument(createPdf(['']), {
    filename: 'scan.pdf',
    source: 'github',
  });

  assert.equal(result.document.extractionStatus, 'requires_ocr');
  assert.deepEqual(result.document.pages, [{ pageNumber: 1, text: '' }]);
  assert.equal(result.document.warnings[0].code, 'PDF_OCR_REQUIRED');
  assert.equal(result.document.extractedText, '--- Page 1 ---\n');
});

test('rejects invalid signatures, malformed structures, empty files, and encrypted PDFs', async () => {
  const invalidFiles = [
    [Buffer.alloc(0), 'PDF_EMPTY'],
    [Buffer.from('not a pdf'), 'INVALID_PDF'],
    [Buffer.from('%PDF-1.4\nnot a valid structure\n%%EOF'), 'PDF_EXTRACTION_FAILED'],
    [createPdf(['secret'], { encrypted: true }), 'PDF_ENCRYPTED'],
  ];

  for (const [bytes, expectedCode] of invalidFiles) {
    await assert.rejects(
      extractPdfDocument(bytes, { filename: 'invalid.pdf', source: 'uploaded' }),
      (error) => error.code === expectedCode,
    );
  }
});

test('enforces input byte and page-count limits', async () => {
  const bytes = createPdf(['one', 'two']);
  await assert.rejects(
    extractPdfDocument(bytes, {
      filename: 'large.pdf',
      source: 'uploaded',
      maxFileBytes: bytes.length - 1,
    }),
    (error) => error.code === 'PDF_FILE_TOO_LARGE',
  );
  await assert.rejects(
    extractPdfDocument(bytes, {
      filename: 'many-pages.pdf',
      source: 'uploaded',
      maxPages: 1,
    }),
    (error) => error.code === 'PDF_PAGE_LIMIT_EXCEEDED',
  );
  await assert.rejects(
    extractPdfDocument(createPdf(['text exceeds cap']), {
      filename: 'large-text.pdf',
      source: 'uploaded',
      maxExtractedTextCharacters: 4,
    }),
    (error) => error.code === 'PDF_TEXT_LIMIT_EXCEEDED',
  );
  await assert.rejects(
    extractPdfDocument(createPdf([]), { filename: 'empty-pages.pdf', source: 'uploaded' }),
    (error) => error.code === 'PDF_EMPTY',
  );
});

test('reports extraction timeouts explicitly', async () => {
  let destroyed = false;
  await assert.rejects(
    extractPdfDocument(createPdf(['timeout test']), {
      filename: 'timeout.pdf',
      source: 'uploaded',
      extractionTimeoutMs: 5,
      getDocumentImpl: () => ({
        promise: new Promise(() => {}),
        destroy: async () => {
          destroyed = true;
        },
      }),
    }),
    (error) => error.code === 'PDF_EXTRACTION_TIMEOUT',
  );
  assert.equal(destroyed, true);
});

test('preserves originals within configured temporary storage limits and expires references', async () => {
  const bytes = createPdf(['temporary original']);
  const pending = await extractPdfDocument(bytes, { filename: 'temporary.pdf', source: 'uploaded' });
  const limits = getPdfLimits();
  assert.throws(
    () => storePdfDocuments([pending], {
      limits: { ...limits, maxStoredBytes: bytes.length - 1 },
    }),
    (error) => error.code === 'PDF_ORIGINAL_STORE_FULL',
  );
  assert.throws(
    () => storePdfDocuments([pending], {
      limits: { ...limits, maxStoredTextCharacters: 1 },
    }),
    (error) => error.code === 'PDF_ORIGINAL_STORE_FULL',
  );
});

test('removes expired original PDF references', async () => {
  const pending = await extractPdfDocument(createPdf(['expires']), {
    filename: 'expires.pdf',
    source: 'uploaded',
  });
  const [stored] = storePdfDocuments([pending], {
    limits: { ...getPdfLimits(), referenceTtlMs: 1 },
    now: Date.now() - 10,
  });
  assert.throws(
    () => getOriginalPdf(stored.original.referenceId),
    (error) => error.code === 'PDF_REFERENCE_EXPIRED',
  );
});
