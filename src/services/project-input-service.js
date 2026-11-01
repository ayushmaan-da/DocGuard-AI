import { extname, win32 } from 'node:path';
import { HttpError } from '../utils/http-error.js';

const SOURCE_EXTENSIONS = new Set([
  '.bash', '.c', '.cc', '.cjs', '.cpp', '.cs', '.cts', '.cxx', '.dart', '.go',
  '.h', '.hpp', '.hxx', '.java', '.js', '.jsx', '.kt', '.kts', '.lua', '.m',
  '.mm', '.mts', '.mjs', '.php', '.pl', '.pm', '.ps1', '.py', '.pyi',
  '.rb', '.rs', '.scala', '.sc', '.sh', '.sql', '.swift', '.ts', '.tsx', '.vue',
  '.svelte', '.zsh',
]);
const DOCUMENTATION_EXTENSIONS = new Set([
  '.adoc', '.asciidoc', '.markdown', '.md', '.mdx', '.org', '.rst', '.txt',
]);

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function validateProjectPath(filePath, index) {
  if (typeof filePath !== 'string' || filePath.length === 0) {
    throw new HttpError(400, 'INVALID_FILE_PATH', `File at index ${index} must have a non-empty path.`);
  }

  const pathSegments = filePath.split('/');
  const isUnsafe = filePath.startsWith('/')
    || win32.isAbsolute(filePath)
    || /^[a-zA-Z]:/.test(filePath)
    || filePath.includes('\\')
    || filePath.includes(':')
    || /[\u0000-\u001f\u007f]/.test(filePath)
    || pathSegments.some((segment) => segment === '' || segment === '.' || segment === '..');

  if (isUnsafe) {
    throw new HttpError(400, 'UNSAFE_FILE_PATH', `File path "${filePath}" is not a safe relative path.`);
  }

  return filePath;
}

function classifyFile(filePath) {
  const extension = extname(filePath).toLowerCase();

  if (SOURCE_EXTENSIONS.has(extension)) {
    return 'source';
  }

  const fileName = filePath.split('/').at(-1);
  if (
    DOCUMENTATION_EXTENSIONS.has(extension)
    || /^readme(?:\..*)?$/i.test(fileName)
  ) {
    return 'documentation';
  }

  return 'other';
}

export function processProjectInput(input) {
  if (!isRecord(input) || !isRecord(input.project)) {
    throw new HttpError(400, 'INVALID_PROJECT', 'Request body must contain a project object.');
  }

  const { name, files } = input.project;
  if (typeof name !== 'string' || name.trim().length === 0) {
    throw new HttpError(400, 'INVALID_PROJECT_NAME', 'Project name must be a non-empty string.');
  }

  if (!Array.isArray(files)) {
    throw new HttpError(400, 'INVALID_PROJECT_FILES', 'Project files must be an array.');
  }

  const seenPaths = new Set();
  const processedFiles = files.map((file, index) => {
    if (!isRecord(file)) {
      throw new HttpError(400, 'INVALID_FILE', `File at index ${index} must be an object.`);
    }

    const filePath = validateProjectPath(file.path, index);
    if (seenPaths.has(filePath)) {
      throw new HttpError(400, 'DUPLICATE_FILE_PATH', `Project contains duplicate file path "${filePath}".`);
    }
    seenPaths.add(filePath);

    if (typeof file.content !== 'string') {
      throw new HttpError(400, 'INVALID_FILE_CONTENT', `Content for "${filePath}" must be a string.`);
    }

    return {
      path: filePath,
      content: file.content,
      category: classifyFile(filePath),
    };
  });

  return {
    project: {
      name,
      files: processedFiles,
    },
  };
}
