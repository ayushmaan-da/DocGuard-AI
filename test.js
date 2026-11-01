const fs = require("node:fs");
const { execFileSync } = require("node:child_process");
const { analyze } = require("./drift-engine");

const read = file => fs.readFileSync(file, "utf8");

async function main() {
  const documentation = read("README.md");
  const originalCode = execFileSync("git", ["show", "HEAD:app.js"], { encoding: "utf8" });
  const updatedCode = read("app.js");
  const diff = execFileSync("git", ["diff", "HEAD", "--unified=40", "--", "app.js"], { encoding: "utf8" });
  if (!diff.trim()) {
    console.log(JSON.stringify({ contract: "drift-engine/v1", findings: [], suggestions: [], diagnostics: { model: { status: "not-run-no-code-changes" }, counts: { changedLines: 0, modelFindingsReturned: 0, deterministicRuleMatches: 0, unverifiedSuggestions: 0 } } }, null, 2));
    return;
  }

  const result = await analyze({
    diff,
    docs: [{ file: "README.md", content: documentation }],
    originalCode,
    updatedCode,
    codeFile: "app.js",
    modelOptions: {
      model: process.env.OLLAMA_MODEL || "qwen2.5-coder:7b",
      url: process.env.OLLAMA_URL,
      numCtx: Number(process.env.OLLAMA_NUM_CTX || 8192)
    }
  });
  console.log(JSON.stringify(result, null, 2));
}

main().catch(error => {
  console.error(`Documentation drift check failed: ${error.message}`);
  process.exitCode = 1;
});
