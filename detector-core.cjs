function addedOrRemovedLines(diff) {
  return diff.split(/\r?\n/).flatMap(line => {
    if (line.startsWith("+++") || line.startsWith("---")) return [];
    if (line.startsWith("+")) return [{ type: "added", text: line.slice(1) }];
    if (line.startsWith("-")) return [{ type: "removed", text: line.slice(1) }];
    return [];
  });
}

function cleanResponse(text) {
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  return JSON.parse(cleaned);
}

const modelResponseSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    findings: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          outdated: { type: "boolean", const: true },
          sentence: { type: "string" },
          evidenceId: { type: "string", pattern: "^E[1-9][0-9]*$" },
          reason: { type: "string" }
        },
        required: ["outdated", "sentence", "evidenceId", "reason"]
      }
    }
  },
  required: ["findings"]
};

function resolveEvidenceReferences(result, changedLines) {
  if (!result || !Array.isArray(result.findings)) return result;
  const evidenceById = new Map(orderEvidenceCandidates(changedLines).map((line, index) => [`E${index + 1}`, line]));
  return {
    ...result,
    findings: result.findings.map(finding => {
      if (!finding || typeof finding.evidenceId !== "string") return finding;
      const evidence = evidenceById.get(finding.evidenceId);
      const { evidenceId, ...rest } = finding;
      return {
        ...rest,
        evidenceType: evidence?.type || "invalid",
        codeEvidence: evidence?.text || ""
      };
    })
  };
}

function orderEvidenceCandidates(changedLines) {
  // Put the updated implementation first; it is usually the direct evidence
  // for newly introduced behavior and avoids the model citing the old value.
  return [...changedLines.filter(line => line.type === "added"), ...changedLines.filter(line => line.type === "removed")];
}

function validateFindings(result, documentation, changedLines) {
  if (!result || !Array.isArray(result.findings)) throw new Error("Model response must contain a findings array");
  const seenSentences = new Set();
  const valid = [];

  for (const finding of result.findings) {
    const keys = ["outdated", "sentence", "evidenceType", "codeEvidence", "reason"];
    if (!finding || Object.keys(finding).sort().join(",") !== keys.slice().sort().join(",") ||
        finding.outdated !== true || typeof finding.sentence !== "string" ||
        typeof finding.evidenceType !== "string" || typeof finding.codeEvidence !== "string" ||
        typeof finding.reason !== "string") {
      throw new Error("Model returned a finding that does not match the required schema");
    }
    if (!documentation.includes(finding.sentence)) {
      throw new Error("Model returned a sentence that is not copied exactly from README.md");
    }
    if (seenSentences.has(finding.sentence)) throw new Error("Model returned a duplicate documentation sentence");
    if (!changedLines.some(line => line.type === finding.evidenceType && line.text === finding.codeEvidence)) {
      throw new Error("Model returned code evidence that is not an exact changed line of the matching type");
    }
    seenSentences.add(finding.sentence);
    valid.push({
      outdated: true,
      sentence: finding.sentence,
      evidenceType: finding.evidenceType,
      codeEvidence: finding.codeEvidence,
      reason: finding.reason
    });
  }
  return valid;
}

function validModelSuggestions(result, documentation, changedLines) {
  if (!result || !Array.isArray(result.findings)) return [];
  const accepted = [];
  const seen = new Set();
  for (const suggestion of result.findings) {
    // A false or missing flag is never promoted. The model can only suggest findings.
    if (!suggestion || suggestion.outdated !== true) continue;
    try {
      const [valid] = validateFindings({ findings: [suggestion] }, documentation, changedLines);
      if (!seen.has(valid.sentence)) {
        seen.add(valid.sentence);
        accepted.push(valid);
      }
    } catch {
      // Invalid model claims are discarded; deterministic checks may still detect drift.
    }
  }
  return accepted;
}

function buildPrompt(originalCode, updatedCode, diff, documentation) {
  const evidenceLines = orderEvidenceCandidates(addedOrRemovedLines(diff)).map((line, index) =>
    `E${index + 1} ${line.type.toUpperCase()} ${JSON.stringify(line.text)}`
  ).join("\n");
  return `You audit API documentation for behavior changes. Be conservative: a wrong finding is worse than missing a possible issue.

Task: compare the old and new implementation, then report only exact documentation sentences that were accurate before and became false because of this diff.

Decision rules:
1. Read all three inputs: original code, updated code, and documentation. Determine the observable behavior before and after.
2. Report a sentence only if the updated behavior contradicts its factual claim and the old behavior did not already contradict it.
3. Ignore comments, logging, formatting, refactors with the same behavior, and changes to details the documentation never promises.
4. Do not infer that adding an explicit status of 200 contradicts documentation that only promises a JSON response.
5. Do not report an array copy such as [...users] as a response-shape change from users; both return arrays with the same elements.
6. Do not report a validation refactor when it accepts and rejects the same values.
7. Do not report normalization or internal data changes unless they contradict a documented observable claim.
8. A sentence copied from source code is invalid. Copy the exact complete sentence from DOCUMENTATION, including punctuation.

Evidence selection:
- Choose one E-number from CHANGED-LINE EVIDENCE that directly proves the new behavior contradicts the sentence.
- The E-number fixes the exact line and whether it was added or removed. Never invent or rewrite evidence.
- For a newly added behavior, use an ADDED line that introduces it. For behavior removed from code, use a REMOVED line that shows what was removed.
- A diff shows the old version with - and the new version with +. For a status change from 201 to 200, cite the ADDED 200 line, not the REMOVED 201 line. For an array wrapped in an object, cite the ADDED wrapper line, not the REMOVED array line. For a removed response property, cite that REMOVED property line. For a renamed property, cite the ADDED replacement property line.
- If no changed line directly supports the claim, return no finding.

Return only JSON. Each finding must have exactly these fields: outdated, sentence, evidenceId, reason. Use outdated=true only. Do not include a finding with outdated=false. Return an empty findings array when no drift is proven.
Example shape: {"findings":[{"outdated":true,"sentence":"Exact sentence from the documentation.","evidenceId":"E2","reason":"What changed and why this sentence is now false."}]}

ORIGINAL CODE:\n${originalCode}\n\nUPDATED CODE:\n${updatedCode}\n\nCHANGED-LINE EVIDENCE (IDs preserve exact diff side and text):\n${evidenceLines || "(no changed lines)"}\n\nDOCUMENTATION:\n${documentation}`;
}

async function queryOllama(prompt, { url, model, numCtx = 8192, timeoutMs = 120000 } = {}) {
  const response = await fetch(url || process.env.OLLAMA_URL || "http://localhost:11434/api/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal: AbortSignal.timeout(timeoutMs),
    body: JSON.stringify({
      model: model || process.env.OLLAMA_MODEL || "qwen2.5-coder:7b",
      stream: false,
      format: modelResponseSchema,
      options: { temperature: 0, num_ctx: numCtx },
      prompt
    })
  });
  if (!response.ok) throw new Error(`Ollama request failed: ${response.status} ${response.statusText}`);
  const payload = await response.json();
  if (typeof payload.response !== "string") throw new Error("Ollama response has no text field");
  return payload.response;
}

module.exports = { addedOrRemovedLines, cleanResponse, modelResponseSchema, resolveEvidenceReferences, validateFindings, validModelSuggestions, buildPrompt, queryOllama };
