import { createHash } from 'node:crypto';
import { extname } from 'node:path';
import { processProjectInput } from './project-input-service.js';
import {
  extractPdfDocument,
  getPdfLimits,
  getStoredUploadedPdfDocuments,
  storePdfDocuments,
} from './pdf-document-service.js';
import { HttpError } from '../utils/http-error.js';
import { parseGitHubRepositoryUrl, validateGitHubRef } from '../utils/github-repository-url.js';

const DEFAULT_LIMITS = {
  maxFiles: 50,
  maxFileBytes: 1024 * 1024,
  maxRepositoryBytes: 10 * 1024 * 1024,
  maxApiResponseBytes: 12 * 1024 * 1024,
  requestTimeoutMs: 10_000,
};

const EXCLUDED_DIRECTORIES = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  'coverage',
  '.next',
  'out',
  'target',
  '.cache',
  '.turbo',
]);
const BINARY_EXTENSIONS = new Set([
  '.7z', '.a', '.avi', '.bin', '.bmp', '.class', '.dll', '.doc', '.docx',
  '.eot', '.exe', '.gif', '.gz', '.ico', '.jar', '.jpeg', '.jpg', '.mp3',
  '.mp4', '.o', '.odt', '.pdf', '.png', '.ppt', '.pptx', '.rar', '.so',
  '.sqlite', '.tar', '.tif', '.tiff', '.wasm', '.webm', '.webp',
  '.woff', '.woff2', '.xls', '.xlsx', '.zip',
]);
const SOURCE_CODE_EXTENSIONS = new Set([
  '.asm', '.bash', '.bat', '.c', '.cc', '.cjs', '.clj', '.cljs', '.cljc',
  '.cmd', '.cpp', '.cs', '.cts', '.cxx', '.dart', '.ex', '.exs', '.erl',
  '.fs', '.fsi', '.fsx', '.go', '.gradle', '.groovy', '.h', '.hpp', '.hrl',
  '.hs', '.java', '.jl', '.js', '.jsx', '.kt', '.kts', '.lua', '.m', '.mm',
  '.mts', '.mjs', '.nim', '.nix', '.php', '.pl', '.pm', '.ps1', '.psm1',
  '.py', '.pyi', '.r', '.rb', '.rs', '.scala', '.sc', '.sh', '.sql', '.swift',
  '.tcl', '.ts', '.tsx', '.v', '.vhd', '.vhdl', '.vue', '.sv', '.svelte',
  '.zsh',
]);
const DOCUMENTATION_EXTENSIONS = new Set([
  '.adoc', '.asciidoc', '.markdown', '.md', '.mdx', '.org', '.rst', '.txt',
]);
const UTF8_DECODER = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });

function readLimit(environmentName, defaultValue) {
  const value = process.env[environmentName];
  if (value === undefined || value === '') {
    return defaultValue;
  }

  const parsedValue = Number(value);
  if (!Number.isSafeInteger(parsedValue) || parsedValue < 1) {
    throw new Error(`${environmentName} must be a positive safe integer.`);
  }

  return parsedValue;
}

function getLimits() {
  return {
    maxFiles: readLimit('GITHUB_MAX_FILES', DEFAULT_LIMITS.maxFiles),
    maxFileBytes: readLimit('GITHUB_MAX_FILE_BYTES', DEFAULT_LIMITS.maxFileBytes),
    maxRepositoryBytes: readLimit('GITHUB_MAX_REPOSITORY_BYTES', DEFAULT_LIMITS.maxRepositoryBytes),
    maxApiResponseBytes: readLimit('GITHUB_MAX_API_RESPONSE_BYTES', DEFAULT_LIMITS.maxApiResponseBytes),
    requestTimeoutMs: readLimit('GITHUB_REQUEST_TIMEOUT_MS', DEFAULT_LIMITS.requestTimeoutMs),
  };
}

function isExcludedPath(filePath) {
  return filePath.split('/').some((segment) => EXCLUDED_DIRECTORIES.has(segment.toLowerCase()));
}

function createSkippedFile(entry, reason) {
  return {
    path: typeof entry?.path === 'string' ? entry.path : null,
    ...(Number.isSafeInteger(entry?.size) ? { size: entry.size } : {}),
    ...(typeof entry?.sha === 'string' ? { sha: entry.sha } : {}),
    ...(typeof entry?.mode === 'string' ? { mode: entry.mode } : {}),
    reason,
  };
}

function startsWithBytes(bytes, signature) {
  return signature.every((byte, index) => bytes[index] === byte);
}

function hasBinarySignature(bytes) {
  return startsWithBytes(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    || startsWithBytes(bytes, [0xff, 0xd8, 0xff])
    || startsWithBytes(bytes, [0x47, 0x49, 0x46, 0x38])
    || startsWithBytes(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d])
    || startsWithBytes(bytes, [0x50, 0x4b, 0x03, 0x04])
    || startsWithBytes(bytes, [0x50, 0x4b, 0x05, 0x06])
    || startsWithBytes(bytes, [0x1f, 0x8b])
    || startsWithBytes(bytes, [0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c])
    || startsWithBytes(bytes, [0x52, 0x61, 0x72, 0x21, 0x1a, 0x07])
    || startsWithBytes(bytes, [0x7f, 0x45, 0x4c, 0x46])
    || startsWithBytes(bytes, [0x4d, 0x5a])
    || startsWithBytes(bytes, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])
    || startsWithBytes(bytes, [0x53, 0x51, 0x4c, 0x69, 0x74, 0x65, 0x20, 0x66])
    || startsWithBytes(bytes, [0x42, 0x4d])
    || startsWithBytes(bytes, [0x49, 0x44, 0x33])
    || startsWithBytes(bytes, [0x00, 0x61, 0x73, 0x6d])
    || (bytes.length >= 12
      && bytes.toString('ascii', 0, 4) === 'RIFF'
      && bytes.toString('ascii', 8, 12) === 'WEBP')
    || (bytes.length >= 8 && bytes.toString('ascii', 4, 8) === 'ftyp');
}

function isDocumentationPath(filePath) {
  const fileName = filePath.split('/').at(-1);
  return DOCUMENTATION_EXTENSIONS.has(extname(filePath).toLowerCase())
    || /^readme(?:\..*)?$/i.test(fileName);
}

export function classifyGitHubPath(filePath) {
  const extension = extname(filePath).toLowerCase();
  if (BINARY_EXTENSIONS.has(extension)) {
    return 'binary';
  }
  if (isDocumentationPath(filePath)) {
    return 'documentation';
  }
  if (SOURCE_CODE_EXTENSIONS.has(extension)) {
    return 'source';
  }
  return 'other';
}

function inspectFileContent(entry, bytes) {
  if (hasBinarySignature(bytes)) {
    return { classification: 'binary', text: null, reason: 'known-binary-signature' };
  }

  let text;
  try {
    text = UTF8_DECODER.decode(bytes);
  } catch {
    if (BINARY_EXTENSIONS.has(extname(entry.path).toLowerCase())) {
      return { classification: 'binary', text: null, reason: 'binary-file-extension' };
    }

    const printableBytes = bytes.reduce((count, byte) => (
      byte === 9 || byte === 10 || byte === 13 || (byte >= 32 && byte !== 127 && byte < 127)
        || byte >= 0xa0
        ? count + 1
        : count
    ), 0);
    const printableRatio = bytes.length === 0 ? 1 : printableBytes / bytes.length;

    if (printableRatio >= 0.85 && !bytes.includes(0)) {
      return { classification: 'non-utf8-text', text: null, reason: 'not-valid-utf8' };
    }

    if (BINARY_EXTENSIONS.has(extname(entry.path).toLowerCase())
      || bytes.includes(0)
      || printableRatio < 0.65) {
      return { classification: 'binary', text: null, reason: 'binary-content' };
    }

    return { classification: 'uncertain', text: null, reason: 'ambiguous-non-utf8-content' };
  }

  const disallowedControls = [...text].filter((character) => {
    const codePoint = character.codePointAt(0);
    return codePoint < 32 && codePoint !== 9 && codePoint !== 10 && codePoint !== 12 && codePoint !== 13;
  }).length;
  if (disallowedControls > 0) {
    return { classification: 'uncertain', text: null, reason: 'text-contains-control-characters' };
  }

  if (BINARY_EXTENSIONS.has(extname(entry.path).toLowerCase())) {
    return { classification: 'uncertain', text: null, reason: 'binary-extension-with-text-content' };
  }

  return { classification: 'utf8-text', text, reason: null };
}

function getHandoffClassification(filePath, inspection) {
  if (inspection.classification !== 'utf8-text') {
    return inspection.classification;
  }
  if (isDocumentationPath(filePath)) {
    return 'documentation';
  }
  if (SOURCE_CODE_EXTENSIONS.has(extname(filePath).toLowerCase())) {
    return 'source';
  }
  return 'uncertain';
}

function createUpstreamError(response, context) {
  if (response.status === 404) {
    return new HttpError(404, 'GITHUB_RESOURCE_NOT_FOUND', `${context} was not found or is not public.`);
  }

  if (response.status === 403 || response.status === 429) {
    return new HttpError(503, 'GITHUB_RATE_LIMITED', 'GitHub refused the request or its unauthenticated API rate limit was reached.');
  }

  return new HttpError(502, 'GITHUB_UPSTREAM_ERROR', `GitHub could not provide the requested ${context}.`);
}

async function readResponseBytes(response, maximumBytes) {
  const declaredLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > maximumBytes) {
    await response.body?.cancel();
    throw new HttpError(502, 'GITHUB_RESPONSE_TOO_LARGE', 'GitHub returned a response that exceeds the configured response limit.');
  }

  if (!response.body) {
    return Buffer.alloc(0);
  }

  const reader = response.body.getReader();
  const chunks = [];
  let totalBytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }

      totalBytes += value.byteLength;
      if (totalBytes > maximumBytes) {
        await reader.cancel();
        throw new HttpError(502, 'GITHUB_RESPONSE_TOO_LARGE', 'GitHub returned a response that exceeds the configured response limit.');
      }

      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }

  return Buffer.concat(chunks, totalBytes);
}

async function fetchGitHubJson(url, { fetchImpl, limits, context }) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), limits.requestTimeoutMs);

  try {
    let response;
    try {
      response = await fetchImpl(url, {
        headers: {
          Accept: 'application/vnd.github+json',
          'User-Agent': 'DocGuard-AI',
          'X-GitHub-Api-Version': '2022-11-28',
        },
        redirect: 'error',
        signal: controller.signal,
      });
    } catch {
      if (controller.signal.aborted) {
        throw new HttpError(504, 'GITHUB_REQUEST_TIMEOUT', 'The request to GitHub timed out.');
      }
      throw new HttpError(502, 'GITHUB_NETWORK_ERROR', 'Could not connect to GitHub.');
    }

    if (!response.ok) {
      await response.body?.cancel();
      throw createUpstreamError(response, context);
    }

    let responseBytes;
    try {
      responseBytes = await readResponseBytes(response, limits.maxApiResponseBytes);
    } catch (error) {
      if (error instanceof HttpError) {
        throw error;
      }
      if (controller.signal.aborted) {
        throw new HttpError(504, 'GITHUB_REQUEST_TIMEOUT', 'The request to GitHub timed out.');
      }
      throw new HttpError(502, 'GITHUB_NETWORK_ERROR', 'Could not read the response from GitHub.');
    }

    try {
      return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(responseBytes));
    } catch {
      throw new HttpError(502, 'INVALID_GITHUB_RESPONSE', 'GitHub returned an invalid JSON response.');
    }
  } finally {
    clearTimeout(timeout);
  }
}

function getRepositoryFileEntries(tree, limits) {
  if (
    tree === null
    || typeof tree !== 'object'
    || !Array.isArray(tree.tree)
    || typeof tree.truncated !== 'boolean'
  ) {
    throw new HttpError(502, 'INVALID_GITHUB_TREE', 'GitHub returned an invalid repository tree.');
  }

  if (tree.truncated) {
    throw new HttpError(413, 'REPOSITORY_TREE_TOO_LARGE', 'GitHub truncated the repository tree; the repository exceeds the supported size.');
  }

  const blobEntries = tree.tree.filter((entry) => entry?.type === 'blob');
  const fileEntriesForValidation = tree.tree.filter((entry) =>
    entry?.type === 'blob' || entry?.type === 'commit');
  processProjectInput({
    project: {
      name: 'github-repository',
      files: fileEntriesForValidation.map((entry) => ({ path: entry.path, content: '' })),
    },
  });

  const fileEntries = [];
  const skippedFiles = [];
  for (const entry of tree.tree) {
    if (entry?.type === 'blob') {
      if (isExcludedPath(entry.path)) {
        skippedFiles.push(createSkippedFile(entry, 'excluded-directory'));
      } else if (entry.mode === '120000') {
        skippedFiles.push(createSkippedFile(entry, 'symbolic-link'));
      } else if (entry.mode !== '100644' && entry.mode !== '100755') {
        skippedFiles.push(createSkippedFile(entry, 'unsupported-git-file-mode'));
      } else {
        fileEntries.push(entry);
      }
    } else if (entry?.type === 'commit') {
      skippedFiles.push(createSkippedFile(entry, 'submodule'));
    } else if (entry?.type !== 'tree') {
      skippedFiles.push(createSkippedFile(entry, 'unsupported-tree-entry'));
    }
  }

  if (fileEntries.length > limits.maxFiles) {
    throw new HttpError(413, 'REPOSITORY_FILE_LIMIT_EXCEEDED', `Repository contains more than the supported ${limits.maxFiles} files.`);
  }

  const paths = new Set();
  for (const entry of fileEntries) {
    if (paths.has(entry.path)) {
      throw new HttpError(400, 'DUPLICATE_FILE_PATH', `Repository contains duplicate file path "${entry.path}".`);
    }
    paths.add(entry.path);

    if (!Number.isSafeInteger(entry.size) || entry.size < 0) {
      throw new HttpError(502, 'INVALID_GITHUB_TREE', `GitHub returned an invalid file size for "${entry.path}".`);
    }
    if (entry.size > limits.maxFileBytes) {
      throw new HttpError(413, 'REPOSITORY_FILE_TOO_LARGE', `Repository file "${entry.path}" exceeds the configured per-file size limit.`);
    }
  }

  return { fileEntries, skippedFiles };
}

function decodeBlobBytes(blob, expectedSize, filePath, expectedSha) {
  if (
    blob === null
    || typeof blob !== 'object'
    || blob.encoding !== 'base64'
    || typeof blob.content !== 'string'
  ) {
    throw new HttpError(502, 'INVALID_GITHUB_BLOB', `GitHub returned unsupported content for "${filePath}".`);
  }
  if (
    !Number.isSafeInteger(blob.size)
    || blob.size !== expectedSize
    || blob.sha !== expectedSha
  ) {
    throw new HttpError(502, 'INVALID_GITHUB_BLOB', `GitHub returned inconsistent metadata for "${filePath}".`);
  }

  const base64Content = blob.content.replace(/\s/g, '');
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(base64Content)) {
    throw new HttpError(502, 'INVALID_GITHUB_BLOB', `GitHub returned invalid encoded content for "${filePath}".`);
  }

  const bytes = Buffer.from(base64Content, 'base64');
  if (bytes.length !== expectedSize) {
    throw new HttpError(502, 'INVALID_GITHUB_BLOB', `GitHub returned an incomplete file for "${filePath}".`);
  }

  const hashAlgorithm = expectedSha.length === 64 ? 'sha256' : 'sha1';
  const calculatedSha = createHash(hashAlgorithm)
    .update(`blob ${bytes.length}\0`)
    .update(bytes)
    .digest('hex');
  if (calculatedSha !== expectedSha.toLowerCase()) {
    throw new HttpError(502, 'INVALID_GITHUB_BLOB', `GitHub returned content that does not match the repository blob identifier for "${filePath}".`);
  }

  return bytes;
}

function createProjectSummary(projectFiles, unsupportedAssets, pdfDocumentationCount = 0) {
  const sourceFiles = projectFiles.filter((file) => file.category === 'source').length;
  const documentationFiles = projectFiles.filter((file) => file.category === 'documentation').length
    + pdfDocumentationCount;
  const otherFiles = projectFiles.filter((file) => file.category === 'other').length;

  return {
    totalFiles: projectFiles.length + unsupportedAssets.length + pdfDocumentationCount,
    sourceFiles,
    documentationFiles,
    otherFiles,
  };
}

function isReadmeFile(filePath) {
  const fileName = filePath.split('/').at(-1);
  return /^readme(?:\..*)?$/i.test(fileName);
}

function selectReadme(files) {
  return files
    .filter((file) => file.category === 'documentation' && isReadmeFile(file.path))
    .sort((left, right) => {
      const leftIsRootReadme = !left.path.includes('/');
      const rightIsRootReadme = !right.path.includes('/');
      if (leftIsRootReadme !== rightIsRootReadme) {
        return leftIsRootReadme ? -1 : 1;
      }

      const leftNormalizedPath = left.path.toLowerCase();
      const rightNormalizedPath = right.path.toLowerCase();
      if (leftNormalizedPath !== rightNormalizedPath) {
        return leftNormalizedPath < rightNormalizedPath ? -1 : 1;
      }

      return left.path < right.path ? -1 : left.path > right.path ? 1 : 0;
    })[0];
}

function prepareTextDocuments(files, source) {
  return {
    format: 'text/plain',
    source,
    files: files.map((file) => ({
      path: `${file.path}.txt`,
      sourcePath: file.path,
      content: file.content,
      originalBytesBase64: Buffer.from(file.content, 'utf8').toString('base64'),
    })),
  };
}

function validateSeparateDocumentation(documentation) {
  if (documentation === undefined) {
    return [];
  }
  if (!Array.isArray(documentation)) {
    throw new HttpError(400, 'INVALID_DOCUMENTATION', 'documentation must be an array of files with path and content fields.');
  }
  if (documentation.some((file) => (
    file !== null
    && typeof file === 'object'
    && typeof file.path === 'string'
    && extname(file.path).toLowerCase() === '.pdf'
  ))) {
    throw new HttpError(415, 'PDF_DOCUMENTATION_NOT_SUPPORTED', 'PDF documentation upload and text extraction are not supported yet.');
  }

  const processedInput = processProjectInput({
    project: {
      name: 'provided-documentation',
      files: documentation,
    },
  });
  return processedInput.project.files;
}

function getDocumentationSource(uploadedPdfs, repositoryPdfs, providedText) {
  const sources = [
    ...(uploadedPdfs.length > 0 ? ['uploaded'] : []),
    ...(repositoryPdfs.length > 0 ? ['github'] : []),
    ...(providedText.length > 0 ? ['provided'] : []),
  ];
  if (sources.length > 1) {
    return 'mixed';
  }
  if (sources[0] === 'uploaded') {
    return 'uploaded';
  }
  if (sources[0] === 'github') {
    return 'github';
  }
  return sources[0] ?? 'missing';
}

export async function ingestGitHubRepository(input, {
  fetchImpl = globalThis.fetch,
  limits = getLimits(),
  documentationOnly = false,
} = {}) {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    throw new HttpError(400, 'INVALID_REQUEST', 'Request body must be a JSON object.');
  }

  const repository = parseGitHubRepositoryUrl(input.repositoryUrl);
  const separateDocumentation = validateSeparateDocumentation(input.documentation);
  const uploadedPdfDocuments = getStoredUploadedPdfDocuments(input.uploadedDocumentIds);
  const pdfLimits = getPdfLimits();
  if (input.ref !== undefined) {
    validateGitHubRef(input.ref);
  }

  const apiBase = `https://api.github.com/repos/${repository.owner}/${repository.repository}`;
  const metadata = await fetchGitHubJson(apiBase, {
    fetchImpl,
    limits,
    context: 'repository',
  });
  if (metadata === null || typeof metadata !== 'object' || Array.isArray(metadata)) {
    throw new HttpError(502, 'INVALID_GITHUB_REPOSITORY', 'GitHub returned invalid repository metadata.');
  }
  if (metadata.private === true) {
    throw new HttpError(404, 'GITHUB_REPOSITORY_NOT_FOUND', 'Repository was not found or is not public.');
  }
  if (typeof metadata.private !== 'boolean') {
    throw new HttpError(502, 'INVALID_GITHUB_REPOSITORY', 'GitHub returned invalid repository visibility metadata.');
  }

  const ref = input.ref ?? metadata.default_branch;
  if (typeof ref !== 'string' || ref.length === 0) {
    throw new HttpError(502, 'INVALID_GITHUB_REPOSITORY', 'GitHub did not provide a valid default branch.');
  }
  validateGitHubRef(ref);

  const commit = await fetchGitHubJson(
    `${apiBase}/commits/${encodeURIComponent(ref)}`,
    { fetchImpl, limits, context: 'repository ref' },
  );
  if (commit === null || typeof commit !== 'object' || Array.isArray(commit)) {
    throw new HttpError(502, 'INVALID_GITHUB_COMMIT', 'GitHub returned invalid commit metadata.');
  }
  if (typeof commit.sha !== 'string' || !/^[a-f0-9]{40,64}$/i.test(commit.sha)) {
    throw new HttpError(502, 'INVALID_GITHUB_COMMIT', 'GitHub returned an invalid commit identifier.');
  }

  const treeSha = commit.commit?.tree?.sha;
  if (typeof treeSha !== 'string' || !/^[a-f0-9]{40,64}$/i.test(treeSha)) {
    throw new HttpError(502, 'INVALID_GITHUB_COMMIT', 'GitHub returned an invalid repository tree identifier.');
  }

  const tree = await fetchGitHubJson(`${apiBase}/git/trees/${treeSha}?recursive=1`, {
    fetchImpl,
    limits,
    context: 'repository tree',
  });
  const selectedTree = documentationOnly && Array.isArray(tree?.tree)
    ? {
      ...tree,
      tree: tree.tree.filter((entry) => (
        entry?.type !== 'blob'
        || typeof entry.path !== 'string'
        || isDocumentationPath(entry.path)
        || extname(entry.path).toLowerCase() === '.pdf'
      )),
    }
    : tree;
  const { fileEntries, skippedFiles } = getRepositoryFileEntries(selectedTree, limits);

  const files = [];
  const sourceFiles = [];
  const originalFiles = [];
  const documentationFiles = [];
  const binaryFiles = [];
  const uncertainFiles = [];
  const nonUtf8Files = [];
  const unsupportedAssets = [];
  const pendingRepositoryPdfs = [];
  const repositoryBlobBytes = new Map();
  let repositoryBytes = 0;
  let repositoryPdfTextCharacters = 0;

  async function retrieveRepositoryFileBytes(entry, context) {
    const blobSha = entry.sha.toLowerCase();
    const cachedBytes = repositoryBlobBytes.get(blobSha);
    if (cachedBytes) {
      if (cachedBytes.length !== entry.size) {
        throw new HttpError(502, 'INVALID_GITHUB_BLOB', `GitHub returned inconsistent sizes for "${entry.path}".`);
      }
      return cachedBytes;
    }

    const blob = await fetchGitHubJson(`${apiBase}/git/blobs/${entry.sha}`, {
      fetchImpl,
      limits,
      context,
    });
    const bytes = decodeBlobBytes(blob, entry.size, entry.path, entry.sha);
    repositoryBlobBytes.set(blobSha, bytes);
    return bytes;
  }

  for (const entry of fileEntries) {
    repositoryBytes += entry.size;
    if (repositoryBytes > limits.maxRepositoryBytes) {
      throw new HttpError(413, 'REPOSITORY_SIZE_LIMIT_EXCEEDED', 'Repository files exceed the configured total size limit.');
    }

    if (typeof entry.sha !== 'string' || !/^[a-f0-9]{40,64}$/i.test(entry.sha)) {
      throw new HttpError(502, 'INVALID_GITHUB_TREE', `GitHub returned an invalid blob identifier for "${entry.path}".`);
    }

    if (extname(entry.path).toLowerCase() === '.pdf') {
      const bytes = await retrieveRepositoryFileBytes(entry, 'repository PDF');
      const pdfDocument = await extractPdfDocument(bytes, {
        filename: entry.path.split('/').at(-1),
        path: entry.path,
        source: 'github',
        maxFileBytes: limits.maxFileBytes,
        maxPages: pdfLimits.maxPages,
        extractionTimeoutMs: pdfLimits.extractionTimeoutMs,
        maxExtractedTextCharacters: pdfLimits.maxExtractedTextCharacters,
      });
      repositoryPdfTextCharacters += pdfDocument.document.extractedText.length;
      if (repositoryPdfTextCharacters > pdfLimits.maxAggregateTextCharacters) {
        throw new HttpError(413, 'PDF_AGGREGATE_TEXT_LIMIT_EXCEEDED', 'Repository PDFs contain more extracted text than the configured combined limit.');
      }
      pendingRepositoryPdfs.push(pdfDocument);
      originalFiles.push({
        path: entry.path,
        size: entry.size,
        sha: entry.sha,
        mode: entry.mode,
        classification: 'pdf-documentation',
        contentRetrieved: true,
        reason: null,
      });
      continue;
    }

    const bytes = await retrieveRepositoryFileBytes(entry, 'repository file');
    const inspection = inspectFileContent(entry, bytes);
    const handoffClassification = getHandoffClassification(entry.path, inspection);
    const originalBytesBase64 = bytes.toString('base64');
    const originalFile = {
      path: entry.path,
      size: entry.size,
      sha: entry.sha,
      mode: entry.mode,
      classification: handoffClassification,
      contentRetrieved: true,
      reason: inspection.reason,
    };
    originalFiles.push(originalFile);

    if (handoffClassification === 'binary') {
      const unsupportedFile = {
        path: entry.path,
        size: entry.size,
        sha: entry.sha,
        mode: entry.mode,
        classification: 'binary',
        reason: inspection.reason,
      };
      binaryFiles.push(unsupportedFile);
      unsupportedAssets.push(unsupportedFile);
      skippedFiles.push({ path: entry.path, reason: 'binary-not-in-text-handoff' });
      continue;
    }

    if (handoffClassification === 'non-utf8-text') {
      const nonUtf8File = {
        path: entry.path,
        size: entry.size,
        sha: entry.sha,
        mode: entry.mode,
        classification: 'non-utf8-text',
        contentRetrieved: true,
        reason: inspection.reason,
      };
      nonUtf8Files.push(nonUtf8File);
      unsupportedAssets.push(nonUtf8File);
      skippedFiles.push({ path: entry.path, reason: 'non-utf8-text-not-in-text-handoff' });
      continue;
    }

    if (handoffClassification === 'uncertain') {
      const uncertainFile = {
        path: entry.path,
        size: entry.size,
        sha: entry.sha,
        mode: entry.mode,
        classification: 'uncertain',
        contentRetrieved: true,
        reason: isDocumentationPath(entry.path)
          ? inspection.reason
          : 'unrecognized-file-type',
      };
      uncertainFiles.push(uncertainFile);
      unsupportedAssets.push(uncertainFile);
      skippedFiles.push({ path: entry.path, reason: uncertainFile.reason });
      continue;
    }

    files.push({
      path: entry.path,
      content: inspection.text,
      originalBytesBase64,
      classification: handoffClassification,
    });
  }

  const project = processProjectInput({
    project: {
      name: repository.repository,
      files: files.map(({ path, content }) => ({ path, content })),
    },
  });
  const processedFiles = project.project.files.map((file) => {
    const originalFile = files.find((candidate) => candidate.path === file.path);
    const category = originalFile.classification;
    const result = { ...file, category };
    if (category === 'source') {
      sourceFiles.push({
        path: file.path,
        content: file.content,
        contentEncoding: 'utf-8',
        originalBytesBase64: originalFile.originalBytesBase64,
        classification: 'utf8-text',
      });
    } else {
      documentationFiles.push({
        path: file.path,
        content: file.content,
        originalBytesBase64: originalFile.originalBytesBase64,
        classification: 'documentation',
      });
    }
    return result;
  });
  project.project.files = processedFiles;
  const repositoryPdfDocuments = documentationOnly
    ? pendingRepositoryPdfs.map(({ document }) => document)
    : storePdfDocuments(pendingRepositoryPdfs, { limits: pdfLimits });
  const selectedReadme = selectReadme(project.project.files);
  const hasPdfDocumentation = uploadedPdfDocuments.length > 0 || repositoryPdfDocuments.length > 0;
  const documentationSource = hasPdfDocumentation
    ? getDocumentationSource(uploadedPdfDocuments, repositoryPdfDocuments, separateDocumentation)
    : separateDocumentation.length > 0
      ? 'provided'
      : selectedReadme
        ? 'repository-readme'
        : 'missing';
  const documentationFilesForHandoff = hasPdfDocumentation
    ? [
      ...uploadedPdfDocuments,
      ...repositoryPdfDocuments,
      ...separateDocumentation.map((file) => ({
        path: `${file.path}.txt`,
        sourcePath: file.path,
        source: 'provided',
        format: 'text/plain',
        originalFormat: 'text/plain',
        extractedText: file.content,
        pages: [],
        extractionStatus: 'success',
        warnings: [],
        originalBytesBase64: Buffer.from(file.content, 'utf8').toString('base64'),
      })),
    ]
    : prepareTextDocuments(
      separateDocumentation.length > 0 ? separateDocumentation : selectedReadme ? [selectedReadme] : [],
      documentationSource,
    ).files;
  const analyserDocumentation = {
    format: 'text/plain',
    source: documentationSource,
    files: documentationFilesForHandoff,
  };
  const warnings = hasPdfDocumentation || selectedReadme || separateDocumentation.length > 0
    ? []
    : [{
      code: 'DOCUMENTATION_MISSING',
      message: 'No separate documentation or readable repository README was found.',
    }];
  for (const pdfDocument of [...uploadedPdfDocuments, ...repositoryPdfDocuments]) {
    warnings.push(...pdfDocument.warnings);
  }
  if (skippedFiles.length > 0) {
    warnings.push({
      code: 'REPOSITORY_FILES_NOT_IN_TEXT_HANDOFF',
      message: `${skippedFiles.length} repository file(s) were excluded, unsupported, or not safely representable as UTF-8 text.`,
    });
  }

  return {
    ...project,
    analyserInput: {
      sourceFiles,
      documentation: analyserDocumentation,
      documentationFiles,
      binaryFiles,
      uncertainFiles,
      nonUtf8Files,
      originalFiles,
      skippedFiles,
    },
    warnings,
    source: {
      type: 'github',
      repositoryUrl: repository.repositoryUrl,
      ref,
      commitSha: commit.sha,
    },
    summary: createProjectSummary(
      project.project.files,
      unsupportedAssets,
      uploadedPdfDocuments.length + repositoryPdfDocuments.length,
    ),
    unsupportedAssets,
  };
}
