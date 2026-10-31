import { randomUUID } from 'node:crypto';
import { basename } from 'node:path';
import { HttpError } from '../utils/http-error.js';

const DEFAULT_LIMITS = {
  maxProjects: 100,
  maxStoredBytes: 50 * 1024 * 1024,
  referenceTtlMs: 15 * 60 * 1000,
};
const PROJECTS = new Map();
let storedBytes = 0;

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
    maxProjects: readLimit('PROJECT_REFERENCE_MAX_COUNT', DEFAULT_LIMITS.maxProjects),
    maxStoredBytes: readLimit('PROJECT_REFERENCE_MAX_BYTES', DEFAULT_LIMITS.maxStoredBytes),
    referenceTtlMs: readLimit('PROJECT_REFERENCE_TTL_MS', DEFAULT_LIMITS.referenceTtlMs),
  };
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function normalizeDocumentationRecord(record, source) {
  if (!isRecord(record)) {
    throw new HttpError(500, 'INVALID_PROJECT_DATA', 'The prepared project contains an invalid documentation record.');
  }

  const extractedText = typeof record.extractedText === 'string'
    ? record.extractedText
    : record.content;
  const path = record.sourcePath ?? record.path ?? record.filename;
  if (typeof extractedText !== 'string' || typeof path !== 'string' || path.length === 0) {
    throw new HttpError(500, 'INVALID_PROJECT_DATA', 'The prepared project contains incomplete documentation data.');
  }

  const pages = record.pages ?? [];
  if (!Array.isArray(pages) || pages.some((page) => (
    !isRecord(page)
    || !Number.isSafeInteger(page.pageNumber)
    || page.pageNumber < 1
    || typeof page.text !== 'string'
  ))) {
    throw new HttpError(500, 'INVALID_PROJECT_DATA', 'The prepared project contains invalid documentation page data.');
  }

  return {
    path,
    filename: record.filename ?? basename(path),
    source: record.source ?? source,
    format: 'text/plain',
    originalFormat: record.originalFormat ?? record.format ?? 'text/plain',
    extractedText,
    ...(pages.length > 0 ? { pages: pages.map(({ pageNumber, text }) => ({ pageNumber, text })) } : {}),
    ...(typeof record.extractionStatus === 'string' ? { extractionStatus: record.extractionStatus } : {}),
    ...(Array.isArray(record.warnings) ? { warnings: record.warnings } : {}),
  };
}

export function prepareProjectForAnalysis(projectResult) {
  if (!isRecord(projectResult) || !isRecord(projectResult.project)
    || typeof projectResult.project.name !== 'string'
    || !Array.isArray(projectResult.project.files)) {
    throw new HttpError(500, 'INVALID_PROJECT_DATA', 'The prepared project is invalid and cannot be analyzed.');
  }

  const prepared = projectResult.analyserInput;
  const sourceFiles = Array.isArray(prepared?.sourceFiles)
    ? prepared.sourceFiles.map((file) => {
      if (!isRecord(file) || typeof file.path !== 'string' || typeof file.content !== 'string') {
        throw new HttpError(500, 'INVALID_PROJECT_DATA', 'The prepared project contains an invalid source file.');
      }
      return { path: file.path, content: file.content };
    })
    : projectResult.project.files
      .filter((file) => file.category === 'source')
      .map(({ path, content }) => ({ path, content }));

  const source = projectResult.source ?? { type: 'normalized' };
  const documentationRecords = [];
  const seenDocumentationByPath = new Map();
  const addDocumentation = (record, recordSource = prepared?.documentation?.source ?? source.type ?? 'provided') => {
    const normalized = normalizeDocumentationRecord(record, recordSource);
    const recordsForPath = seenDocumentationByPath.get(normalized.path) ?? [];
    const duplicate = recordsForPath.some((existing) => (
      existing.extractedText === normalized.extractedText
      && (
        existing.source === normalized.source
        || new Set([existing.source, normalized.source]).has('repository-readme')
          && new Set([existing.source, normalized.source]).has('github')
      )
    ));
    if (!duplicate) {
      recordsForPath.push(normalized);
      seenDocumentationByPath.set(normalized.path, recordsForPath);
      documentationRecords.push(normalized);
    }
  };

  const hasPreparedDocumentation = Array.isArray(prepared?.documentation?.files);
  const preparedDocumentationSource = prepared?.documentation?.source;
  const hasSelectedDocumentation = Array.isArray(prepared?.documentation?.files)
    && prepared.documentation.files.length > 0;
  const documentationSelectionMissing = hasPreparedDocumentation
    && preparedDocumentationSource === 'missing'
    && !hasSelectedDocumentation;

  if (hasSelectedDocumentation) {
    for (const record of prepared.documentation.files) {
      addDocumentation(record);
    }
  }
  if (!documentationSelectionMissing && Array.isArray(prepared?.documentationFiles)) {
    for (const record of prepared.documentationFiles) {
      addDocumentation(record, 'github');
    }
  }

  if (!hasPreparedDocumentation && documentationRecords.length === 0) {
    for (const file of projectResult.project.files) {
      if (file.category === 'documentation') {
        addDocumentation(file, source.type === 'github' ? 'github' : 'provided');
      }
    }
  }

  const warnings = Array.isArray(projectResult.warnings)
    ? projectResult.warnings.map((warning) => ({ ...warning }))
    : [];
  if (documentationRecords.length === 0 && !warnings.some((warning) => warning.code === 'DOCUMENTATION_MISSING')) {
    warnings.push({
      code: 'DOCUMENTATION_MISSING',
      message: 'No documentation was available in the prepared project.',
    });
  }

  return {
    project: {
      name: projectResult.project.name,
      source: {
        type: source.type ?? 'normalized',
        ...(typeof source.repositoryUrl === 'string' ? { repositoryUrl: source.repositoryUrl } : {}),
        ...(typeof source.ref === 'string' ? { ref: source.ref } : {}),
        ...(typeof source.commitSha === 'string' ? { commitSha: source.commitSha } : {}),
      },
      sourceFiles,
      documentation: documentationRecords,
      warnings,
    },
  };
}

function removeExpiredProjects(now = Date.now()) {
  for (const [id, record] of PROJECTS) {
    if (record.expiresAt <= now) {
      storedBytes -= record.sizeBytes;
      PROJECTS.delete(id);
    }
  }
}

const cleanupTimer = setInterval(removeExpiredProjects, 60_000);
cleanupTimer.unref();

export function storeProjectReference(projectResult, { limits = getLimits(), now = Date.now() } = {}) {
  removeExpiredProjects(now);
  const prepared = prepareProjectForAnalysis(projectResult);
  const sizeBytes = Buffer.byteLength(JSON.stringify(prepared), 'utf8');

  if (PROJECTS.size + 1 > limits.maxProjects || storedBytes + sizeBytes > limits.maxStoredBytes) {
    throw new HttpError(503, 'PROJECT_REFERENCE_STORE_FULL', 'The temporary project store is full. Try again after existing references expire.');
  }

  const projectId = randomUUID();
  const expiresAt = now + limits.referenceTtlMs;
  PROJECTS.set(projectId, {
    prepared,
    sizeBytes,
    expiresAt,
  });
  storedBytes += sizeBytes;

  return {
    projectId,
    expiresAt: new Date(expiresAt).toISOString(),
  };
}

export function getProjectReference(projectId) {
  removeExpiredProjects();
  const record = PROJECTS.get(projectId);
  if (!record) {
    throw new HttpError(404, 'PROJECT_REFERENCE_NOT_FOUND', 'The project reference is invalid or has expired.');
  }
  return structuredClone(record.prepared);
}
