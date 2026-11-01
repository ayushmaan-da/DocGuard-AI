import assert from 'node:assert/strict';
import test from 'node:test';
import { scoreCase } from './evaluate.js';

const expected = [{
  outdated: true,
  sentence: "POST /users responds with HTTP status 201.",
  evidenceType: "added",
  codeEvidence: "  res.status(200).json(req.body);"
}];

test("exact case scoring rejects the old line when the new line is expected as evidence", () => {
  const modelOutput = [{
    outdated: true,
    sentence: expected[0].sentence,
    evidenceType: "removed",
    codeEvidence: "  res.status(201).json(req.body);"
  }];
  const score = scoreCase(expected, modelOutput, null);
  assert.equal(score.tp, 0);
  assert.equal(score.fp, 1);
  assert.equal(score.fn, 1);
  assert.equal(score.claimTp, 1);
  assert.equal(score.pass, false);
});

test("exact case scoring passes only when sentence, side, and evidence line match", () => {
  const score = scoreCase(expected, expected, null);
  assert.equal(score.tp, 1);
  assert.equal(score.fp, 0);
  assert.equal(score.fn, 0);
  assert.equal(score.pass, true);
});
