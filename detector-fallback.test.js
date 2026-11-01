const assert = require("node:assert/strict");
const { test } = require("node:test");
const { detectRemovedResponseFields } = require("./response-field-fallback");

const original = `app.get("/users", (req, res) => {
  res.json({
    success: true,
    count: users.length,
    users,
  });
});
`;

const updated = `app.get("/users", (req, res) => {
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

test("reports a documented removed count property with exact removed-line evidence", () => {
  const documentation = "GET /users returns a `count` field equal to the number of users.";
  assert.deepEqual(detectRemovedResponseFields({ originalCode: original, updatedCode: updated, diff, documentation }), [
    {
      outdated: true,
      sentence: "GET /users returns a `count` field equal to the number of users.",
      evidenceType: "removed",
      codeEvidence: "    count: users.length,",
      reason: "The documented count field was removed from the GET /users JSON response."
    }
  ]);
});

test("reports separate documented success and count claims once each", () => {
  const documentation = [
    "GET /users returns a `success` field set to true.",
    "GET /users returns a `count` field equal to the number of users."
  ].join("\n");
  const findings = detectRemovedResponseFields({ originalCode: original, updatedCode: updated, diff, documentation });
  assert.equal(findings.length, 2);
  assert.deepEqual(findings.map(item => item.sentence), [
    "GET /users returns a `success` field set to true.",
    "GET /users returns a `count` field equal to the number of users."
  ]);
  assert.deepEqual(findings.map(item => item.codeEvidence), ["    success: true,", "    count: users.length,"]);
});

test("uses exact count-line evidence for one sentence documenting several removed fields", () => {
  const sentence = "GET /users returns a JSON object containing success and count fields.";
  const findings = detectRemovedResponseFields({ originalCode: original, updatedCode: updated, diff, documentation: sentence });
  assert.equal(findings.length, 1);
  assert.equal(findings[0].sentence, sentence);
  assert.equal(findings[0].codeEvidence, "    count: users.length,");
  assert.match(findings[0].reason, /count field was removed/);
});

test("uses the endpoint heading as route context for documentation prose", () => {
  const originalApi = `app.get("/api/users", (req, res) => {
  res.status(200).json({
    success: true,
    count: users.length,
    data: users
  });
});`;
  const updatedApi = `app.get("/api/users", (req, res) => {
  res.status(200).json({
    data: users
  });
});`;
  const apiDiff = `@@ -1,7 +1,5 @@
app.get("/api/users", (req, res) => {
  res.status(200).json({
-    success: true,
-    count: users.length,
    data: users
  });
});`;
  const documentation = [
    "### GET `/api/users`",
    "",
    "Returns HTTP `200` with a JSON object containing `success`, `count`, and `data`."
  ].join("\n");
  const findings = detectRemovedResponseFields({
    originalCode: originalApi,
    updatedCode: updatedApi,
    diff: apiDiff,
    documentation
  });
  assert.equal(findings.length, 1);
  assert.equal(findings[0].codeEvidence, "    count: users.length,");
});

test("does not report a removed field when the updated response still contains it", () => {
  const stillHasCount = updated.replace("users,", "count: users.length,\n    users,");
  const documentation = "GET /users returns a `count` field equal to the number of users.";
  assert.deepEqual(detectRemovedResponseFields({ originalCode: original, updatedCode: stillHasCount, diff, documentation }), []);
});

test("does not infer undocumented or explicitly negated response claims", () => {
  const undocumented = "GET /users returns the user collection.";
  const negated = "GET /users does not return a `count` field.";
  assert.deepEqual(detectRemovedResponseFields({ originalCode: original, updatedCode: updated, diff, documentation: undocumented }), []);
  assert.deepEqual(detectRemovedResponseFields({ originalCode: original, updatedCode: updated, diff, documentation: negated }), []);
});

test("ignores a removed count field outside a JSON response", () => {
  const notResponseDiff = `diff --git a/app.js b/app.js
--- a/app.js
+++ b/app.js
@@ -1,3 +1,2 @@
 app.get("/users", (req, res) => {
-  const count = users.length;
   res.json(users);
 });
`;
  const changedOriginal = original.replace("    count: users.length,\n", "  const count = users.length;\n");
  const changedUpdated = updated.replace("  res.json({", "  const count = users.length;\n  res.json({");
  const documentation = "GET /users returns a `count` field equal to the number of users.";
  assert.deepEqual(detectRemovedResponseFields({ originalCode: changedOriginal, updatedCode: changedUpdated, diff: notResponseDiff, documentation }), []);
});
