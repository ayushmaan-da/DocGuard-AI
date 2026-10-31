import { lstat, readdir } from 'node:fs/promises';
import { dirname, extname, join, relative, resolve, sep } from 'node:path';

const EXCLUDED_DIRECTORIES = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  'coverage',
]);

function createScanError(error, absolutePath) {
  let message;

  if (error.code === 'EACCES' || error.code === 'EPERM') {
    message = 'Permission denied while accessing this path.';
  } else if (error.code === 'ENOENT') {
    message = 'This path disappeared or no longer exists during the scan.';
  } else if (error.code === 'ENOTDIR') {
    message = 'This path is no longer a directory.';
  } else {
    message = `Could not access this path: ${error.message}`;
  }

  return { absolutePath, message };
}

function createFileEntry(projectPath, absolutePath, name) {
  return {
    name,
    relativePath: relative(projectPath, absolutePath).split(sep).join('/'),
    absolutePath,
    extension: extname(name),
  };
}

function compareFilePaths(first, second) {
  if (first.relativePath < second.relativePath) {
    return -1;
  }
  if (first.relativePath > second.relativePath) {
    return 1;
  }
  return 0;
}

async function collectProjectFiles(projectPath, directoryPath, results, seenFiles) {
  let entries;

  try {
    entries = await readdir(directoryPath, { withFileTypes: true });
  } catch (error) {
    results.errors.push(createScanError(error, directoryPath));
    return;
  }

  for (const entry of entries) {
    const absolutePath = join(directoryPath, entry.name);

    if (entry.isSymbolicLink()) {
      // Skipping links prevents directory cycles and avoids following file links.
      continue;
    }

    if (entry.isDirectory()) {
      if (EXCLUDED_DIRECTORIES.has(entry.name.toLowerCase())) {
        continue;
      }

      try {
        const entryStats = await lstat(absolutePath);
        if (entryStats.isDirectory() && !entryStats.isSymbolicLink()) {
          await collectProjectFiles(projectPath, absolutePath, results, seenFiles);
        }
      } catch (error) {
        results.errors.push(createScanError(error, absolutePath));
      }

      continue;
    }

    if (!entry.isFile()) {
      continue;
    }

    const extension = extname(entry.name).toLowerCase();
    if (extension !== '.js' && extension !== '.md') {
      continue;
    }

    try {
      const entryStats = await lstat(absolutePath);
      if (!entryStats.isFile() || entryStats.isSymbolicLink() || seenFiles.has(absolutePath)) {
        continue;
      }

      seenFiles.add(absolutePath);
    } catch (error) {
      results.errors.push(createScanError(error, absolutePath));
      continue;
    }

    const fileEntry = createFileEntry(projectPath, absolutePath, entry.name);

    if (extension === '.js') {
      results.javascriptFiles.push(fileEntry);
    } else {
      results.markdownFiles.push(fileEntry);
    }
  }
}

export async function scanProjectFiles(directoryPath) {
  const projectPath = resolve(directoryPath);
  const results = {
    projectPath,
    javascriptFiles: [],
    markdownFiles: [],
    errors: [],
  };

  await collectProjectFiles(projectPath, projectPath, results, new Set());

  results.javascriptFiles.sort(compareFilePaths);
  results.markdownFiles.sort(compareFilePaths);

  return results;
}
