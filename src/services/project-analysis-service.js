import { inspectDirectory, validateDirectoryPath } from '../directory-inspector.js';
import { createFileAssociations } from '../file-associations.js';
import { scanProjectFiles } from '../file-identifier.js';
import { analyzeDocumentationDrift } from '../../drift-engine.js';
import { analyzeWithOllama } from './ollama-analyser-service.js';

/**
 * Analyze a prepared DocGuard project using its original per-file paths and
 * extracted documentation. Ollama configuration and response validation are
 * delegated to the existing analyser service.
 */
export async function analyzeProjectDocumentation(project, {
  runAnalyser = analyzeWithOllama,
  analyserOptions = {},
} = {}) {
  return analyzeDocumentationDrift(project, { runAnalyser, analyserOptions });
}

export async function inspectProject(directoryPath) {
  const projectPath = await validateDirectoryPath(directoryPath);
  const directorySummary = await inspectDirectory(projectPath);
  const scanResults = await scanProjectFiles(projectPath);
  const associations = createFileAssociations(
    scanResults.javascriptFiles,
    scanResults.markdownFiles,
  );

  return {
    projectPath,
    directorySummary,
    ...scanResults,
    ...associations,
    scanComplete: scanResults.errors.length === 0,
  };
}
