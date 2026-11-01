import assert from 'node:assert/strict';
import test from 'node:test';
import {
  getProjectReference,
  prepareProjectForAnalysis,
  storeProjectReference,
} from '../src/services/project-reference-service.js';
import { createPdf } from '../test-fixtures/pdf-fixture.js';
import {
  extractPdfDocument,
  storePdfDocuments,
} from '../src/services/pdf-document-service.js';

test('prepares source files independently from multiple PDF documentation records and project metadata', async () => {
  const firstPdf = await extractPdfDocument(createPdf(['first page']), {
    filename: 'first.pdf',
    path: 'docs/first.pdf',
    source: 'github',
  });
  const secondPdf = await extractPdfDocument(createPdf(['second page']), {
    filename: 'second.pdf',
    source: 'uploaded',
  });
  const [first, second] = storePdfDocuments([firstPdf, secondPdf]);
  const sourceContent = '\uFEFFconst timeout = 30;\r\n';
  const result = prepareProjectForAnalysis({
    project: {
      name: 'sample',
      files: [
        { path: 'src/config.js', content: sourceContent, category: 'source' },
        { path: 'README.md', content: '# Readme\n', category: 'documentation' },
        { path: 'assets/data.bin', content: 'not source', category: 'other' },
      ],
    },
    source: {
      type: 'github',
      repositoryUrl: 'https://github.com/example/sample',
      ref: 'main',
      commitSha: 'a'.repeat(40),
    },
    analyserInput: {
      sourceFiles: [{
        path: 'src/config.js',
        content: sourceContent,
        originalBytesBase64: 'not-for-analyser',
        classification: 'utf8-text',
      }],
      documentation: {
        source: 'mixed',
        files: [first, second],
      },
      documentationFiles: [{
        path: 'README.md',
        content: '# Readme\n',
        originalBytesBase64: 'not-for-analyser',
      }],
      binaryFiles: [{ path: 'assets/data.bin' }],
      uncertainFiles: [{ path: 'data.unknown' }],
    },
  });

  assert.deepEqual(result.project.source, {
    type: 'github',
    repositoryUrl: 'https://github.com/example/sample',
    ref: 'main',
    commitSha: 'a'.repeat(40),
  });
  assert.deepEqual(result.project.sourceFiles, [{
    path: 'src/config.js',
    content: sourceContent,
  }]);
  assert.deepEqual(result.project.documentation.map(({ path, source, extractedText, pages }) => ({
    path,
    source,
    extractedText,
    pages,
  })), [
    {
      path: 'docs/first.pdf',
      source: 'github',
      extractedText: '--- Page 1 ---\nfirst page',
      pages: [{ pageNumber: 1, text: 'first page' }],
    },
    {
      path: 'second.pdf',
      source: 'uploaded',
      extractedText: '--- Page 1 ---\nsecond page',
      pages: [{ pageNumber: 1, text: 'second page' }],
    },
    {
      path: 'README.md',
      source: 'github',
      extractedText: '# Readme\n',
      pages: undefined,
    },
  ]);
  assert.equal(JSON.stringify(result).includes('not-for-analyser'), false);
  assert.equal(JSON.stringify(result).includes('assets/data.bin'), false);
});

test('uses the selected README fallback and preserves missing-documentation warnings', () => {
  const readmeProject = prepareProjectForAnalysis({
    project: {
      name: 'readme-project',
      files: [{ path: 'README.md', content: '# Project help\n', category: 'documentation' }],
    },
    source: { type: 'github', repositoryUrl: 'https://github.com/example/readme-project' },
    analyserInput: {
      sourceFiles: [],
      documentation: {
        format: 'text/plain',
        source: 'repository-readme',
        files: [{
          path: 'README.md.txt',
          sourcePath: 'README.md',
          content: '# Project help\n',
        }],
      },
      documentationFiles: [{
        path: 'README.md',
        content: '# Project help\n',
      }],
    },
  });
  assert.deepEqual(readmeProject.project.documentation, [{
    path: 'README.md',
    filename: 'README.md',
    source: 'repository-readme',
    format: 'text/plain',
    originalFormat: 'text/plain',
    extractedText: '# Project help\n',
  }]);

  const missingProject = prepareProjectForAnalysis({
    project: {
      name: 'empty',
      files: [{ path: 'docs/guide.md', content: '# Guide only\n', category: 'documentation' }],
    },
    source: { type: 'github' },
    analyserInput: {
      sourceFiles: [],
      documentation: { source: 'missing', files: [] },
      documentationFiles: [{
        path: 'docs/guide.md',
        content: '# Guide only\n',
      }],
    },
  });
  assert.deepEqual(missingProject.project.documentation, []);
  assert.equal(missingProject.project.warnings[0].code, 'DOCUMENTATION_MISSING');
});

test('stores project references with expiry and rejects invalid or expired references', () => {
  const result = {
    project: {
      name: 'normalized',
      files: [
        { path: 'src/index.js', content: 'export const value = 1;\n', category: 'source' },
        { path: 'docs/guide.md', content: '# Guide\n', category: 'documentation' },
        { path: 'asset.bin', content: 'ignored', category: 'other' },
      ],
    },
  };
  const reference = storeProjectReference(result);
  const stored = getProjectReference(reference.projectId);
  assert.equal(stored.project.name, 'normalized');
  assert.equal(stored.project.sourceFiles[0].content, 'export const value = 1;\n');
  assert.equal(stored.project.documentation[0].extractedText, '# Guide\n');
  assert.throws(
    () => getProjectReference('not-a-project-id'),
    (error) => error.code === 'PROJECT_REFERENCE_NOT_FOUND',
  );

  const expiring = storeProjectReference(result, { limits: {
    maxProjects: 100,
    maxStoredBytes: 50 * 1024 * 1024,
    referenceTtlMs: 1,
  }, now: Date.now() - 10 });
  assert.throws(
    () => getProjectReference(expiring.projectId),
    (error) => error.code === 'PROJECT_REFERENCE_NOT_FOUND',
  );
});
