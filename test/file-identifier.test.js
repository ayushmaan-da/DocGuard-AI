import assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { createFileAssociations } from '../src/file-associations.js';
import { scanProjectFiles } from '../src/file-identifier.js';

async function createTempDirectory(testContext) {
  const directoryPath = await mkdtemp(join(tmpdir(), 'docguard-identification-'));
  testContext.after(() => rm(directoryPath, { recursive: true, force: true }));
  return directoryPath;
}

async function createFile(directoryPath, relativePath) {
  const filePath = join(directoryPath, relativePath);
  await mkdir(join(filePath, '..'), { recursive: true });
  await writeFile(filePath, 'File contents are intentionally not inspected.');
  return filePath;
}

test('identifies JavaScript and Markdown recursively with absolute and relative paths', async (testContext) => {
  const projectPath = await createTempDirectory(testContext);
  await createFile(projectPath, 'src/index.js');
  await createFile(projectPath, 'docs/guide.md');
  await createFile(projectPath, 'tests/helper.JS');
  await createFile(projectPath, 'docs/UPPER.MD');

  const results = await scanProjectFiles(projectPath);

  assert.deepEqual(results.javascriptFiles.map((file) => file.relativePath), ['src/index.js', 'tests/helper.JS']);
  assert.deepEqual(results.markdownFiles.map((file) => file.relativePath), ['docs/UPPER.MD', 'docs/guide.md']);
  assert.deepEqual(results.javascriptFiles.map((file) => file.absolutePath), [
    resolve(projectPath, 'src/index.js'),
    resolve(projectPath, 'tests/helper.JS'),
  ]);
  assert.deepEqual(results.markdownFiles.map((file) => file.absolutePath), [
    resolve(projectPath, 'docs/UPPER.MD'),
    resolve(projectPath, 'docs/guide.md'),
  ]);
  assert.deepEqual(results.javascriptFiles[1], {
    name: 'helper.JS',
    relativePath: 'tests/helper.JS',
    absolutePath: resolve(projectPath, 'tests/helper.JS'),
    extension: '.JS',
  });
  assert.deepEqual(results.errors, []);
});

test('skips excluded directories but scans src, docs, test, and tests', async (testContext) => {
  const projectPath = await createTempDirectory(testContext);
  const excludedDirectories = ['node_modules', '.git', 'dist', 'build', 'coverage'];

  for (const directory of excludedDirectories) {
    await createFile(projectPath, `${directory}/ignored.js`);
    await createFile(projectPath, `${directory}/ignored.md`);
  }

  for (const directory of ['src', 'docs', 'test', 'tests']) {
    await createFile(projectPath, `${directory}/included.js`);
    await createFile(projectPath, `${directory}/included.md`);
  }

  const results = await scanProjectFiles(projectPath);

  assert.deepEqual(results.javascriptFiles.map((file) => file.relativePath), [
    'docs/included.js',
    'src/included.js',
    'test/included.js',
    'tests/included.js',
  ]);
  assert.deepEqual(results.markdownFiles.map((file) => file.relativePath), [
    'docs/included.md',
    'src/included.md',
    'test/included.md',
    'tests/included.md',
  ]);
});

test('returns empty collections for an empty project', async (testContext) => {
  const projectPath = await createTempDirectory(testContext);

  assert.deepEqual(await scanProjectFiles(projectPath), {
    projectPath: resolve(projectPath),
    javascriptFiles: [],
    markdownFiles: [],
    errors: [],
  });
});

test('handles projects containing only JavaScript or only Markdown files', async (testContext) => {
  const javascriptProject = await createTempDirectory(testContext);
  await createFile(javascriptProject, 'src/app.js');
  const javascriptResults = await scanProjectFiles(javascriptProject);
  assert.equal(javascriptResults.javascriptFiles.length, 1);
  assert.equal(javascriptResults.markdownFiles.length, 0);

  const markdownProject = await createTempDirectory(testContext);
  await createFile(markdownProject, 'docs/guide.md');
  const markdownResults = await scanProjectFiles(markdownProject);
  assert.equal(markdownResults.javascriptFiles.length, 0);
  assert.equal(markdownResults.markdownFiles.length, 1);
});

test('prevents duplicate file entries', async (testContext) => {
  const projectPath = await createTempDirectory(testContext);
  await createFile(projectPath, 'src/once.js');

  const results = await scanProjectFiles(projectPath);

  assert.equal(results.javascriptFiles.length, 1);
  assert.equal(new Set(results.javascriptFiles.map((file) => file.absolutePath)).size, 1);
});

test('creates case-insensitive potential associations by matching file names', async () => {
  const javascriptFiles = [
    { name: 'auth.js', extension: '.js', relativePath: 'src/auth.js', absolutePath: '/project/src/auth.js' },
    { name: 'config.JS', extension: '.JS', relativePath: 'src/config.JS', absolutePath: '/project/src/config.JS' },
    { name: 'index.js', extension: '.js', relativePath: 'src/index.js', absolutePath: '/project/src/index.js' },
    { name: 'unmatched.js', extension: '.js', relativePath: 'src/unmatched.js', absolutePath: '/project/src/unmatched.js' },
  ];
  const markdownFiles = [
    { name: 'AUTH.MD', extension: '.MD', relativePath: 'docs/AUTH.MD', absolutePath: '/project/docs/AUTH.MD' },
    { name: 'config.md', extension: '.md', relativePath: 'docs/config.md', absolutePath: '/project/docs/config.md' },
    { name: 'README.md', extension: '.md', relativePath: 'README.md', absolutePath: '/project/README.md' },
    { name: 'README.md', extension: '.md', relativePath: 'docs/README.md', absolutePath: '/project/docs/README.md' },
    { name: 'authentication.md', extension: '.md', relativePath: 'docs/authentication.md', absolutePath: '/project/docs/authentication.md' },
  ];

  const { associations, unassociatedJavaScriptFiles, unassociatedMarkdownFiles } = createFileAssociations(javascriptFiles, markdownFiles);

  assert.deepEqual(associations.map(({ label, javascriptFile, markdownFile }) => [
    label,
    javascriptFile.relativePath,
    markdownFile.relativePath,
  ]), [
    ['POTENTIAL', 'src/auth.js', 'docs/AUTH.MD'],
    ['POTENTIAL', 'src/config.JS', 'docs/config.md'],
  ]);
  assert.deepEqual(unassociatedJavaScriptFiles.map((f) => f.relativePath), [
    'src/index.js',
    'src/unmatched.js',
  ]);
  assert.deepEqual(unassociatedMarkdownFiles.map((f) => f.relativePath), [
    'README.md',
    'docs/README.md',
    'docs/authentication.md',
  ]);
});

test('supports one-to-many filename matches and reports every match as potential', async () => {
  const javascriptFiles = [
    { name: 'auth.js', extension: '.js', relativePath: 'src/auth.js', absolutePath: '/project/src/auth.js' },
  ];
  const markdownFiles = [
    { name: 'auth.md', extension: '.md', relativePath: 'docs/auth.md', absolutePath: '/project/docs/auth.md' },
    { name: 'AUTH.MD', extension: '.MD', relativePath: 'guides/AUTH.MD', absolutePath: '/project/guides/AUTH.MD' },
  ];

  const results = createFileAssociations(javascriptFiles, markdownFiles);

  assert.equal(results.associations.length, 2);
  assert.ok(results.associations.every((association) => association.label === 'POTENTIAL'));
  assert.deepEqual(results.unassociatedJavaScriptFiles, []);
});

test('returns a visible scan error rather than reporting an incomplete scan as complete', async () => {
  const missingPath = join(tmpdir(), 'docguard-missing-identification-project');
  const results = await scanProjectFiles(missingPath);

  assert.equal(results.errors.length, 1);
  assert.equal(results.errors[0].absolutePath, resolve(missingPath));
  assert.match(results.errors[0].message, /disappeared or no longer exists/);
});

test('does not follow symbolic links to directories or files', async (testContext) => {
  const projectPath = await createTempDirectory(testContext);
  const nestedPath = join(projectPath, 'nested');
  await mkdir(nestedPath);
  await createFile(projectPath, 'source.js');
  await createFile(projectPath, 'nested/guide.md');
  await symlink(projectPath, join(nestedPath, 'cycle'));
  await symlink(join(projectPath, 'source.js'), join(projectPath, 'linked.js'));

  const results = await scanProjectFiles(projectPath);

  assert.deepEqual(results.javascriptFiles.map((file) => file.relativePath), ['source.js']);
  assert.deepEqual(results.markdownFiles.map((file) => file.relativePath), ['nested/guide.md']);
  assert.deepEqual(results.errors, []);
});

test('records nested permission errors instead of claiming a complete scan', async (testContext) => {
  if (typeof process.geteuid === 'function' && process.geteuid() === 0) {
    testContext.skip('The process runs as root and can bypass directory permission bits.');
    return;
  }

  const projectPath = await createTempDirectory(testContext);
  const inaccessiblePath = join(projectPath, 'private');
  await mkdir(inaccessiblePath);
  await createFile(projectPath, 'visible.js');

  try {
    await chmod(inaccessiblePath, 0);
    const results = await scanProjectFiles(projectPath);

    assert.equal(results.javascriptFiles.length, 1);
    assert.equal(results.errors.length, 1);
    assert.equal(results.errors[0].absolutePath, inaccessiblePath);
    assert.match(results.errors[0].message, /Permission denied/);
  } finally {
    await chmod(inaccessiblePath, 0o700);
  }
});

test('tracks unassociated Markdown files that have no matching JavaScript files', async () => {
  const javascriptFiles = [
    { name: 'auth.js', extension: '.js', relativePath: 'src/auth.js', absolutePath: '/project/src/auth.js' },
  ];
  const markdownFiles = [
    { name: 'auth.md', extension: '.md', relativePath: 'docs/auth.md', absolutePath: '/project/docs/auth.md' },
    { name: 'guide.md', extension: '.md', relativePath: 'docs/guide.md', absolutePath: '/project/docs/guide.md' },
    { name: 'CHANGELOG.md', extension: '.md', relativePath: 'CHANGELOG.md', absolutePath: '/project/CHANGELOG.md' },
  ];

  const results = createFileAssociations(javascriptFiles, markdownFiles);

  assert.equal(results.associations.length, 1);
  assert.deepEqual(results.unassociatedJavaScriptFiles, []);
  assert.deepEqual(results.unassociatedMarkdownFiles.map((f) => f.relativePath), [
    'docs/guide.md',
    'CHANGELOG.md',
  ]);
});

test('associates root index.js with root README.md', async () => {
  const javascriptFiles = [
    { name: 'index.js', extension: '.js', relativePath: 'index.js', absolutePath: '/project/index.js' },
  ];
  const markdownFiles = [
    { name: 'README.md', extension: '.md', relativePath: 'README.md', absolutePath: '/project/README.md' },
  ];

  const results = createFileAssociations(javascriptFiles, markdownFiles);

  assert.deepEqual(results.associations.map(({ javascriptFile, markdownFile }) => [
    javascriptFile.relativePath,
    markdownFile.relativePath,
  ]), [
    ['index.js', 'README.md'],
  ]);
  assert.deepEqual(results.unassociatedJavaScriptFiles, []);
  assert.deepEqual(results.unassociatedMarkdownFiles, []);
});

test('associates nested index.js with README.md in the same directory', async () => {
  const javascriptFiles = [
    { name: 'index.js', extension: '.js', relativePath: 'src/index.js', absolutePath: '/project/src/index.js' },
  ];
  const markdownFiles = [
    { name: 'README.md', extension: '.md', relativePath: 'src/README.md', absolutePath: '/project/src/README.md' },
    { name: 'README.md', extension: '.md', relativePath: 'README.md', absolutePath: '/project/README.md' },
  ];

  const results = createFileAssociations(javascriptFiles, markdownFiles);

  assert.deepEqual(results.associations.map(({ javascriptFile, markdownFile }) => [
    javascriptFile.relativePath,
    markdownFile.relativePath,
  ]), [
    ['src/index.js', 'src/README.md'],
  ]);
  assert.deepEqual(results.unassociatedJavaScriptFiles, []);
  assert.deepEqual(results.unassociatedMarkdownFiles.map((f) => f.relativePath), ['README.md']);
});

test('does not associate index.js with README.md in a different directory', async () => {
  const javascriptFiles = [
    { name: 'index.js', extension: '.js', relativePath: 'src/index.js', absolutePath: '/project/src/index.js' },
  ];
  const markdownFiles = [
    { name: 'README.md', extension: '.md', relativePath: 'docs/README.md', absolutePath: '/project/docs/README.md' },
  ];

  const results = createFileAssociations(javascriptFiles, markdownFiles);

  assert.deepEqual(results.associations, []);
  assert.deepEqual(results.unassociatedJavaScriptFiles, [javascriptFiles[0]]);
  assert.deepEqual(results.unassociatedMarkdownFiles, [markdownFiles[0]]);
});

test('returns empty unassociated collections when all files are matched', async () => {
  const javascriptFiles = [
    { name: 'auth.js', extension: '.js', relativePath: 'src/auth.js', absolutePath: '/project/src/auth.js' },
  ];
  const markdownFiles = [
    { name: 'auth.md', extension: '.md', relativePath: 'docs/auth.md', absolutePath: '/project/docs/auth.md' },
  ];

  const results = createFileAssociations(javascriptFiles, markdownFiles);

  assert.equal(results.associations.length, 1);
  assert.deepEqual(results.unassociatedJavaScriptFiles, []);
  assert.deepEqual(results.unassociatedMarkdownFiles, []);
});
