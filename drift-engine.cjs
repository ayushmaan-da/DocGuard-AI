const {
  addedOrRemovedLines,
  cleanResponse,
  resolveEvidenceReferences,
  validModelSuggestions,
  buildPrompt,
  queryOllama
} = require("./detector-core.cjs");
const { detectRemovedResponseFields } = require("./response-field-fallback.cjs");

function normalizeDocuments(docs) {
  const list = typeof docs === "string" ? [{ file: "README.md", content: docs }] : docs;
  if (!Array.isArray(list) || list.length === 0 || list.some(doc => !doc || typeof doc.file !== "string" || typeof doc.content !== "string")) {
    throw new TypeError("docs must be documentation text or an array of { file, content } objects");
  }
  return list;
}

function findLine(source, exactText) {
  const exact = source.split(/\r?\n/).findIndex(line => line === exactText);
  if (exact >= 0) return exact + 1;
  const trimmed = source.split(/\r?\n/).findIndex(line => line.trim() === exactText.trim());
  return trimmed < 0 ? null : trimmed + 1;
}

function locateSentence(docs, sentence, preferredFile) {
  const orderedDocs = preferredFile
    ? [...docs.filter(doc => doc.file === preferredFile), ...docs.filter(doc => doc.file !== preferredFile)]
    : docs;
  for (const doc of orderedDocs) {
    const lines = doc.content.split(/\r?\n/);
    const line = lines.findIndex(text => text.includes(sentence));
    if (line >= 0) {
      const location = { file: doc.file, line: line + 1, sentence };
      if (Array.isArray(doc.pages)) {
        let pageNumber;
        for (let index = 0; index <= line; index += 1) {
          const marker = lines[index].match(/^--- Page (\d+) ---$/);
          if (marker) pageNumber = Number(marker[1]);
        }
        if (Number.isSafeInteger(pageNumber) && pageNumber > 0) {
          location.pageNumber = pageNumber;
        } else if (doc.pages.length === 1 && Number.isSafeInteger(doc.pages[0]?.pageNumber)) {
          location.pageNumber = doc.pages[0].pageNumber;
        }
      }
      return location;
    }
  }
  return { file: null, line: null, sentence };
}

function toFinding(item, docs, originalCode, updatedCode, codeFile, id, verification) {
  const evidenceSource = item.evidenceType === "removed" ? originalCode : updatedCode;
  const isRuleMatch = verification === "deterministic-rule-match";
  return {
    id,
    outdated: isRuleMatch ? true : null,
    ...(isRuleMatch ? {} : { modelSaysOutdated: item.outdated === true }),
    documentation: locateSentence(docs, item.sentence, item.documentFile),
    codeEvidence: {
      file: codeFile,
      line: findLine(evidenceSource, item.codeEvidence),
      changeType: item.evidenceType,
      text: item.codeEvidence
    },
    reason: item.reason,
    verification
  };
}

/**
 * Analyze a diff without tying the engine to a CLI or web framework.
 * The model returns unverified suggestions; findings are emitted only when
 * the deterministic response-field rule matches the change in source.
 */
async function analyze({
  diff,
  docs,
  originalCode,
  updatedCode,
  codeFile = "app.js",
  callModel,
  modelOptions = {}
}) {
  for (const [name, value] of Object.entries({ diff, originalCode, updatedCode })) {
    if (typeof value !== "string") throw new TypeError(`${name} must be a string`);
  }
  const documents = normalizeDocuments(docs);
  if (typeof codeFile !== "string" || codeFile.length === 0) throw new TypeError("codeFile must be a non-empty string");
  const documentation = documents.map(doc => `### ${doc.file}\n${doc.content}`).join("\n\n");
  const changedLines = addedOrRemovedLines(diff);
  const rawDeterministic = documents.flatMap(doc => detectRemovedResponseFields({
    originalCode,
    updatedCode,
    diff,
    documentation: doc.content
  }).map(item => ({ ...item, documentFile: doc.file })));
  const deterministicFindings = [];
  const deterministicSentences = new Set();
  for (const item of rawDeterministic) {
    const key = `${item.documentFile}\0${item.sentence}`;
    if (deterministicSentences.has(key)) continue;
    deterministicSentences.add(key);
    deterministicFindings.push(toFinding(item, documents, originalCode, updatedCode, codeFile,
      `rule-${deterministicFindings.length + 1}`, "deterministic-rule-match"));
  }

  if (changedLines.length === 0) {
    return {
      contract: "drift-engine/v1",
      findings: deterministicFindings,
      suggestions: [],
      diagnostics: {
        model: { status: "not-run-no-code-changes" },
        counts: {
          changedLines: 0,
          modelFindingsReturned: 0,
          deterministicRuleMatches: deterministicFindings.length,
          unverifiedSuggestions: 0
        }
      }
    };
  }

  let modelStatus = "not-configured";
  let modelError;
  let suggestions = [];
  let modelFindingCount = 0;
  const prompt = buildPrompt(originalCode, updatedCode, diff, documentation);
  try {
    const request = callModel || (text => queryOllama(text, modelOptions));
    const raw = await request(prompt, modelOptions);
    const parsedRaw = typeof raw === "string" ? cleanResponse(raw) : raw;
    const parsed = resolveEvidenceReferences(parsedRaw, changedLines);
    modelFindingCount = Array.isArray(parsed?.findings) ? parsed.findings.length : 0;
    const valid = validModelSuggestions(parsed, documentation, changedLines);
    const seen = new Set(deterministicSentences);
    for (const item of valid) {
      if (seen.has(item.sentence)) continue;
      seen.add(item.sentence);
      suggestions.push(toFinding(item, documents, originalCode, updatedCode, codeFile,
        `model-${suggestions.length + 1}`, "unverified-model-suggestion"));
    }
    modelStatus = "response-received";
  } catch (error) {
    modelStatus = "unavailable-or-invalid";
    modelError = error instanceof Error ? error.message : String(error);
  }

  return {
    contract: "drift-engine/v1",
    findings: deterministicFindings,
    suggestions,
    diagnostics: {
      model: {
        status: modelStatus,
        ...(modelOptions.model ? { name: modelOptions.model } : {}),
        ...(modelError ? { detail: modelError } : {})
      },
      counts: {
        changedLines: changedLines.length,
        modelFindingsReturned: modelFindingCount,
        deterministicRuleMatches: deterministicFindings.length,
        unverifiedSuggestions: suggestions.length
      }
    }
  };
}

module.exports = { analyze };
