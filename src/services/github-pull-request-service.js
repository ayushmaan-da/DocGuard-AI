import { processProjectInput } from './project-input-service.js';
import { classifyGitHubPath } from './github-repository-service.js';
import { HttpError } from '../utils/http-error.js';
import { parseGitHubPullRequestUrl, validateGitHubRef } from '../utils/github-repository-url.js';

const DEFAULT_LIMITS = {
  maxFiles: 100,
  maxResponseBytes: 12 * 1024 * 1024,
  maxPatchBytes: 256 * 1024,
  maxTotalPatchBytes: 2 * 1024 * 1024,
  requestTimeoutMs: 10_000,
};
const FILES_PER_PAGE = 100;
const MAX_GITHUB_PULL_REQUEST_FILES = 300;
const FILE_STATUSES = new Set(['added', 'modified', 'removed', 'renamed', 'copied', 'changed', 'unchanged']);
const COMMIT_SHA_PATTERN = /^[a-f0-9]{40,64}$/i;

function readLimit(environmentName, defaultValue, maximum = Number.MAX_SAFE_INTEGER) {
  const value = process.env[environmentName];
  if (value === undefined || value === '') {
    return defaultValue;
  }
  const parsedValue = Number(value);
  if (!Number.isSafeInteger(parsedValue) || parsedValue < 1 || parsedValue > maximum) {
    throw new Error(`${environmentName} must be a positive safe integer no greater than ${maximum}.`);
  }
  return parsedValue;
}

function getLimits() {
  return {
    maxFiles: readLimit('GITHUB_PR_MAX_FILES', DEFAULT_LIMITS.maxFiles, MAX_GITHUB_PULL_REQUEST_FILES),
    maxResponseBytes: readLimit('GITHUB_PR_MAX_RESPONSE_BYTES', DEFAULT_LIMITS.maxResponseBytes),
    maxPatchBytes: readLimit('GITHUB_PR_MAX_PATCH_BYTES', DEFAULT_LIMITS.maxPatchBytes),
    maxTotalPatchBytes: readLimit('GITHUB_PR_MAX_TOTAL_PATCH_BYTES', DEFAULT_LIMITS.maxTotalPatchBytes),
    requestTimeoutMs: readLimit('GITHUB_PR_REQUEST_TIMEOUT_MS', DEFAULT_LIMITS.requestTimeoutMs),
  };
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function createUpstreamError(response, context) {
  if (response.status === 404) {
    return new HttpError(404, 'GITHUB_PULL_REQUEST_NOT_FOUND', `${context} was not found or is not public.`);
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
    throw new HttpError(502, 'GITHUB_RESPONSE_TOO_LARGE', 'GitHub returned a response that exceeds the configured Pull Request response limit.');
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
        throw new HttpError(502, 'GITHUB_RESPONSE_TOO_LARGE', 'GitHub returned a response that exceeds the configured Pull Request response limit.');
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
  const token = process.env.GITHUB_TOKEN?.trim();
  const headers = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'DocGuard-AI',
    'X-GitHub-Api-Version': '2022-11-28',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
  try {
    let response;
    try {
      response = await fetchImpl(url, {
        headers,
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
      responseBytes = await readResponseBytes(response, limits.maxResponseBytes);
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

function validatePullRequestMetadata(metadata, parsedUrl) {
  if (!isRecord(metadata) || metadata.number !== parsedUrl.number
    || !isRecord(metadata.base) || !isRecord(metadata.head)
    || !isRecord(metadata.base.repo)) {
    throw new HttpError(502, 'INVALID_GITHUB_PULL_REQUEST', 'GitHub returned incomplete Pull Request metadata.');
  }
  if (metadata.base.repo.private === true) {
    throw new HttpError(404, 'GITHUB_PULL_REQUEST_NOT_FOUND', 'Pull Request was not found or is not public.');
  }
  const fullName = metadata.base.repo.full_name;
  if (
    typeof fullName !== 'string'
    || fullName.toLowerCase() !== `${parsedUrl.owner}/${parsedUrl.repository}`.toLowerCase()
    || metadata.base.repo.private !== false
    || typeof metadata.base.ref !== 'string'
    || typeof metadata.head.ref !== 'string'
    || !COMMIT_SHA_PATTERN.test(metadata.base.sha)
    || !COMMIT_SHA_PATTERN.test(metadata.head.sha)
    || typeof metadata.title !== 'string'
    || !['open', 'closed'].includes(metadata.state)
    || !Number.isSafeInteger(metadata.changed_files)
    || metadata.changed_files < 0
  ) {
    throw new HttpError(502, 'INVALID_GITHUB_PULL_REQUEST', 'GitHub returned invalid Pull Request metadata.');
  }
  try {
    validateGitHubRef(metadata.base.ref);
    validateGitHubRef(metadata.head.ref);
  } catch {
    throw new HttpError(502, 'INVALID_GITHUB_PULL_REQUEST', 'GitHub returned an invalid branch reference.');
  }

  let pullRequestUrl;
  try {
    pullRequestUrl = parseGitHubPullRequestUrl(metadata.html_url).pullRequestUrl;
  } catch {
    throw new HttpError(502, 'INVALID_GITHUB_PULL_REQUEST', 'GitHub returned an invalid Pull Request URL.');
  }
  if (pullRequestUrl.toLowerCase() !== parsedUrl.pullRequestUrl.toLowerCase()) {
    throw new HttpError(502, 'INVALID_GITHUB_PULL_REQUEST', 'GitHub returned metadata for a different Pull Request.');
  }

  return {
    number: metadata.number,
    title: metadata.title,
    state: metadata.state,
    url: pullRequestUrl,
    base: {
      branch: metadata.base.ref,
      commitSha: metadata.base.sha,
    },
    head: {
      branch: metadata.head.ref,
      commitSha: metadata.head.sha,
    },
    changedFiles: metadata.changed_files,
  };
}

function validateChangedFiles(files) {
  if (!Array.isArray(files)) {
    throw new HttpError(502, 'INVALID_GITHUB_PULL_REQUEST_FILES', 'GitHub returned an invalid Pull Request file list.');
  }
  if (files.length > FILES_PER_PAGE) {
    throw new HttpError(502, 'INVALID_GITHUB_PULL_REQUEST_FILES', 'GitHub returned more files than requested for one Pull Request page.');
  }

  const seenPaths = new Set();
  const validated = [];
  for (const [index, file] of files.entries()) {
    if (!isRecord(file)
      || typeof file.filename !== 'string'
      || !FILE_STATUSES.has(file.status)
      || !Number.isSafeInteger(file.additions) || file.additions < 0
      || !Number.isSafeInteger(file.deletions) || file.deletions < 0
      || !Number.isSafeInteger(file.changes) || file.changes < 0
      || (file.patch !== undefined && typeof file.patch !== 'string')
      || (file.previous_filename !== undefined && typeof file.previous_filename !== 'string')) {
      throw new HttpError(502, 'INVALID_GITHUB_PULL_REQUEST_FILES', `GitHub returned invalid changed-file data at index ${index}.`);
    }

    validateGitHubFilePath(file.filename);
    if (seenPaths.has(file.filename)) {
      throw new HttpError(502, 'DUPLICATE_PULL_REQUEST_FILE', `GitHub returned the changed path "${file.filename}" more than once.`);
    }
    seenPaths.add(file.filename);

    if (file.previous_filename !== undefined) {
      validateGitHubFilePath(file.previous_filename);
    } else if (file.status === 'renamed') {
      throw new HttpError(502, 'INVALID_GITHUB_PULL_REQUEST_FILES', `GitHub did not provide the original path for renamed file "${file.filename}".`);
    }

    validated.push(file);
  }
  return validated;
}

function validateGitHubFilePath(filePath) {
  try {
    processProjectInput({
      project: {
        name: 'github-pull-request',
        files: [{ path: filePath, content: '' }],
      },
    });
  } catch {
    throw new HttpError(502, 'INVALID_GITHUB_PULL_REQUEST_FILES', 'GitHub returned an unsafe or invalid changed-file path.');
  }
}

function createChangeRecord(file, limits, patchBytesUsed) {
  const classification = classifyGitHubPath(file.filename);
  const originalPath = file.previous_filename ?? null;
  const patchBytes = typeof file.patch === 'string'
    ? Buffer.byteLength(file.patch, 'utf8')
    : null;
  let patch = null;
  let patchStatus = 'not-provided';
  let patchUnavailableReason = classification === 'binary'
    ? 'binary-file'
    : 'patch-not-returned-by-github';

  if (patchBytes !== null) {
    if (patchBytes > limits.maxPatchBytes) {
      patchStatus = 'omitted-per-file-limit';
      patchUnavailableReason = 'patch-exceeds-per-file-limit';
    } else if (patchBytesUsed + patchBytes > limits.maxTotalPatchBytes) {
      patchStatus = 'omitted-total-limit';
      patchUnavailableReason = 'patch-exceeds-total-limit';
    } else {
      patch = file.patch;
      patchStatus = 'available';
      patchUnavailableReason = null;
    }
  }

  return {
    change: {
      path: file.filename,
      originalPath,
      status: file.status,
      classification,
      additions: file.additions,
      deletions: file.deletions,
      changes: file.changes,
      patch,
      patchStatus,
      ...(patchBytes !== null ? { patchBytes } : {}),
      ...(patchUnavailableReason ? { patchUnavailableReason } : {}),
    },
    patchBytesUsed: patchStatus === 'available' ? patchBytesUsed + patchBytes : patchBytesUsed,
  };
}

export async function ingestGitHubPullRequest(input, {
  fetchImpl = globalThis.fetch,
  limits = getLimits(),
} = {}) {
  if (!isRecord(input)) {
    throw new HttpError(400, 'INVALID_REQUEST', 'Request body must be a JSON object.');
  }
  const parsedUrl = parseGitHubPullRequestUrl(input.pullRequestUrl);
  const apiBase = `https://api.github.com/repos/${parsedUrl.owner}/${parsedUrl.repository}`;
  const metadataResponse = await fetchGitHubJson(
    `${apiBase}/pulls/${parsedUrl.number}`,
    { fetchImpl, limits, context: 'Pull Request' },
  );
  const pullRequest = validatePullRequestMetadata(metadataResponse, parsedUrl);

  if (pullRequest.changedFiles > MAX_GITHUB_PULL_REQUEST_FILES) {
    throw new HttpError(413, 'PULL_REQUEST_FILE_LIMIT_EXCEEDED', `GitHub exposes at most ${MAX_GITHUB_PULL_REQUEST_FILES} changed files for one Pull Request.`);
  }
  if (pullRequest.changedFiles > limits.maxFiles) {
    throw new HttpError(413, 'PULL_REQUEST_FILE_LIMIT_EXCEEDED', `Pull Request contains more than the supported ${limits.maxFiles} changed files.`);
  }

  const changedFiles = [];
  const seenPaths = new Set();
  for (let page = 1; changedFiles.length < pullRequest.changedFiles; page += 1) {
    const url = `${apiBase}/pulls/${parsedUrl.number}/files?per_page=${FILES_PER_PAGE}&page=${page}`;
    const pageResponse = await fetchGitHubJson(url, {
      fetchImpl,
      limits,
      context: 'Pull Request changed files',
    });
    const pageFiles = validateChangedFiles(pageResponse);
    for (const file of pageFiles) {
      if (seenPaths.has(file.filename)) {
        throw new HttpError(502, 'DUPLICATE_PULL_REQUEST_FILE', `GitHub returned the changed path "${file.filename}" more than once.`);
      }
      seenPaths.add(file.filename);
      changedFiles.push(file);
    }
    if (changedFiles.length > pullRequest.changedFiles || pageFiles.length < FILES_PER_PAGE) {
      break;
    }
  }

  if (changedFiles.length !== pullRequest.changedFiles) {
    throw new HttpError(502, 'INCOMPLETE_GITHUB_PULL_REQUEST', 'GitHub returned an incomplete changed-file list; no partial change context was returned.');
  }

  const changeContext = {
    sourceChanges: [],
    documentationChanges: [],
    binaryChanges: [],
    otherChanges: [],
    summary: {
      totalFiles: changedFiles.length,
      sourceFiles: 0,
      documentationFiles: 0,
      binaryFiles: 0,
      otherFiles: 0,
      patchesAvailable: 0,
      patchesUnavailable: 0,
      patchesOmittedByLimit: 0,
    },
  };
  let patchBytesUsed = 0;
  for (const file of changedFiles) {
    const result = createChangeRecord(file, limits, patchBytesUsed);
    patchBytesUsed = result.patchBytesUsed;
    const change = result.change;
    if (change.patchStatus === 'available') {
      changeContext.summary.patchesAvailable += 1;
    } else if (change.patchStatus.startsWith('omitted-')) {
      changeContext.summary.patchesOmittedByLimit += 1;
    } else {
      changeContext.summary.patchesUnavailable += 1;
    }

    if (change.classification === 'source') {
      changeContext.sourceChanges.push(change);
      changeContext.summary.sourceFiles += 1;
    } else if (change.classification === 'documentation') {
      changeContext.documentationChanges.push(change);
      changeContext.summary.documentationFiles += 1;
    } else if (change.classification === 'binary') {
      changeContext.binaryChanges.push(change);
      changeContext.summary.binaryFiles += 1;
    } else {
      changeContext.otherChanges.push(change);
      changeContext.summary.otherFiles += 1;
    }
  }

  return {
    source: {
      type: 'github-pull-request',
      owner: parsedUrl.owner,
      repository: parsedUrl.repository,
      repositoryUrl: parsedUrl.repositoryUrl,
    },
    pullRequest: {
      number: pullRequest.number,
      title: pullRequest.title,
      state: pullRequest.state,
      url: pullRequest.url,
      base: pullRequest.base,
      head: pullRequest.head,
    },
    changeContext,
  };
}
