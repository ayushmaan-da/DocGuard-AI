import { analyze as analyzeDrift } from '../../drift-engine.js';
import { ingestGitHubPullRequest } from './github-pull-request-service.js';
import { ingestGitHubRepository } from './github-repository-service.js';
import {
  callOllamaPrompt,
  getOllamaConfiguration,
} from './ollama-analyser-service.js';
import { HttpError } from '../utils/http-error.js';

function getDocumentation(repository) {
  const analyserInput = repository?.analyserInput;
  const documents = [];
  for (const document of analyserInput?.documentationFiles ?? []) {
    if (typeof document?.path === 'string' && typeof document.content === 'string') {
      documents.push({ file: document.path, content: document.content });
    }
  }
  for (const document of analyserInput?.documentation?.files ?? []) {
    const content = document?.extractedText ?? document?.content;
    const file = document?.sourcePath ?? document?.path;
    if (typeof file === 'string' && typeof content === 'string') {
      documents.push({
        file,
        content,
        ...(Array.isArray(document.pages) ? { pages: document.pages } : {}),
      });
    }
  }

  const seen = new Set();
  return documents.filter((document) => {
    const key = `${document.file}\0${document.content}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export async function analyzeGitHubPullRequest(input, {
  fetchImpl = globalThis.fetch,
  ingestPullRequest = ingestGitHubPullRequest,
  ingestRepository = ingestGitHubRepository,
  runEngine = analyzeDrift,
  callModel,
  getModelConfiguration = getOllamaConfiguration,
} = {}) {
  const pullRequest = await ingestPullRequest(input, {
    fetchImpl,
    includeSourceContents: true,
  });
  const snapshots = pullRequest.sourceSnapshots ?? [];
  const analyzableSnapshots = snapshots.filter((snapshot) => (
    typeof snapshot.diff === 'string'
    && typeof snapshot.originalCode === 'string'
    && typeof snapshot.updatedCode === 'string'
  ));
  const skippedFiles = snapshots
    .filter((snapshot) => !analyzableSnapshots.includes(snapshot))
    .map(({ path, skipReason }) => ({ path, reason: skipReason ?? 'source-snapshot-unavailable' }));

  let configuration;
  const resolveConfiguration = () => {
    configuration ??= getModelConfiguration();
    return configuration;
  };
  const modelCall = callModel ?? ((prompt) => callOllamaPrompt(prompt, {
    fetchImpl,
    configuration: resolveConfiguration(),
  }));
  const docs = analyzableSnapshots.length > 0
    ? getDocumentation(await ingestRepository({
      repositoryUrl: pullRequest.pullRequest.head.repositoryUrl ?? pullRequest.source.repositoryUrl,
      ref: pullRequest.pullRequest.head.commitSha,
      ...(input.uploadedDocumentIds !== undefined
        ? { uploadedDocumentIds: input.uploadedDocumentIds }
        : {}),
    }, { fetchImpl, documentationOnly: true }))
    : [];
  if (analyzableSnapshots.length > 0 && docs.length === 0) {
    throw new HttpError(
      422,
      'PULL_REQUEST_DOCUMENTATION_UNAVAILABLE',
      'No readable documentation was available at the Pull Request head revision.',
    );
  }

  const findings = [];
  const suggestions = [];
  const fileDiagnostics = [];
  for (const snapshot of analyzableSnapshots) {
    const result = await runEngine({
      diff: snapshot.diff,
      docs,
      originalCode: snapshot.originalCode,
      updatedCode: snapshot.updatedCode,
      codeFile: snapshot.path,
      callModel: modelCall,
      modelOptions: process.env.OLLAMA_MODEL?.trim()
        ? { model: process.env.OLLAMA_MODEL.trim() }
        : {},
    });
    findings.push(...result.findings.map((finding) => ({
      ...finding,
      id: `${snapshot.path}:${finding.id}`,
    })));
    suggestions.push(...result.suggestions.map((suggestion) => ({
      ...suggestion,
      id: `${snapshot.path}:${suggestion.id}`,
    })));
    fileDiagnostics.push({
      file: snapshot.path,
      ...result.diagnostics,
    });
  }

  const publicPullRequest = { ...pullRequest };
  delete publicPullRequest.sourceSnapshots;
  return {
    ...publicPullRequest,
    driftAnalysis: {
      contract: 'drift-engine/v1',
      documentationRef: pullRequest.pullRequest.head.commitSha,
      documentationFiles: docs.map(({ file }) => file),
      filesAnalyzed: analyzableSnapshots.length,
      filesSkipped: skippedFiles,
      findings,
      suggestions,
      diagnostics: {
        status: analyzableSnapshots.length > 0
          ? 'analysis-completed'
          : 'not-run-no-analyzable-source-changes',
        files: fileDiagnostics,
      },
    },
  };
}
