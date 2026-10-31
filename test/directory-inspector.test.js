import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { inspectDirectory, validateDirectoryPath } from '../src/directory-inspector.js';

async function createTempDirectory(testContext) {
  const directoryPath = await mkdtemp(join(tmpdir(), 'docguard-directory-'));
  testContext.after(() => rm(directoryPath, { recursive: true, force: true }));
  return directoryPath;
}

test('validates a directory path and returns its absolute path', async (testContext) => {
  const directoryPath = await createTempDirectory(testContext);

  assert.equal(await validateDirectoryPath(directoryPath), resolve(directoryPath));
});

test('preserves valid directory paths with leading and trailing spaces', async (testContext) => {
  if (process.platform === 'win32') {
    testContext.skip('Windows does not support trailing spaces in directory names.');
    return;
  }

  const parentPath = await createTempDirectory(testContext);
  const directoryPath = join(parentPath, ' project directory ');
  await mkdir(directoryPath);

  assert.equal(await validateDirectoryPath(directoryPath), resolve(directoryPath));
});

test('rejects a directory path that does not exist', async () => {
  await assert.rejects(
    validateDirectoryPath(join(tmpdir(), 'docguard-directory-that-does-not-exist')),
    /Directory does not exist:/,
  );
});

test('rejects a file path instead of a directory', async (testContext) => {
  const directoryPath = await createTempDirectory(testContext);
  const filePath = join(directoryPath, 'file.txt');
  await writeFile(filePath, 'not a directory');

  await assert.rejects(validateDirectoryPath(filePath), /Path is not a directory:/);
});

test('rejects an empty directory path', async () => {
  await assert.rejects(validateDirectoryPath('  '), /Please enter a project directory path\./);
});

test('rejects non-string directory paths with a clear error', async () => {
  await assert.rejects(validateDirectoryPath(null), {
    name: 'TypeError',
    message: 'Project directory path must be a string.',
  });
});

test('counts only immediate files and folders', async (testContext) => {
  const directoryPath = await createTempDirectory(testContext);
  const nestedFolderPath = join(directoryPath, 'nested');
  await mkdir(nestedFolderPath);
  await writeFile(join(directoryPath, 'first.txt'), 'first');
  await writeFile(join(directoryPath, 'second.txt'), 'second');
  await writeFile(join(nestedFolderPath, 'nested.txt'), 'nested');

  assert.deepEqual(await inspectDirectory(directoryPath), {
    absolutePath: directoryPath,
    fileCount: 2,
    folderCount: 1,
  });
});

test('reports an empty directory with zero files and folders', async (testContext) => {
  const directoryPath = await createTempDirectory(testContext);

  assert.deepEqual(await inspectDirectory(directoryPath), {
    absolutePath: directoryPath,
    fileCount: 0,
    folderCount: 0,
  });
});

test('reports filesystem errors when directory inspection fails', async () => {
  const missingPath = join(tmpdir(), 'docguard-directory-that-does-not-exist');

  await assert.rejects(inspectDirectory(missingPath), /Directory does not exist:/);
});
