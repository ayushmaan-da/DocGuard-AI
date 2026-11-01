import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import cases from './cases.js';
import detectorCore from '../detector-core.cjs';

const {
  addedOrRemovedLines,
  cleanResponse,
  resolveEvidenceReferences,
  validateFindings,
  buildPrompt,
  queryOllama,
} = detectorCore;

const root = path.dirname(fileURLToPath(import.meta.url));
const caseRoot = path.join(root, "cases");
const outputRoot = path.join(root, "results");
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

function writeCaseFiles(testCase) {
  const directory = path.join(caseRoot, testCase.id);
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, "README.md"), `${testCase.readme}\n`, "utf8");
  fs.writeFileSync(path.join(directory, "original.js"), testCase.original, "utf8");
  fs.writeFileSync(path.join(directory, "updated.js"), testCase.updated, "utf8");
  fs.writeFileSync(path.join(directory, "expected.json"), `${JSON.stringify({ findings: testCase.expected }, null, 2)}\n`, "utf8");
  const diffResult = spawnSync("git", ["diff", "--no-index", "--unified=4", "--", "original.js", "updated.js"], { cwd: directory, encoding: "utf8" });
  if (diffResult.status !== 1 && diffResult.status !== 0) throw new Error(diffResult.stderr || `Could not create diff for ${testCase.id}`);
  fs.writeFileSync(path.join(directory, "change.diff"), diffResult.stdout, "utf8");
  const changedLines = addedOrRemovedLines(diffResult.stdout);
  for (const expected of testCase.expected) {
    if (!testCase.readme.includes(expected.sentence)) throw new Error(`${testCase.id}: expected sentence is missing from its README`);
    if (!changedLines.some(line => line.type === expected.evidenceType && line.text === expected.codeEvidence)) {
      throw new Error(`${testCase.id}: expected evidence is not an exact changed line`);
    }
  }
  return { directory, diff: diffResult.stdout };
}

function findingKey(finding) {
  return JSON.stringify([finding.outdated, finding.sentence, finding.evidenceType, finding.codeEvidence]);
}

function scoreCase(expected, actual, validationError) {
  const validActual = validationError ? [] : actual;
  const matchedExpected = new Set();
  for (const item of validActual) {
    const match = expected.findIndex((wanted, index) => !matchedExpected.has(index) &&
      wanted.sentence === item.sentence &&
      wanted.evidenceType === item.evidenceType &&
      wanted.codeEvidence === item.codeEvidence);
    if (match >= 0) matchedExpected.add(match);
  }
  const tp = matchedExpected.size;
  const fp = actual.length - tp;
  const fn = expected.length - tp;
  const claimMatched = new Set();
  for (const item of actual) {
    const match = expected.findIndex((wanted, index) => !claimMatched.has(index) && wanted.sentence === item.sentence);
    if (match >= 0) claimMatched.add(match);
  }
  return {
    tp, fp, fn,
    claimTp: claimMatched.size,
    claimFp: actual.length - claimMatched.size,
    claimFn: expected.length - claimMatched.size,
    pass: fp === 0 && fn === 0 && !validationError
  };
}

function renderMarkdown(results, metrics, model) {
  const lines = [
    "# Documentation drift model evaluation results",
    "",
    `- Model: \`${model}\``,
    `- Scenarios: ${results.length}`,
    `- Exact case passes: ${results.filter(result => result.pass).length}/${results.length}`,
    `- Exact-evidence findings: TP ${metrics.tp}, FP ${metrics.fp}, FN ${metrics.fn}`,
    `- Exact-evidence precision: ${metrics.precision.toFixed(3)}; recall: ${metrics.recall.toFixed(3)}; F1: ${metrics.f1.toFixed(3)}`,
    `- Exact-sentence claim detection (ignoring evidence): TP ${metrics.claimTp}, FP ${metrics.claimFp}, FN ${metrics.claimFn}`,
    `- Claim precision: ${metrics.claimPrecision.toFixed(3)}; recall: ${metrics.claimRecall.toFixed(3)}; F1: ${metrics.claimF1.toFixed(3)}`,
    `- Exact changed-line validation: ${metrics.validFindingCount}/${metrics.rawFindingCount} returned findings passed sentence, schema, and changed-line checks.`,
    "",
    "## Expected versus returned",
    "",
    "| Case | Category | Result | Expected findings | Model findings | Validation |",
    "|---|---|---:|---|---|---|"
  ];
  for (const result of results) {
    const expected = result.expected.map(item => `${item.sentence} [${item.evidenceType}: ${item.codeEvidence}]`).join("<br>") || "∅";
    const actual = result.actual.map(item => `${item.sentence || "(no exact sentence)"} [${item.evidenceType || "?"}: ${item.codeEvidence || "(no evidence)"}]`).join("<br>") || "∅";
    const validation = result.validationError ? `ERROR: ${result.validationError}` : "valid";
    const cell = value => String(value).replaceAll("|", "\\|").replaceAll("\n", " ");
    lines.push(`| ${cell(result.id)} | ${cell(result.category)} | ${result.pass ? "PASS" : "FAIL"} | ${cell(expected)} | ${cell(actual)} | ${cell(validation)} |`);
  }
  lines.push("", "## Per-case details", "");
  for (const result of results) {
    lines.push(`### ${result.id}`, "", result.description, "", "Expected:", "", "```json", JSON.stringify({ findings: result.expected }, null, 2), "```", "", "Model returned:", "", "```json", JSON.stringify(result.actual, null, 2), "```", "");
    if (result.rawResponse) lines.push("Raw model response:", "", "```json", result.rawResponse, "```", "");
    if (result.error) lines.push(`Model error: ${result.error}`, "");
  }
  return `${lines.join("\n")}\n`;
}

async function main() {
  const args = new Set(process.argv.slice(2));
  const limitArg = process.argv.find(arg => arg.startsWith("--limit="));
  const limit = limitArg ? Number(limitArg.split("=")[1]) : cases.length;
  const selected = cases.slice(0, Number.isFinite(limit) && limit > 0 ? limit : cases.length);
  fs.mkdirSync(outputRoot, { recursive: true });
  const prepared = selected.map(testCase => ({ testCase, ...writeCaseFiles(testCase) }));
  if (args.has("--prepare-only")) {
    console.log(`Prepared ${prepared.length} isolated cases under ${caseRoot}`);
    return;
  }

  if (args.has("--summarize-existing")) {
    for (const { testCase } of prepared) {
      const file = path.join(outputRoot, `${testCase.id}.json`);
      if (!fs.existsSync(file)) throw new Error(`Missing saved model result for ${testCase.id}`);
      const saved = JSON.parse(fs.readFileSync(file, "utf8"));
      Object.assign(saved, { id: testCase.id, category: testCase.category, description: testCase.description, expected: testCase.expected });
      const score = scoreCase(saved.expected, saved.actual || [], saved.validationError);
      Object.assign(saved, score);
      fs.writeFileSync(file, `${JSON.stringify(saved, null, 2)}\n`, "utf8");
    }
    const model = process.env.OLLAMA_MODEL || "qwen2.5-coder:7b";
    const results = prepared.map(({ testCase }) => JSON.parse(fs.readFileSync(path.join(outputRoot, `${testCase.id}.json`), "utf8")));
    const metrics = summarize(results);
    writeSummary(results, metrics, model);
    return;
  }

  const model = process.env.OLLAMA_MODEL || "qwen2.5-coder:7b";
  const results = [];
  for (let index = 0; index < prepared.length; index++) {
    const { testCase, directory, diff } = prepared[index];
    const documentation = fs.readFileSync(path.join(directory, "README.md"), "utf8");
    const original = fs.readFileSync(path.join(directory, "original.js"), "utf8");
    const updated = fs.readFileSync(path.join(directory, "updated.js"), "utf8");
    const result = {
      id: testCase.id,
      category: testCase.category,
      description: testCase.description,
      expected: testCase.expected,
      actual: [],
      pass: false,
      validationError: null,
      error: null,
      rawResponse: null
    };
    process.stdout.write(`[${index + 1}/${prepared.length}] ${testCase.id} ... `);
    try {
      const raw = await queryOllama(buildPrompt(original, updated, diff, documentation), { timeoutMs: 180000 });
      result.rawResponse = raw;
      const parsed = resolveEvidenceReferences(cleanResponse(raw), addedOrRemovedLines(diff));
      result.actual = Array.isArray(parsed.findings) ? parsed.findings : [];
      try {
        validateFindings(parsed, documentation, addedOrRemovedLines(diff));
      } catch (error) {
        result.validationError = error.message;
      }
      const score = scoreCase(result.expected, result.actual, result.validationError);
      Object.assign(result, score);
      console.log(`${result.pass ? "PASS" : "FAIL"} | expected ${result.expected.length}, got ${result.actual.length}`);
      console.log(`  Expected: ${JSON.stringify(result.expected)}`);
      console.log(`  Actual:   ${JSON.stringify(result.actual)}`);
      if (result.validationError) console.log(`  Validation: ${result.validationError}`);
    } catch (error) {
      result.error = error.message;
      Object.assign(result, scoreCase(result.expected, [], error.message));
      console.log(`ERROR | ${error.message}`);
    }
    fs.writeFileSync(path.join(outputRoot, `${testCase.id}.json`), `${JSON.stringify(result, null, 2)}\n`, "utf8");
    results.push(result);
    await pause(250);
  }

  const metrics = summarize(results);
  writeSummary(results, metrics, model);
}

function summarize(results) {
  const totals = field => results.reduce((total, result) => total + (result[field] || 0), 0);
  const metrics = { tp: totals("tp"), fp: totals("fp"), fn: totals("fn"), claimTp: totals("claimTp"), claimFp: totals("claimFp"), claimFn: totals("claimFn") };
  metrics.precision = metrics.tp + metrics.fp ? metrics.tp / (metrics.tp + metrics.fp) : 1;
  metrics.recall = metrics.tp + metrics.fn ? metrics.tp / (metrics.tp + metrics.fn) : 1;
  metrics.f1 = metrics.precision + metrics.recall ? 2 * metrics.precision * metrics.recall / (metrics.precision + metrics.recall) : 0;
  metrics.claimPrecision = metrics.claimTp + metrics.claimFp ? metrics.claimTp / (metrics.claimTp + metrics.claimFp) : 1;
  metrics.claimRecall = metrics.claimTp + metrics.claimFn ? metrics.claimTp / (metrics.claimTp + metrics.claimFn) : 1;
  metrics.claimF1 = metrics.claimPrecision + metrics.claimRecall ? 2 * metrics.claimPrecision * metrics.claimRecall / (metrics.claimPrecision + metrics.claimRecall) : 0;
  metrics.rawFindingCount = results.reduce((total, result) => total + (result.actual || []).length, 0);
  metrics.validFindingCount = results.reduce((total, result) => total + (!result.validationError ? (result.actual || []).length : 0), 0);
  return metrics;
}

function writeSummary(results, metrics, model) {
  const report = { model, scenarioCount: results.length, exactPasses: results.filter(result => result.pass).length, metrics, results };
  fs.writeFileSync(path.join(outputRoot, "results.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
  fs.writeFileSync(path.join(root, "results.md"), renderMarkdown(results, metrics, model), "utf8");
  console.log(`\nSUMMARY: ${report.exactPasses}/${report.scenarioCount} cases passed.`);
  console.log(`Exact-evidence findings: TP=${metrics.tp}, FP=${metrics.fp}, FN=${metrics.fn}; precision=${metrics.precision.toFixed(3)}, recall=${metrics.recall.toFixed(3)}, F1=${metrics.f1.toFixed(3)}`);
  console.log(`Claim detection: TP=${metrics.claimTp}, FP=${metrics.claimFp}, FN=${metrics.claimFn}; precision=${metrics.claimPrecision.toFixed(3)}, recall=${metrics.claimRecall.toFixed(3)}, F1=${metrics.claimF1.toFixed(3)}`);
  console.log(`Exact changed-line validation: ${metrics.validFindingCount}/${metrics.rawFindingCount}`);
  console.log(`Full results: ${path.join(root, "results.md")}`);
  if (report.exactPasses !== report.scenarioCount) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch(error => {
    console.error(`Evaluation failed: ${error.stack || error.message}`);
    process.exitCode = 1;
  });
}

export { scoreCase, summarize };
