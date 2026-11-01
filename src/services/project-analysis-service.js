import { inspectDirectory, validateDirectoryPath } from '../directory-inspector.js';
import { createFileAssociations } from '../file-associations.js';
import { scanProjectFiles } from '../file-identifier.js';

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
