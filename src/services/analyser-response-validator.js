import { HttpError } from '../utils/http-error.js';

const SEVERITIES = new Set(['critical', 'high', 'medium', 'low', 'info']);
const ANALYSER_OUTPUT_SCHEMA = {
  type: 'object',
  properties: {
    summary: { type: 'string' },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          severity: { type: 'string', enum: [...SEVERITIES] },
          title: { type: 'string' },
          explanation: { type: 'string' },
          sourceReferences: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                path: { type: 'string' },
                startLine: { type: 'integer', minimum: 1 },
                endLine: { type: 'integer', minimum: 1 },
              },
              required: ['path'],
              additionalProperties: false,
            },
          },
          documentationReferences: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                path: { type: 'string' },
                pageNumber: { type: 'integer', minimum: 1 },
                quote: { type: 'string' },
              },
              required: ['path'],
              additionalProperties: false,
            },
          },
          recommendation: { type: 'string' },
        },
        required: [
          'severity',
          'title',
          'explanation',
          'sourceReferences',
          'documentationReferences',
          'recommendation',
        ],
        additionalProperties: false,
      },
    },
  },
  required: ['summary', 'findings'],
  additionalProperties: false,
};

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasExactKeys(value, requiredKeys, optionalKeys = []) {
  const keys = Object.keys(value);
  return requiredKeys.every((key) => keys.includes(key))
    && keys.every((key) => requiredKeys.includes(key) || optionalKeys.includes(key));
}

function validString(value, maximumLength = 20_000, allowEmpty = false) {
  return typeof value === 'string'
    && value.length <= maximumLength
    && (allowEmpty || value.trim().length > 0);
}

function validateSourceReference(reference) {
  if (!isRecord(reference)
    || !hasExactKeys(reference, ['path'], ['startLine', 'endLine'])
    || !validString(reference.path, 1024)) {
    return false;
  }
  if (reference.startLine !== undefined
    && (!Number.isSafeInteger(reference.startLine) || reference.startLine < 1)) {
    return false;
  }
  if (reference.endLine !== undefined
    && (!Number.isSafeInteger(reference.endLine) || reference.endLine < 1)) {
    return false;
  }
  return reference.startLine === undefined
    || reference.endLine === undefined
    || reference.endLine >= reference.startLine;
}

function validateDocumentationReference(reference) {
  return isRecord(reference)
    && hasExactKeys(reference, ['path'], ['pageNumber', 'quote'])
    && validString(reference.path, 1024)
    && (reference.pageNumber === undefined
      || (Number.isSafeInteger(reference.pageNumber) && reference.pageNumber >= 1))
    && (reference.quote === undefined || validString(reference.quote, 10_000, true));
}

function isValidFinding(finding) {
  return isRecord(finding)
    && hasExactKeys(finding, [
      'severity',
      'title',
      'explanation',
      'sourceReferences',
      'documentationReferences',
      'recommendation',
    ])
    && SEVERITIES.has(finding.severity)
    && validString(finding.title, 500)
    && validString(finding.explanation)
    && Array.isArray(finding.sourceReferences)
    && finding.sourceReferences.length <= 100
    && finding.sourceReferences.every(validateSourceReference)
    && Array.isArray(finding.documentationReferences)
    && finding.documentationReferences.length <= 100
    && finding.documentationReferences.every(validateDocumentationReference)
    && validString(finding.recommendation, 20_000, true);
}

export function getAnalyserOutputSchema() {
  return structuredClone(ANALYSER_OUTPUT_SCHEMA);
}

export function validateAnalyserOutput(output) {
  if (!isRecord(output)
    || !hasExactKeys(output, ['summary', 'findings'])
    || !validString(output.summary)
    || !Array.isArray(output.findings)
    || output.findings.length > 100) {
    throw new HttpError(502, 'INVALID_ANALYSER_OUTPUT', 'The analyser returned a response that does not match the required result format.');
  }
  if (!output.findings.every(isValidFinding)) {
    throw new HttpError(502, 'INVALID_ANALYSER_OUTPUT', 'The analyser returned a finding with missing or invalid fields.');
  }
  return output;
}
