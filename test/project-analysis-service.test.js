import assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { inspectProject } from '../src/services/project-analysis-service.js';
import { processProjectInput } from '../src/services/project-input-service.js';

async function createTempDirectory(testContext) {
  const directoryPath = await mkdtemp(join(tmpdir(), 'docguard-project-service-'));
  testContext.after(() => rm(directoryPath, { recursive: true, force: true }));
  return directoryPath;
}

test('returns structured project summary, discovered files, and associations', async (testContext) => {
  const projectPath = await createTempDirectory(testContext);
  await mkdir(join(projectPath, 'src'));
  await mkdir(join(projectPath, 'docs'));
  await writeFile(join(projectPath, 'src', 'auth.js'), 'source is not parsed');
  await writeFile(join(projectPath, 'src', 'other.js'), 'source is not parsed');
  await writeFile(join(projectPath, 'docs', 'auth.md'), 'documentation is not parsed');

  const result = await inspectProject(projectPath);

  assert.equal(result.projectPath, resolve(projectPath));
  assert.deepEqual(result.directorySummary, {
    absolutePath: resolve(projectPath),
    fileCount: 0,
    folderCount: 2,
  });
  assert.deepEqual(result.javascriptFiles.map((file) => file.relativePath), [
    'src/auth.js',
    'src/other.js',
  ]);
  assert.deepEqual(result.markdownFiles.map((file) => file.relativePath), ['docs/auth.md']);
  assert.deepEqual(result.associations.map(({ label, javascriptFile, markdownFile }) => [
    label,
    javascriptFile.relativePath,
    markdownFile.relativePath,
  ]), [
    ['POTENTIAL', 'src/auth.js', 'docs/auth.md'],
  ]);
  assert.deepEqual(result.unassociatedJavaScriptFiles.map((file) => file.relativePath), ['src/other.js']);
  assert.deepEqual(result.unassociatedMarkdownFiles, []);
  assert.deepEqual(result.errors, []);
  assert.equal(result.scanComplete, true);
});

test('rejects invalid project directories before scanning', async () => {
  const missingPath = join(tmpdir(), 'docguard-missing-project-service');

  await assert.rejects(inspectProject(missingPath), /Directory does not exist:/);
});

test('returns an incomplete structured result when a nested directory cannot be read', async (testContext) => {
  if (typeof process.geteuid === 'function' && process.geteuid() === 0) {
    testContext.skip('The process runs as root and can bypass directory permission bits.');
    return;
  }

  const projectPath = await createTempDirectory(testContext);
  const inaccessiblePath = join(projectPath, 'private');
  await mkdir(inaccessiblePath);

  try {
    await chmod(inaccessiblePath, 0);
    const result = await inspectProject(projectPath);

    assert.equal(result.scanComplete, false);
    assert.equal(result.errors.length, 1);
    assert.equal(result.errors[0].absolutePath, inaccessiblePath);
  } finally {
    await chmod(inaccessiblePath, 0o700);
  }
});

test('preserves project file paths and original content while classifying file types', () => {
  const sourceContent = 'const value = "keep exactly";\r\n\n';
  const documentationContent = '# Original title  \n\nText stays as received.\n';
  const result = processProjectInput({
    project: {
      name: 'example-project',
      files: [
        { path: 'src/example.JS', content: sourceContent },
        { path: 'docs/README.MD', content: documentationContent },
        { path: 'assets/data.json', content: '{"value": 1}' },
      ],
    },
  });

  assert.deepEqual(result, {
    project: {
      name: 'example-project',
      files: [
        { path: 'src/example.JS', content: sourceContent, category: 'source' },
        { path: 'docs/README.MD', content: documentationContent, category: 'documentation' },
        { path: 'assets/data.json', content: '{"value": 1}', category: 'other' },
      ],
    },
  });
});

test('accepts an empty project file list', () => {
  assert.deepEqual(processProjectInput({
    project: { name: 'empty-project', files: [] },
  }), {
    project: { name: 'empty-project', files: [] },
  });
});

test('rejects malformed project data and non-string file content', () => {
  assert.throws(() => processProjectInput(null), {
    code: 'INVALID_PROJECT',
    statusCode: 400,
  });
  assert.throws(() => processProjectInput({ project: { name: 'x' } }), {
    code: 'INVALID_PROJECT_FILES',
    statusCode: 400,
  });
  assert.throws(() => processProjectInput({
    project: { name: 'x', files: [{ path: 'src/app.js', content: 42 }] },
  }), {
    code: 'INVALID_FILE_CONTENT',
    statusCode: 400,
  });
});

test('rejects unsafe and traversal file paths', () => {
  for (const unsafePath of [
    '../outside.js',
    'src/../outside.js',
    '/absolute/path.js',
    'C:\\outside.js',
    'src\\outside.js',
    'src//app.js',
    './src/app.js',
    'src/',
    'src/\u0000app.js',
  ]) {
    assert.throws(() => processProjectInput({
      project: { name: 'x', files: [{ path: unsafePath, content: '' }] },
    }), {
      code: 'UNSAFE_FILE_PATH',
      statusCode: 400,
    }, `Expected path to be rejected: ${JSON.stringify(unsafePath)}`);
  }
});

test('rejects duplicate file paths', () => {
  assert.throws(() => processProjectInput({
    project: {
      name: 'x',
      files: [
        { path: 'src/app.js', content: 'first' },
        { path: 'src/app.js', content: 'second' },
      ],
    },
  }), {
    code: 'DUPLICATE_FILE_PATH',
    statusCode: 400,
  });
});

test('rejects missing project names and empty file paths', () => {
  assert.throws(() => processProjectInput({
    project: { name: '  ', files: [] },
  }), {
    code: 'INVALID_PROJECT_NAME',
    statusCode: 400,
  });

  assert.throws(() => processProjectInput({
    project: { name: 'x', files: [{ path: '', content: '' }] },
  }), {
    code: 'INVALID_FILE_PATH',
    statusCode: 400,
  });
});
