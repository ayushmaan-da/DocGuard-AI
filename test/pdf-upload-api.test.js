import assert from 'node:assert/strict';
import { request as createRequest } from 'node:http';
import test from 'node:test';
import { createApp } from '../src/app.js';
import { getPdfLimits } from '../src/services/pdf-document-service.js';
import { uploadPdfDocuments } from '../src/services/pdf-upload-service.js';
import { getPdfUploadLimits } from '../src/utils/read-multipart-pdfs.js';
import { createPdf } from '../test-fixtures/pdf-fixture.js';

async function startTestServer(testContext, options = {}) {
  const server = createApp(options);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  testContext.after(async () => {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  });
  return server.address().port;
}

function createMultipart(files, { boundary = 'docguard-test-boundary' } = {}) {
  const chunks = [];
  for (const file of files) {
    chunks.push(Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="${file.fieldName ?? 'documents'}"; filename="${file.filename}"\r\nContent-Type: ${file.mimeType ?? 'application/pdf'}\r\n\r\n`,
    ));
    chunks.push(file.bytes);
    chunks.push(Buffer.from('\r\n'));
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`));
  return {
    boundary,
    body: Buffer.concat(chunks),
  };
}

function sendRawRequest(port, path, { method = 'POST', body, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const request = createRequest({
      hostname: '127.0.0.1',
      port,
      path,
      method,
      headers,
    }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
      response.on('end', () => resolve({
        statusCode: response.statusCode,
        headers: response.headers,
        body: Buffer.concat(chunks),
      }));
    });
    request.on('error', reject);
    request.end(body);
  });
}

function createUploadOptions({
  maxFileBytes,
  maxPages,
  maxAggregateTextCharacters,
  maxFiles,
  maxRequestBytes,
} = {}) {
  const limits = {
    ...getPdfLimits(),
    ...(maxFileBytes ? { maxFileBytes } : {}),
    ...(maxPages ? { maxPages } : {}),
    ...(maxAggregateTextCharacters ? { maxAggregateTextCharacters } : {}),
  };
  const uploadLimits = {
    ...getPdfUploadLimits(),
    ...(maxFiles ? { maxFiles } : {}),
    ...(maxRequestBytes ? { maxRequestBytes } : {}),
  };
  return {
    processPdfUpload: (request) => uploadPdfDocuments(request, { limits, uploadLimits }),
  };
}

async function postDocuments(port, files) {
  const { boundary, body } = createMultipart(files);
  return sendRawRequest(port, '/api/projects/documents', {
    headers: {
      'Content-Type': `multipart/form-data; boundary=${boundary}`,
      'Content-Length': body.length,
    },
    body,
  });
}

test('uploads multiple PDFs, extracts text, and keeps original bytes retrievable by temporary reference', async (testContext) => {
  const port = await startTestServer(testContext);
  const originalPdfs = [
    { filename: 'guide.pdf', bytes: createPdf(['Page one', 'Page two']) },
    { filename: 'reference.PDF', bytes: createPdf(['Another guide']) },
  ];
  const response = await postDocuments(port, originalPdfs);

  assert.equal(response.statusCode, 201);
  assert.match(response.headers['content-type'], /application\/json/);
  const result = JSON.parse(response.body.toString('utf8'));
  assert.equal(result.documentation.length, 2);
  assert.equal(result.documentation[0].filename, originalPdfs[0].filename);
  assert.equal(result.documentation[0].source, 'uploaded');
  assert.deepEqual(result.documentation[0].pages, [
    { pageNumber: 1, text: 'Page one' },
    { pageNumber: 2, text: 'Page two' },
  ]);
  assert.equal(result.documentation[1].filename, originalPdfs[1].filename);
  assert.equal(result.documentation[0].originalFormat, 'application/pdf');
  assert.equal(result.documentation[0].format, 'text/plain');
  assert.equal(result.documentation[0].original.sizeBytes, originalPdfs[0].bytes.length);
  assert.equal(response.body.includes(originalPdfs[0].bytes), false);

  for (let index = 0; index < result.documentation.length; index += 1) {
    const download = await sendRawRequest(port, result.documentation[index].original.downloadUrl, { method: 'GET' });
    assert.equal(download.statusCode, 200);
    assert.equal(download.headers['content-type'], 'application/pdf');
    assert.equal(download.headers['content-disposition'].includes(encodeURIComponent(originalPdfs[index].filename)), true);
    assert.deepEqual(download.body, originalPdfs[index].bytes);
  }
});

test('rejects invalid signatures, malformed structures, empty files, and encrypted PDFs', async (testContext) => {
  const port = await startTestServer(testContext);
  const cases = [
    [Buffer.from('not a PDF'), 'INVALID_PDF'],
    [Buffer.from('%PDF-1.4\ncorrupt\n%%EOF'), 'PDF_EXTRACTION_FAILED'],
    [Buffer.alloc(0), 'PDF_EMPTY'],
    [createPdf(['secret'], { encrypted: true }), 'PDF_ENCRYPTED'],
  ];

  for (const [bytes, expectedCode] of cases) {
    const response = await postDocuments(port, [{ filename: 'invalid.pdf', bytes }]);
    const expectedStatus = {
      INVALID_PDF: 415,
      PDF_EMPTY: 400,
      PDF_EXTRACTION_FAILED: 422,
      PDF_ENCRYPTED: 422,
    }[expectedCode];
    assert.equal(response.statusCode, expectedStatus);
    assert.equal(JSON.parse(response.body.toString('utf8')).error.code, expectedCode);
  }
});

test('rejects fake PDF extensions, incorrect MIME types, and malicious filenames', async (testContext) => {
  const port = await startTestServer(testContext);
  for (const file of [
    { filename: 'guide.txt', bytes: createPdf() },
    { filename: 'guide.pdf', mimeType: 'text/plain', bytes: createPdf() },
    { filename: '../escape.pdf', bytes: createPdf() },
    { filename: 'folder\\escape.pdf', bytes: createPdf() },
  ]) {
    const response = await postDocuments(port, [file]);
    assert.ok(response.statusCode >= 400);
    assert.match(JSON.parse(response.body.toString('utf8')).error.code, /PDF|MULTIPART/);
  }
});

test('rejects oversized uploads and page counts with structured errors', async (testContext) => {
  const tooLargePort = await startTestServer(testContext, createUploadOptions({ maxFileBytes: 100 }));
  const tooLarge = await postDocuments(tooLargePort, [{ filename: 'large.pdf', bytes: createPdf() }]);
  assert.equal(tooLarge.statusCode, 413);
  assert.equal(JSON.parse(tooLarge.body.toString('utf8')).error.code, 'PDF_FILE_TOO_LARGE');

  const pageLimitPort = await startTestServer(testContext, createUploadOptions({ maxPages: 1 }));
  const tooManyPages = await postDocuments(pageLimitPort, [{
    filename: 'pages.pdf',
    bytes: createPdf(['one', 'two']),
  }]);
  assert.equal(tooManyPages.statusCode, 413);
  assert.equal(JSON.parse(tooManyPages.body.toString('utf8')).error.code, 'PDF_PAGE_LIMIT_EXCEEDED');
});

test('enforces total request size and upload-count limits', async (testContext) => {
  const sizePort = await startTestServer(testContext, createUploadOptions({ maxRequestBytes: 100 }));
  const overRequestLimit = await postDocuments(sizePort, [{ filename: 'large.pdf', bytes: createPdf() }]);
  assert.equal(overRequestLimit.statusCode, 413);
  assert.equal(JSON.parse(overRequestLimit.body.toString('utf8')).error.code, 'PDF_REQUEST_TOO_LARGE');

  const countPort = await startTestServer(testContext, createUploadOptions({ maxFiles: 1 }));
  const tooManyFiles = await postDocuments(countPort, [
    { filename: 'one.pdf', bytes: createPdf(['one']) },
    { filename: 'two.pdf', bytes: createPdf(['two']) },
  ]);
  assert.equal(tooManyFiles.statusCode, 413);
  assert.equal(JSON.parse(tooManyFiles.body.toString('utf8')).error.code, 'PDF_FILE_COUNT_EXCEEDED');
});

test('enforces the aggregate extracted-text limit across an upload', async (testContext) => {
  const port = await startTestServer(testContext, createUploadOptions({ maxAggregateTextCharacters: 10 }));
  const response = await postDocuments(port, [{ filename: 'text.pdf', bytes: createPdf(['extracted text']) }]);
  assert.equal(response.statusCode, 413);
  assert.equal(JSON.parse(response.body.toString('utf8')).error.code, 'PDF_AGGREGATE_TEXT_LIMIT_EXCEEDED');
});

test('rejects unsupported request media types and missing PDF files', async (testContext) => {
  const port = await startTestServer(testContext);
  const unsupported = await sendRawRequest(port, '/api/projects/documents', {
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  });
  assert.equal(unsupported.statusCode, 415);

  const { boundary, body } = createMultipart([]);
  const empty = await sendRawRequest(port, '/api/projects/documents', {
    headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` },
    body,
  });
  assert.equal(empty.statusCode, 400);
  assert.equal(JSON.parse(empty.body.toString('utf8')).error.code, 'PDF_REQUIRED');

  const malformed = await sendRawRequest(port, '/api/projects/documents', {
    headers: { 'Content-Type': 'multipart/form-data; boundary=missing-boundary' },
    body: Buffer.from('not a multipart body'),
  });
  assert.equal(malformed.statusCode, 400);
  assert.equal(JSON.parse(malformed.body.toString('utf8')).error.code, 'INVALID_MULTIPART');
});

test('rejects duplicate document filenames', async (testContext) => {
  const port = await startTestServer(testContext);
  const response = await postDocuments(port, [
    { filename: 'guide.pdf', bytes: createPdf(['one']) },
    { filename: 'GUIDE.pdf', bytes: createPdf(['two']) },
  ]);
  assert.equal(response.statusCode, 400);
  assert.equal(JSON.parse(response.body.toString('utf8')).error.code, 'DUPLICATE_PDF_FILENAME');
});
