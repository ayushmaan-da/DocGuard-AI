const assert = require("node:assert/strict");
const { test } = require("node:test");
const { analyze } = require("./drift-engine.cjs");

const originalCode = `app.get("/users", (req, res) => {
  res.json({
    success: true,
    count: users.length,
    users,
  });
});
`;
const updatedCode = `app.get("/users", (req, res) => {
  res.json({
    users,
  });
});
`;
const diff = `diff --git a/app.js b/app.js
--- a/app.js
+++ b/app.js
@@ -1,7 +1,5 @@
 app.get("/users", (req, res) => {
   res.json({
-    success: true,
-    count: users.length,
     users,
   });
 });
`;

test("analyze exposes exact locations and keeps the combined-field fallback as a verified finding", async () => {
  const sentence = "GET /users returns a JSON object containing success and count fields.";
  const result = await analyze({
    diff,
    docs: [{ file: "docs/users.md", content: `# Users\n\n${sentence}` }],
    originalCode,
    updatedCode,
    callModel: async () => ({ findings: [{
      outdated: false,
      sentence: "GET /users returns a JSON object containing success and count fields.",
      evidenceType: "removed",
      codeEvidence: "    count: users.length,",
      reason: "The fields disappeared."
    }] })
  });

  assert.equal(result.contract, "drift-engine/v1");
  assert.equal(result.findings.length, 1);
  assert.equal(result.findings[0].documentation.file, "docs/users.md");
  assert.equal(result.findings[0].documentation.line, 3);
  assert.deepEqual(result.findings[0].codeEvidence, {
    file: "app.js", line: 4, changeType: "removed", text: "    count: users.length,"
  });
  assert.equal(result.findings[0].verification, "deterministic-rule-match");
  assert.deepEqual(result.suggestions, []);
});

test("returns exact model claims only as unverified suggestions", async () => {
  const sentence = "GET /admin returns a JSON object with a count field.";
  const result = await analyze({
    diff,
    docs: [{ file: "README.md", content: sentence }],
    originalCode,
    updatedCode,
    callModel: async () => ({ findings: [{
      outdated: true,
      sentence,
      evidenceType: "removed",
      codeEvidence: "    count: users.length,",
      reason: "The count field was removed."
    }] })
  });
  assert.equal(result.suggestions.length, 1);
  assert.equal(result.suggestions[0].outdated, null);
  assert.equal(result.suggestions[0].modelSaysOutdated, true);
  assert.equal(result.suggestions[0].verification, "unverified-model-suggestion");
  assert.equal(result.findings.length, 0);
});

test("assigns unique sequential IDs to multiple model suggestions", async () => {
  const first = "GET /admin returns a JSON object with a count field.";
  const second = "GET /reports returns a JSON object with a count field.";
  const result = await analyze({
    diff,
    docs: `${first}\n${second}`,
    originalCode,
    updatedCode,
    callModel: async () => ({ findings: [first, second].map(sentence => ({
      outdated: true,
      sentence,
      evidenceType: "removed",
      codeEvidence: "    count: users.length,",
      reason: "The count field was removed."
    })) })
  });
  assert.deepEqual(result.suggestions.map(item => item.id), ["model-1", "model-2"]);
});

test("resolves model evidence IDs to the exact changed line and diff side", async () => {
  const sentence = "GET /admin returns a JSON object with a count field.";
  const result = await analyze({
    diff,
    docs: [{ file: "README.md", content: sentence }],
    originalCode,
    updatedCode,
    callModel: async () => ({ findings: [{
      outdated: true,
      sentence,
      evidenceId: "E2",
      reason: "The count field was removed."
    }] })
  });
  assert.equal(result.suggestions.length, 1);
  assert.deepEqual(result.suggestions[0].codeEvidence, {
    file: "app.js", line: 4, changeType: "removed", text: "    count: users.length,"
  });
});

test("numbers added lines before removed lines so evidence IDs favor the updated implementation", async () => {
  const result = await analyze({
    diff: "@@ -1 +1 @@\n-const status = 201;\n+const status = 200;\n",
    docs: "POST /users returns status 201.",
    originalCode: "const status = 201;\n",
    updatedCode: "const status = 200;\n",
    callModel: async () => ({ findings: [{
      outdated: true,
      sentence: "POST /users returns status 201.",
      evidenceId: "E1",
      reason: "The status was changed."
    }] })
  });
  assert.equal(result.suggestions.length, 1);
  assert.equal(result.suggestions[0].codeEvidence.changeType, "added");
  assert.equal(result.suggestions[0].codeEvidence.text, "const status = 200;");
});

test("accepts multiple documentation files and reports the matching file and line", async () => {
  const sentence = "GET /users returns a JSON object with a count field.";
  const result = await analyze({
    diff,
    docs: [
      { file: "README.md", content: "# API\n\nGET /users returns the collection." },
      { file: "docs/users.md", content: `# Users\n\n${sentence}` }
    ],
    originalCode,
    updatedCode,
    callModel: async () => ({ findings: [] })
  });
  assert.equal(result.findings[0].documentation.file, "docs/users.md");
  assert.equal(result.findings[0].documentation.line, 3);
});

test("preserves PDF page references from extracted documentation", async () => {
  const sentence = "GET /users returns a JSON object with a count field.";
  const result = await analyze({
    diff,
    docs: [{
      file: "docs/guide.pdf",
      content: `--- Page 1 ---\nUnrelated text.\n\n--- Page 2 ---\n${sentence}`,
      pages: [{ pageNumber: 1, text: "Unrelated text." }, { pageNumber: 2, text: sentence }]
    }],
    originalCode,
    updatedCode,
    callModel: async () => ({ findings: [] })
  });
  assert.equal(result.findings[0].documentation.file, "docs/guide.pdf");
  assert.equal(result.findings[0].documentation.pageNumber, 2);
});

test("keeps deterministic findings available if the model request fails", async () => {
  const sentence = "GET /users returns a JSON object with a count field.";
  const result = await analyze({
    diff,
    docs: sentence,
    originalCode,
    updatedCode,
    callModel: async () => { throw new Error("Ollama offline"); }
  });
  assert.equal(result.findings.length, 1);
  assert.equal(result.suggestions.length, 0);
  assert.equal(result.diagnostics.model.status, "unavailable-or-invalid");
});

test("does not call the model or return invented suggestions when the diff has no changed lines", async () => {
  let modelCalls = 0;
  const result = await analyze({
    diff: "diff --git a/app.js b/app.js\n--- a/app.js\n+++ b/app.js\n",
    docs: "POST /users creates a user.",
    originalCode,
    updatedCode,
    callModel: async () => {
      modelCalls++;
      return { findings: [{ outdated: true }] };
    }
  });
  assert.equal(modelCalls, 0);
  assert.deepEqual(result.findings, []);
  assert.deepEqual(result.suggestions, []);
  assert.equal(result.diagnostics.model.status, "not-run-no-code-changes");
});

test("rejects malformed engine inputs instead of returning a misleading empty result", async () => {
  await assert.rejects(analyze({ diff: "", docs: [{ file: "README.md" }], originalCode, updatedCode }), /docs must be/);
});
