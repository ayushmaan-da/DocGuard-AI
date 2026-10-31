import { readdir, stat } from 'node:fs/promises';
import { resolve } from 'node:path';

function describeFileSystemError(error, absolutePath) {
  if (error.code === 'ENOENT') {
    return new Error(`Directory does not exist: ${absolutePath}`);
  }

  if (error.code === 'EACCES' || error.code === 'EPERM') {
    return new Error(`Permission denied while accessing: ${absolutePath}`);
  }

  if (error.code === 'ENOTDIR') {
    return new Error(`Path is not a directory: ${absolutePath}`);
  }

  return new Error(`Could not access "${absolutePath}": ${error.message}`);
}

export async function validateDirectoryPath(directoryPath) {
  if (typeof directoryPath !== 'string') {
    throw new TypeError('Project directory path must be a string.');
  }

  if (!directoryPath.trim()) {
    throw new Error('Please enter a project directory path.');
  }

  const absolutePath = resolve(directoryPath);
  let directoryStats;

  try {
    directoryStats = await stat(absolutePath);
  } catch (error) {
    throw describeFileSystemError(error, absolutePath);
  }

  if (!directoryStats.isDirectory()) {
    throw new Error(`Path is not a directory: ${absolutePath}`);
  }

  return absolutePath;
}

export async function inspectDirectory(absolutePath) {
  let entries;

  try {
    entries = await readdir(absolutePath, { withFileTypes: true });
  } catch (error) {
    throw describeFileSystemError(error, absolutePath);
  }

  return {
    absolutePath,
    fileCount: entries.filter((entry) => entry.isFile()).length,
    folderCount: entries.filter((entry) => entry.isDirectory()).length,
  };
}
