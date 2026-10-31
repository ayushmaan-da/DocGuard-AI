import { dirname } from 'node:path';

function getFileStem(fileEntry) {
  return fileEntry.name.slice(0, -fileEntry.extension.length).toLowerCase();
}

export function createFileAssociations(javascriptFiles, markdownFiles) {
  const markdownFilesByStem = new Map();

  for (const markdownFile of markdownFiles) {
    const stem = getFileStem(markdownFile);
    const matchingFiles = markdownFilesByStem.get(stem) ?? [];
    matchingFiles.push(markdownFile);
    markdownFilesByStem.set(stem, matchingFiles);
  }

  const associations = [];
  const unassociatedJavaScriptFiles = [];
  const associatedMarkdownFiles = new Set();

  for (const javascriptFile of javascriptFiles) {
    const javascriptStem = getFileStem(javascriptFile);
    const javascriptDir = dirname(javascriptFile.relativePath);
    const matches = markdownFilesByStem.get(javascriptStem) ?? [];
    const overviewMatches = javascriptStem === 'index'
      ? markdownFiles.filter((markdownFile) =>
        markdownFile.name.toLowerCase() === 'readme.md' && dirname(markdownFile.relativePath) === javascriptDir)
      : [];
    const potentialMatches = [...new Set([...matches, ...overviewMatches])];

    if (potentialMatches.length === 0) {
      unassociatedJavaScriptFiles.push(javascriptFile);
      continue;
    }

    for (const markdownFile of potentialMatches) {
      associations.push({
        label: 'POTENTIAL',
        javascriptFile,
        markdownFile,
      });
      associatedMarkdownFiles.add(markdownFile);
    }
  }

  const unassociatedMarkdownFiles = markdownFiles.filter(
    (markdownFile) => !associatedMarkdownFiles.has(markdownFile),
  );

  return { associations, unassociatedJavaScriptFiles, unassociatedMarkdownFiles };
}
