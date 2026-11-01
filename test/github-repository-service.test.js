import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { ingestGitHubRepository } from '../src/services/github-repository-service.js';
import { HttpError } from '../src/utils/http-error.js';
import {
  extractPdfDocument,
  getOriginalPdf,
  storePdfDocuments,
} from '../src/services/pdf-document-service.js';
import { createPdf } from '../test-fixtures/pdf-fixture.js';

const COMMIT_SHA = 'a'.repeat(40);
const TREE_SHA = 'b'.repeat(40);

function jsonResponse(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function createGitHubMock({
  tree,
  blobs = {},
  defaultBranch = 'main',
  privateRepository = false,
  overrides = {},
} = {}) {
  const calls = [];
  const treeBlobs = Object.fromEntries(
    (tree?.tree ?? [])
      .filter((entry) => entry.blob)
      .map((entry) => [entry.sha, { ...entry.blob, size: entry.size, sha: entry.sha }]),
  );
  const treeEntriesBySha = new Map((tree?.tree ?? []).map((entry) => [entry.sha, entry]));
  const availableBlobs = {
    ...treeBlobs,
    ...Object.fromEntries(Object.entries(blobs).map(([sha, blob]) => {
      const entry = treeEntriesBySha.get(sha);
      return [sha, { size: entry?.size, sha, ...blob }];
    })),
  };
  const fetchImpl = async (url, options) => {
    calls.push({ url: String(url), options });
    const pathname = new URL(url).pathname;

    if (overrides[pathname]) {
      return overrides[pathname](url, options);
    }
    if (pathname === '/repos/example/project') {
      return jsonResponse({ default_branch: defaultBranch, private: privateRepository });
    }
    if (pathname.startsWith('/repos/example/project/commits/')) {
      return jsonResponse({ sha: COMMIT_SHA, commit: { tree: { sha: TREE_SHA } } });
    }
    if (pathname === `/repos/example/project/git/trees/${TREE_SHA}`) {
      return jsonResponse(tree ?? { tree: [], truncated: false });
    }
    const blobMatch = pathname.match(/^\/repos\/example\/project\/git\/blobs\/([a-f0-9]+)$/);
    if (blobMatch) {
      const blob = availableBlobs[blobMatch[1]];
      return blob ? jsonResponse(blob) : jsonResponse({ message: 'Not Found' }, 404);
    }

    throw new Error(`Unexpected GitHub request: ${url}`);
  };

  return { calls, fetchImpl };
}

function createBlobEntry(path, content) {
  const contentBytes = Buffer.isBuffer(content) ? content : Buffer.from(content);
  const blobSha = createHash('sha1')
    .update(`blob ${contentBytes.length}\0`)
    .update(contentBytes)
    .digest('hex');
  return {
    path,
    mode: '100644',
    type: 'blob',
    sha: blobSha,
    size: contentBytes.length,
    blob: {
      encoding: 'base64',
      content: contentBytes.toString('base64'),
    },
  };
}

test('ingests public repository files while preserving their paths and exact UTF-8 content', async () => {
  const entries = [
    createBlobEntry('src/app.js', '\uFEFFconst title = "DocGuard";\r\n', 'c'.repeat(40)),
    createBlobEntry('docs/README.md', '# Original docs  \n', 'd'.repeat(40)),
    createBlobEntry('assets/logo.png', Buffer.from([0x89, 0x50, 0x4e, 0x47]), 'e'.repeat(40)),
    createBlobEntry('docs/guide.pdf', createPdf(['Repository PDF guide']), 'f'.repeat(40)),
    createBlobEntry('node_modules/pkg/index.js', 'ignored', '1'.repeat(40)),
    createBlobEntry('dist/bundle.js', 'ignored', '2'.repeat(40)),
    { path: 'src/link.js', mode: '120000', type: 'blob', sha: '3'.repeat(40), size: 10 },
  ];
  const { calls, fetchImpl } = createGitHubMock({
    tree: { tree: entries, truncated: false },
    blobs: Object.fromEntries(entries.map((entry) => [entry.sha, entry.blob]).filter(([, blob]) => blob)),
  });

  const result = await ingestGitHubRepository(
    { repositoryUrl: 'https://github.com/example/project.git' },
    { fetchImpl },
  );

  assert.deepEqual(result.project.files, [
    { path: 'src/app.js', content: '\uFEFFconst title = "DocGuard";\r\n', category: 'source' },
    { path: 'docs/README.md', content: '# Original docs  \n', category: 'documentation' },
  ]);
  assert.equal(result.analyserInput.documentationFiles.some(({ path }) => path === 'docs/README.md'), true);
  assert.deepEqual(result.analyserInput.sourceFiles, [
    {
      path: 'src/app.js',
      content: '\uFEFFconst title = "DocGuard";\r\n',
      contentEncoding: 'utf-8',
      originalBytesBase64: Buffer.from('\uFEFFconst title = "DocGuard";\r\n').toString('base64'),
      classification: 'utf8-text',
    },
  ]);
  assert.equal(result.analyserInput.documentation.format, 'text/plain');
  assert.equal(result.analyserInput.documentation.source, 'github');
  assert.deepEqual(result.analyserInput.documentation.files.map((document) => ({
    path: document.path,
    filename: document.filename,
    source: document.source,
    text: document.extractedText,
  })), [{
    path: 'docs/guide.pdf',
    filename: 'guide.pdf',
    source: 'github',
    text: '--- Page 1 ---\nRepository PDF guide',
  }]);
  assert.equal(result.analyserInput.originalFiles.length, 4);
  assert.deepEqual(result.warnings, [{
    code: 'REPOSITORY_FILES_NOT_IN_TEXT_HANDOFF',
    message: '4 repository file(s) were excluded, unsupported, or not safely representable as UTF-8 text.',
  }]);
  assert.deepEqual(result.source, {
    type: 'github',
    repositoryUrl: 'https://github.com/example/project',
    ref: 'main',
    commitSha: COMMIT_SHA,
  });
  assert.deepEqual(result.summary, {
    totalFiles: 4,
    sourceFiles: 1,
    documentationFiles: 2,
    otherFiles: 0,
  });
  assert.deepEqual(result.unsupportedAssets, [
    {
      path: 'assets/logo.png',
      size: 4,
      sha: entries[2].sha,
      mode: '100644',
      classification: 'binary',
      reason: 'binary-file-extension',
    },
  ]);
  assert.equal(calls.some(({ url }) => url.includes(entries[4].sha)), false);
  assert.equal(calls.some(({ url }) => url.includes(entries[5].sha)), false);
  assert.equal(calls.some(({ url }) => url.includes(entries[3].sha)), true);
  assert.ok(calls.every(({ url, options }) => new URL(url).hostname === 'api.github.com'
    && options.redirect === 'error'));
  assert.deepEqual(calls.slice(0, 4).map(({ url }) => new URL(url).pathname), [
    '/repos/example/project',
    '/repos/example/project/commits/main',
    `/repos/example/project/git/trees/${TREE_SHA}`,
    `/repos/example/project/git/blobs/${entries[0].sha}`,
  ]);
});

test('uses an explicitly requested ref without changing its value', async () => {
  const { calls, fetchImpl } = createGitHubMock();
  await ingestGitHubRepository(
    { repositoryUrl: 'https://github.com/example/project', ref: 'feature/add-docs' },
    { fetchImpl },
  );

  assert.ok(calls.some(({ url }) => url.endsWith('/commits/feature%2Fadd-docs')));
});

test('documentation-only ingestion retrieves docs without downloading repository source files', async () => {
  const sourceEntries = Array.from({ length: 60 }, (_, index) => (
    createBlobEntry(`src/file-${index}.js`, `export const value${index} = ${index};`)
  ));
  const readme = createBlobEntry('README.md', '# Repository docs\n');
  const entries = [...sourceEntries, readme];
  const { calls, fetchImpl } = createGitHubMock({
    tree: { tree: entries, truncated: false },
  });

  const result = await ingestGitHubRepository(
    { repositoryUrl: 'https://github.com/example/project', ref: COMMIT_SHA },
    { fetchImpl, documentationOnly: true },
  );

  assert.deepEqual(result.analyserInput.sourceFiles, []);
  assert.equal(result.analyserInput.documentation.files[0].sourcePath, 'README.md');
  assert.equal(result.analyserInput.documentation.files[0].content, '# Repository docs\n');
  assert.equal(calls.some(({ url }) => url.includes(sourceEntries[0].sha)), false);
  assert.equal(calls.some(({ url }) => url.includes(readme.sha)), true);
});

test('supports an empty repository tree', async () => {
  const { fetchImpl } = createGitHubMock({ tree: { tree: [], truncated: false } });
  const result = await ingestGitHubRepository(
    { repositoryUrl: 'https://github.com/example/project' },
    { fetchImpl },
  );

  assert.deepEqual(result.project, { name: 'project', files: [] });
  assert.deepEqual(result.analyserInput, {
    sourceFiles: [],
    documentation: { format: 'text/plain', source: 'missing', files: [] },
    documentationFiles: [],
    binaryFiles: [],
    uncertainFiles: [],
    nonUtf8Files: [],
    originalFiles: [],
    skippedFiles: [],
  });
  assert.deepEqual(result.warnings, [{
    code: 'DOCUMENTATION_MISSING',
    message: 'No separate documentation or readable repository README was found.',
  }]);
  assert.deepEqual(result.summary, {
    totalFiles: 0,
    sourceFiles: 0,
    documentationFiles: 0,
    otherFiles: 0,
  });
});

test('preserves multiple source languages separately and selects root README first', async () => {
  const entries = [
    createBlobEntry('src/server.py', 'print("original")\r\n', 'c'.repeat(40)),
    createBlobEntry('src/main.java', 'class Main {}\n', 'd'.repeat(40)),
    createBlobEntry('docs/README.md', '# Nested README\n', 'e'.repeat(40)),
    createBlobEntry('README.rst', 'Root documentation\n', 'f'.repeat(40)),
    createBlobEntry('README.md', 'Preferred root README\n', '7'.repeat(40)),
    createBlobEntry('docs/guide.rst', 'Additional docs\n', '8'.repeat(40)),
  ];
  const { fetchImpl } = createGitHubMock({ tree: { tree: entries, truncated: false } });
  const result = await ingestGitHubRepository(
    { repositoryUrl: 'https://github.com/example/project' },
    { fetchImpl },
  );

  assert.deepEqual(result.analyserInput.sourceFiles.map(({ path, content }) => ({ path, content })), [
    { path: 'src/server.py', content: 'print("original")\r\n' },
    { path: 'src/main.java', content: 'class Main {}\n' },
  ]);
  assert.deepEqual(result.analyserInput.documentation.files, [{
    path: 'README.md.txt',
    sourcePath: 'README.md',
    content: 'Preferred root README\n',
    originalBytesBase64: Buffer.from('Preferred root README\n').toString('base64'),
  }]);
  assert.equal(result.project.files.find((file) => file.path === 'docs/guide.rst').category, 'documentation');
});

test('accounts for non-UTF-8 recognized source bytes without entering them in the text handoff', async () => {
  const originalBytes = Buffer.from([0x63, 0x61, 0x66, 0xe9, 0x0d, 0x0a]);
  const entry = createBlobEntry('src/legacy.py', originalBytes);
  const { fetchImpl } = createGitHubMock({ tree: { tree: [entry], truncated: false } });
  const result = await ingestGitHubRepository(
    { repositoryUrl: 'https://github.com/example/project' },
    { fetchImpl },
  );

  assert.deepEqual(result.analyserInput.originalFiles[0], {
    path: 'src/legacy.py',
    size: originalBytes.length,
    sha: entry.sha,
    mode: '100644',
    classification: 'non-utf8-text',
    contentRetrieved: true,
    reason: 'not-valid-utf8',
  });
  assert.deepEqual(result.analyserInput.nonUtf8Files, [{
    path: 'src/legacy.py',
    size: originalBytes.length,
    sha: entry.sha,
    mode: '100644',
    classification: 'non-utf8-text',
    contentRetrieved: true,
    reason: 'not-valid-utf8',
  }]);
  assert.deepEqual(result.analyserInput.sourceFiles, []);
  assert.equal(result.project.files.length, 0);
});

test('keeps unknown UTF-8 extensions out of the source handoff', async () => {
  const firstText = 'custom source\r\nwith newlines\n';
  const secondText = 'separate file boundaries';
  const entries = [
    createBlobEntry('src/first.unrecognized', firstText, 'c'.repeat(40)),
    createBlobEntry('src/second.unknown', secondText, 'd'.repeat(40)),
  ];
  const { fetchImpl } = createGitHubMock({ tree: { tree: entries, truncated: false } });
  const result = await ingestGitHubRepository(
    { repositoryUrl: 'https://github.com/example/project' },
    { fetchImpl },
  );

  assert.deepEqual(result.analyserInput.sourceFiles, []);
  assert.deepEqual(result.analyserInput.uncertainFiles.map(({ path, reason }) => ({ path, reason })), [
    { path: 'src/first.unrecognized', reason: 'unrecognized-file-type' },
    { path: 'src/second.unknown', reason: 'unrecognized-file-type' },
  ]);
  assert.equal(JSON.stringify(result).includes(firstText), false);
  assert.equal(JSON.stringify(result).includes(secondText), false);
  assert.equal(result.project.files.length, 0);
});

test('does not send printable UTF-8 bytes from an unknown binary-like file', async () => {
  const suspicious = '89PNG printable payload data 00 01 02';
  const entry = createBlobEntry('assets/unknown-format.data', suspicious);
  const { fetchImpl } = createGitHubMock({ tree: { tree: [entry], truncated: false } });
  const result = await ingestGitHubRepository(
    { repositoryUrl: 'https://github.com/example/project' },
    { fetchImpl },
  );

  assert.deepEqual(result.analyserInput.sourceFiles, []);
  assert.equal(result.analyserInput.uncertainFiles[0].path, entry.path);
  assert.equal(result.analyserInput.uncertainFiles[0].classification, 'uncertain');
  assert.equal(result.analyserInput.uncertainFiles[0].reason, 'unrecognized-file-type');
  assert.equal(JSON.stringify(result).includes(suspicious), false);
});

test('keeps known-signature and unknown-signature binary blobs out of text handoff', async () => {
  const knownBinary = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
  const unknownBinary = Buffer.from([0x00, 0xfe, 0x12, 0x81, 0x03, 0xff]);
  const entries = [
    createBlobEntry('assets/picture.unknown', knownBinary, 'c'.repeat(40)),
    createBlobEntry('assets/opaque.data', unknownBinary, 'd'.repeat(40)),
  ];
  const { fetchImpl } = createGitHubMock({ tree: { tree: entries, truncated: false } });
  const result = await ingestGitHubRepository(
    { repositoryUrl: 'https://github.com/example/project' },
    { fetchImpl },
  );

  assert.deepEqual(result.analyserInput.sourceFiles, []);
  assert.ok(result.analyserInput.originalFiles.every((file) => !('contentBase64' in file)));
  assert.equal(JSON.stringify(result).includes(knownBinary.toString('base64')), false);
  assert.equal(JSON.stringify(result).includes(unknownBinary.toString('base64')), false);
  assert.ok(result.unsupportedAssets.every((file) => file.classification === 'binary'));
  assert.deepEqual(result.analyserInput.skippedFiles, [
    { path: 'assets/picture.unknown', reason: 'binary-not-in-text-handoff' },
    { path: 'assets/opaque.data', reason: 'binary-not-in-text-handoff' },
  ]);
});

test('keeps known binary signatures out of source handoff even with source extensions', async () => {
  const pngBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const entry = createBlobEntry('src/generated.js', pngBytes);
  const { fetchImpl } = createGitHubMock({ tree: { tree: [entry], truncated: false } });
  const result = await ingestGitHubRepository(
    { repositoryUrl: 'https://github.com/example/project' },
    { fetchImpl },
  );

  assert.deepEqual(result.analyserInput.sourceFiles, []);
  assert.equal(result.analyserInput.binaryFiles[0].path, entry.path);
  assert.equal(JSON.stringify(result).includes(pngBytes.toString('base64')), false);
  assert.deepEqual(result.analyserInput.skippedFiles, [
    { path: entry.path, reason: 'binary-not-in-text-handoff' },
  ]);
});

test('reports uncertain UTF-8 content rather than passing control data as source text', async () => {
  const uncertainBytes = Buffer.from([0x74, 0x65, 0x78, 0x74, 0x01, 0x6d, 0x6f, 0x72, 0x65]);
  const entry = createBlobEntry('src/ambiguous.src', uncertainBytes, 'c'.repeat(40));
  const { fetchImpl } = createGitHubMock({ tree: { tree: [entry], truncated: false } });
  const result = await ingestGitHubRepository(
    { repositoryUrl: 'https://github.com/example/project' },
    { fetchImpl },
  );

  assert.deepEqual(result.analyserInput.sourceFiles, []);
  assert.equal(result.unsupportedAssets[0].classification, 'uncertain');
  assert.deepEqual(result.analyserInput.uncertainFiles, [{
    path: 'src/ambiguous.src',
    size: uncertainBytes.length,
    sha: entry.sha,
    mode: '100644',
    classification: 'uncertain',
    contentRetrieved: true,
    reason: 'unrecognized-file-type',
  }]);
  assert.equal(JSON.stringify(result).includes(uncertainBytes.toString('base64')), false);
});

test('does not send printable UTF-8 data with an unknown extension as source or raw content', async () => {
  const suspicious = 'this is printable text, but its format is unknown';
  const entry = createBlobEntry('artifacts/payload.opaque', suspicious);
  const { fetchImpl } = createGitHubMock({ tree: { tree: [entry], truncated: false } });
  const result = await ingestGitHubRepository(
    { repositoryUrl: 'https://github.com/example/project' },
    { fetchImpl },
  );

  assert.deepEqual(result.analyserInput.sourceFiles, []);
  assert.equal(result.analyserInput.uncertainFiles[0].path, entry.path);
  assert.equal(result.analyserInput.uncertainFiles[0].reason, 'unrecognized-file-type');
  assert.equal(result.analyserInput.skippedFiles[0].path, entry.path);
  assert.equal(JSON.stringify(result).includes(suspicious), false);
  assert.equal(JSON.stringify(result).includes(Buffer.from(suspicious).toString('base64')), false);
});

test('uses supplied documentation instead of repository README', async () => {
  const readme = createBlobEntry('README.md', 'Repository README\n', 'c'.repeat(40));
  const { fetchImpl } = createGitHubMock({ tree: { tree: [readme], truncated: false } });
  const result = await ingestGitHubRepository(
    {
      repositoryUrl: 'https://github.com/example/project',
      documentation: [{ path: 'submitted/guide.md', content: 'Supplied text\r\n' }],
    },
    { fetchImpl },
  );

  assert.deepEqual(result.analyserInput.documentation, {
    format: 'text/plain',
    source: 'provided',
    files: [{
      path: 'submitted/guide.md.txt',
      sourcePath: 'submitted/guide.md',
      content: 'Supplied text\r\n',
      originalBytesBase64: Buffer.from('Supplied text\r\n').toString('base64'),
    }],
  });
});

test('warns when no README exists, even if other documentation files are present', async () => {
  const guide = createBlobEntry('docs/guide.md', 'Guide content\n', 'c'.repeat(40));
  const { fetchImpl } = createGitHubMock({ tree: { tree: [guide], truncated: false } });
  const result = await ingestGitHubRepository(
    { repositoryUrl: 'https://github.com/example/project' },
    { fetchImpl },
  );

  assert.deepEqual(result.analyserInput.documentation.files, []);
  assert.equal(result.warnings[0].code, 'DOCUMENTATION_MISSING');
});

test('rejects malformed separately supplied documentation', async () => {
  const { fetchImpl, calls } = createGitHubMock();
  await assert.rejects(
    ingestGitHubRepository(
      {
        repositoryUrl: 'https://github.com/example/project',
        documentation: [{ path: '../escape.txt', content: 'text' }],
      },
      { fetchImpl },
    ),
    (error) => error.code === 'UNSAFE_FILE_PATH',
  );
  assert.equal(calls.length, 0);
});

test('rejects supplied PDF documentation instead of treating it as text', async () => {
  const { fetchImpl, calls } = createGitHubMock();
  await assert.rejects(
    ingestGitHubRepository(
      {
        repositoryUrl: 'https://github.com/example/project',
        documentation: [{ path: 'uploaded/manual.pdf', content: 'JVBERi0xLjQ=' }],
      },
      { fetchImpl },
    ),
    (error) => error.statusCode === 415 && error.code === 'PDF_DOCUMENTATION_NOT_SUPPORTED',
  );
  assert.equal(calls.length, 0);
});

test('processes repository PDFs as separate documentation and preserves their original references', async () => {
  const firstPdf = createPdf(['First repository document']);
  const secondPdf = createPdf(['Second repository document']);
  const entries = [
    createBlobEntry('docs/guides/first.pdf', firstPdf),
    createBlobEntry('reference.pdf', secondPdf),
    createBlobEntry('src/app.js', 'const untouched = true;\n'),
  ];
  const { calls, fetchImpl } = createGitHubMock({ tree: { tree: entries, truncated: false } });
  const result = await ingestGitHubRepository(
    { repositoryUrl: 'https://github.com/example/project' },
    { fetchImpl },
  );

  assert.deepEqual(result.analyserInput.sourceFiles.map(({ path, content }) => ({ path, content })), [
    { path: 'src/app.js', content: 'const untouched = true;\n' },
  ]);
  assert.deepEqual(result.analyserInput.documentation.files.map((document) => ({
    path: document.path,
    source: document.source,
    text: document.extractedText,
    status: document.extractionStatus,
  })), [
    {
      path: 'docs/guides/first.pdf',
      source: 'github',
      text: '--- Page 1 ---\nFirst repository document',
      status: 'success',
    },
    {
      path: 'reference.pdf',
      source: 'github',
      text: '--- Page 1 ---\nSecond repository document',
      status: 'success',
    },
  ]);
  assert.deepEqual(result.analyserInput.documentation.files.map(({ original }) => original.sha256), [
    createHash('sha256').update(firstPdf).digest('hex'),
    createHash('sha256').update(secondPdf).digest('hex'),
  ]);
  assert.equal(result.analyserInput.originalFiles.filter(({ classification }) => classification === 'pdf-documentation').length, 2);
  assert.equal(calls.filter(({ url }) => url.includes('/git/blobs/')).length, 3);
  assert.equal(JSON.stringify(result).includes(firstPdf.toString('base64')), false);
  assert.equal(getOriginalPdf(result.analyserInput.documentation.files[0].original.referenceId).bytes.equals(firstPdf), true);
});

test('retrieves a shared repository PDF blob only once when it appears at multiple paths', async () => {
  const bytes = createPdf(['Shared PDF bytes']);
  const entries = [
    createBlobEntry('docs/first.pdf', bytes),
    createBlobEntry('docs/second.pdf', bytes),
  ];
  const { calls, fetchImpl } = createGitHubMock({ tree: { tree: entries, truncated: false } });
  const result = await ingestGitHubRepository(
    { repositoryUrl: 'https://github.com/example/project' },
    { fetchImpl },
  );

  assert.deepEqual(result.analyserInput.documentation.files.map(({ path }) => path), [
    'docs/first.pdf',
    'docs/second.pdf',
  ]);
  assert.equal(calls.filter(({ url }) => url.endsWith(`/git/blobs/${entries[0].sha}`)).length, 1);
});

test('includes uploaded and repository PDFs together without falling back to README', async () => {
  const uploadedBytes = createPdf(['Uploaded documentation']);
  const repositoryBytes = createPdf(['Repository documentation']);
  const uploaded = await extractPdfDocument(uploadedBytes, {
    filename: 'uploaded-guide.pdf',
    source: 'uploaded',
  });
  const [storedUploaded] = storePdfDocuments([uploaded]);
  const readme = createBlobEntry('README.md', 'README fallback should not be selected\n');
  const pdf = createBlobEntry('docs/repository-guide.pdf', repositoryBytes);
  const { fetchImpl } = createGitHubMock({ tree: { tree: [readme, pdf], truncated: false } });
  const result = await ingestGitHubRepository(
    {
      repositoryUrl: 'https://github.com/example/project',
      uploadedDocumentIds: [storedUploaded.original.referenceId],
    },
    { fetchImpl },
  );

  assert.equal(result.analyserInput.documentation.source, 'mixed');
  assert.deepEqual(result.analyserInput.documentation.files.map(({ filename, source, extractedText }) => ({
    filename,
    source,
    extractedText,
  })), [
    {
      filename: 'uploaded-guide.pdf',
      source: 'uploaded',
      extractedText: '--- Page 1 ---\nUploaded documentation',
    },
    {
      filename: 'repository-guide.pdf',
      source: 'github',
      extractedText: '--- Page 1 ---\nRepository documentation',
    },
  ]);
});

test('uses uploaded PDF documentation without repository PDF or README', async () => {
  const pending = await extractPdfDocument(createPdf(['The supplied PDF']), {
    filename: 'manual.pdf',
    source: 'uploaded',
  });
  const [stored] = storePdfDocuments([pending]);
  const { fetchImpl } = createGitHubMock();
  const result = await ingestGitHubRepository(
    {
      repositoryUrl: 'https://github.com/example/project',
      uploadedDocumentIds: [stored.original.referenceId],
    },
    { fetchImpl },
  );

  assert.equal(result.analyserInput.documentation.source, 'uploaded');
  assert.equal(result.analyserInput.documentation.files[0].source, 'uploaded');
  assert.equal(result.warnings.some(({ code }) => code === 'DOCUMENTATION_MISSING'), false);
});

test('fails explicitly when a repository PDF is corrupt', async () => {
  const corruptPdf = createBlobEntry('docs/broken.pdf', Buffer.from('%PDF-1.4\nbroken\n%%EOF'));
  const { fetchImpl } = createGitHubMock({ tree: { tree: [corruptPdf], truncated: false } });
  await assert.rejects(
    ingestGitHubRepository(
      { repositoryUrl: 'https://github.com/example/project' },
      { fetchImpl },
    ),
    (error) => error.code === 'PDF_EXTRACTION_FAILED',
  );
});

test('preserves scanned repository PDFs and reports the OCR warning', async () => {
  const entry = createBlobEntry('docs/scanned.pdf', createPdf(['']));
  const { fetchImpl } = createGitHubMock({ tree: { tree: [entry], truncated: false } });
  const result = await ingestGitHubRepository(
    { repositoryUrl: 'https://github.com/example/project' },
    { fetchImpl },
  );

  assert.equal(result.analyserInput.documentation.files[0].extractionStatus, 'requires_ocr');
  assert.equal(result.analyserInput.documentation.files[0].warnings[0].code, 'PDF_OCR_REQUIRED');
  assert.equal(result.warnings[0].code, 'PDF_OCR_REQUIRED');
  assert.equal(result.analyserInput.sourceFiles.some(({ path }) => path.endsWith('.pdf')), false);
});

test('rejects unsafe and duplicate repository paths before requesting file blobs', async () => {
  for (const [entries, expectedCode] of [
    [[createBlobEntry('../outside.js', 'x', 'c'.repeat(40))], 'UNSAFE_FILE_PATH'],
    [[createBlobEntry('node_modules/../../outside.js', 'x', 'c'.repeat(40))], 'UNSAFE_FILE_PATH'],
    [
      [
        createBlobEntry('src/app.js', 'x', 'c'.repeat(40)),
        createBlobEntry('src/app.js', 'y', 'd'.repeat(40)),
      ],
      'DUPLICATE_FILE_PATH',
    ],
  ]) {
    const { calls, fetchImpl } = createGitHubMock({ tree: { tree: entries, truncated: false } });
    await assert.rejects(
      ingestGitHubRepository(
        { repositoryUrl: 'https://github.com/example/project' },
        { fetchImpl },
      ),
      (error) => error instanceof HttpError && error.code === expectedCode,
    );
    assert.equal(calls.some(({ url }) => url.includes('/git/blobs/')), false);
  }
});

test('rejects file count, individual size, and aggregate repository size limits', async () => {
  const files = [
    createBlobEntry('src/one.js', 'one', 'c'.repeat(40)),
    createBlobEntry('docs/two.md', 'two', 'd'.repeat(40)),
  ];

  for (const [limits, expectedCode] of [
    [{ maxFiles: 1 }, 'REPOSITORY_FILE_LIMIT_EXCEEDED'],
    [{ maxFileBytes: 2 }, 'REPOSITORY_FILE_TOO_LARGE'],
    [{ maxRepositoryBytes: 5 }, 'REPOSITORY_SIZE_LIMIT_EXCEEDED'],
  ]) {
    const { fetchImpl } = createGitHubMock({ tree: { tree: files, truncated: false } });
    await assert.rejects(
      ingestGitHubRepository(
        { repositoryUrl: 'https://github.com/example/project' },
        { fetchImpl, limits: { maxFiles: 500, maxFileBytes: 1024, maxRepositoryBytes: 1024, maxApiResponseBytes: 100_000, requestTimeoutMs: 100, ...limits } },
      ),
      (error) => error instanceof HttpError && error.code === expectedCode,
    );
  }
});

test('rejects truncated trees and malformed GitHub blob contents', async () => {
  const truncated = createGitHubMock({ tree: { tree: [], truncated: true } });
  await assert.rejects(
    ingestGitHubRepository(
      { repositoryUrl: 'https://github.com/example/project' },
      { fetchImpl: truncated.fetchImpl },
    ),
    (error) => error.code === 'REPOSITORY_TREE_TOO_LARGE',
  );

  const malformedBlobEntry = createBlobEntry('src/app.js', 'valid', 'c'.repeat(40));
  const malformedBlob = createGitHubMock({
    tree: { tree: [malformedBlobEntry], truncated: false },
    blobs: { [malformedBlobEntry.sha]: { encoding: 'base64', content: '%%%not-base64%%%' } },
  });
  await assert.rejects(
    ingestGitHubRepository(
      { repositoryUrl: 'https://github.com/example/project' },
      { fetchImpl: malformedBlob.fetchImpl },
    ),
    (error) => error.code === 'INVALID_GITHUB_BLOB',
  );
});

test('fails explicitly when a listed repository blob cannot be retrieved', async () => {
  const entry = {
    path: 'src/missing.js',
    mode: '100644',
    type: 'blob',
    sha: 'c'.repeat(40),
    size: 12,
  };
  const { fetchImpl } = createGitHubMock({ tree: { tree: [entry], truncated: false } });

  await assert.rejects(
    ingestGitHubRepository(
      { repositoryUrl: 'https://github.com/example/project' },
      { fetchImpl },
    ),
    (error) => error.statusCode === 404 && error.code === 'GITHUB_RESOURCE_NOT_FOUND',
  );
});

test('rejects blob bytes whose Git object hash does not match the tree SHA', async () => {
  const entry = createBlobEntry('src/source.js', 'original', 'ignored');
  const tampered = Buffer.from('tampered');
  const { fetchImpl } = createGitHubMock({
    tree: { tree: [entry], truncated: false },
    overrides: {
      [`/repos/example/project/git/blobs/${entry.sha}`]: async () => jsonResponse({
        sha: entry.sha,
        size: tampered.length,
        encoding: 'base64',
        content: tampered.toString('base64'),
      }),
    },
  });

  await assert.rejects(
    ingestGitHubRepository(
      { repositoryUrl: 'https://github.com/example/project' },
      { fetchImpl },
    ),
    (error) => error.code === 'INVALID_GITHUB_BLOB',
  );
});

test('returns clear errors for invalid repository inputs and private repositories', async () => {
  await assert.rejects(
    ingestGitHubRepository({ repositoryUrl: 'https://evil.example/owner/repo' }),
    (error) => error instanceof HttpError && error.statusCode === 400,
  );
  await assert.rejects(
    ingestGitHubRepository({ repositoryUrl: 'https://github.com/example/project', ref: '../main' }),
    (error) => error.code === 'INVALID_REPOSITORY_REF',
  );

  const { fetchImpl } = createGitHubMock({ privateRepository: true });
  await assert.rejects(
    ingestGitHubRepository(
      { repositoryUrl: 'https://github.com/example/project' },
      { fetchImpl },
    ),
    (error) => error.statusCode === 404,
  );
});

test('maps GitHub API failures to safe HTTP errors', async () => {
  for (const [status, expectedCode] of [
    [403, 'GITHUB_RATE_LIMITED'],
    [500, 'GITHUB_UPSTREAM_ERROR'],
  ]) {
    const { fetchImpl } = createGitHubMock({
      overrides: {
        '/repos/example/project': async () => jsonResponse({ message: 'private upstream details' }, status),
      },
    });
    await assert.rejects(
      ingestGitHubRepository(
        { repositoryUrl: 'https://github.com/example/project' },
        { fetchImpl },
      ),
      (error) => error.code === expectedCode && !error.message.includes('private upstream details'),
    );
  }
});

test('converts GitHub network failures and timeouts into API errors', async () => {
  await assert.rejects(
    ingestGitHubRepository(
      { repositoryUrl: 'https://github.com/example/project' },
      { fetchImpl: async () => { throw new Error('network details'); } },
    ),
    (error) => error.code === 'GITHUB_NETWORK_ERROR' && !error.message.includes('network details'),
  );

  const timeoutFetch = (_url, { signal }) => new Promise((_resolve, reject) => {
    signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
  });
  await assert.rejects(
    ingestGitHubRepository(
      { repositoryUrl: 'https://github.com/example/project' },
      {
        fetchImpl: timeoutFetch,
        limits: { maxFiles: 500, maxFileBytes: 1024, maxRepositoryBytes: 1024, maxApiResponseBytes: 100_000, requestTimeoutMs: 5 },
      },
    ),
    (error) => error.code === 'GITHUB_REQUEST_TIMEOUT',
  );
});

test('rejects oversized GitHub API responses', async () => {
  await assert.rejects(
    ingestGitHubRepository(
      { repositoryUrl: 'https://github.com/example/project' },
      {
        fetchImpl: async () => jsonResponse({ default_branch: 'main', private: false, extra: 'large response' }),
        limits: { maxFiles: 500, maxFileBytes: 1024, maxRepositoryBytes: 1024, maxApiResponseBytes: 20, requestTimeoutMs: 100 },
      },
    ),
    (error) => error.code === 'GITHUB_RESPONSE_TOO_LARGE',
  );
});
