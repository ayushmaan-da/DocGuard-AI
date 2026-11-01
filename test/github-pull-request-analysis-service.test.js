import assert from 'node:assert/strict';
import test from 'node:test';
import { analyzeGitHubPullRequest } from '../src/services/github-pull-request-analysis-service.js';
import { HttpError } from '../src/utils/http-error.js';

const originalCode = `app.get("/users", (req, res) => {
  res.json({
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
const diff = `@@ -1,7 +1,5 @@
app.get("/users", (req, res) => {
  res.json({
-    count: users.length,
     users,
   });
 });
`;

function createPullRequestResult() {
  return {
    source: {
      type: 'github-pull-request',
      repositoryUrl: 'https://github.com/example/project',
    },
    pullRequest: {
      head: {
        commitSha: 'b'.repeat(40),
        repositoryUrl: 'https://github.com/contributor/fork',
      },
    },
    changeContext: {
      sourceChanges: [{ path: 'src/users.js', patchStatus: 'available' }],
    },
    sourceSnapshots: [
      { path: 'src/users.js', diff, originalCode, updatedCode },
      { path: 'src/ignored.js', diff: null, skipReason: 'patch-not-returned-by-github' },
    ],
  };
}

test('analyzes exact PR revisions and keeps deterministic findings separate from model suggestions', async () => {
  let repositoryInput;
  const result = await analyzeGitHubPullRequest(
    { pullRequestUrl: 'https://github.com/example/project/pull/42' },
    {
      ingestPullRequest: async (_input, options) => {
        assert.equal(options.includeSourceContents, true);
        return createPullRequestResult();
      },
      ingestRepository: async (input, options) => {
        repositoryInput = { input, options };
        return {
          analyserInput: {
            documentation: {
              files: [{
                path: 'docs/api.md',
                extractedText: [
                  '# API',
                  '',
                  '### GET `/users`',
                  '',
                  'GET /users returns a `count` field.',
                  'GET /admin returns a JSON object with a count field.',
                ].join('\n'),
              }],
            },
          },
        };
      },
      getModelConfiguration: () => ({ model: 'test-model' }),
      callModel: async () => ({
        findings: [{
          outdated: true,
          sentence: 'GET /admin returns a JSON object with a count field.',
          evidenceId: 'E1',
          reason: 'The model suggests this claim may be outdated.',
        }],
      }),
    },
  );

  assert.deepEqual(repositoryInput.input, {
    repositoryUrl: 'https://github.com/contributor/fork',
    ref: 'b'.repeat(40),
  });
  assert.equal(repositoryInput.options.documentationOnly, true);
  assert.equal(result.driftAnalysis.filesAnalyzed, 1);
  assert.deepEqual(result.driftAnalysis.filesSkipped, [{
    path: 'src/ignored.js',
    reason: 'patch-not-returned-by-github',
  }]);
  assert.equal(result.driftAnalysis.findings.length, 1);
  assert.equal(result.driftAnalysis.findings[0].documentation.file, 'docs/api.md');
  assert.deepEqual(result.driftAnalysis.findings[0].codeEvidence, {
    file: 'src/users.js',
    line: 3,
    changeType: 'removed',
    text: '    count: users.length,',
  });
  assert.equal(result.driftAnalysis.findings[0].verification, 'deterministic-rule-match');
  assert.equal(result.driftAnalysis.suggestions.length, 1);
  assert.equal(result.driftAnalysis.suggestions[0].verification, 'unverified-model-suggestion');
  assert.equal(result.driftAnalysis.suggestions[0].outdated, null);
  assert.equal('sourceSnapshots' in result, false);
});

test('does not claim PR drift when no readable documentation exists at the head revision', async () => {
  await assert.rejects(
    analyzeGitHubPullRequest(
      { pullRequestUrl: 'https://github.com/example/project/pull/42' },
      {
        ingestPullRequest: async () => createPullRequestResult(),
        ingestRepository: async () => ({ analyserInput: { documentation: { files: [] } } }),
        getModelConfiguration: () => ({ model: 'test-model' }),
        callModel: async () => assert.fail('must not call the model without documentation'),
      },
    ),
    (error) => error instanceof HttpError
      && error.statusCode === 422
      && error.code === 'PULL_REQUEST_DOCUMENTATION_UNAVAILABLE',
  );
});

test('preserves verified findings when Ollama configuration is invalid', async () => {
  const result = await analyzeGitHubPullRequest(
    { pullRequestUrl: 'https://github.com/example/project/pull/42' },
    {
      ingestPullRequest: async () => createPullRequestResult(),
      ingestRepository: async () => ({
        analyserInput: {
          documentation: {
            files: [{
              path: 'docs/api.md',
              extractedText: 'GET /users returns a `count` field.',
            }],
          },
        },
      }),
      getModelConfiguration: () => {
        throw new HttpError(500, 'ANALYSER_CONFIGURATION_ERROR', 'Ollama configuration is invalid.');
      },
    },
  );

  assert.equal(result.driftAnalysis.findings.length, 1);
  assert.equal(result.driftAnalysis.diagnostics.files[0].model.status, 'unavailable-or-invalid');
  assert.equal(result.driftAnalysis.diagnostics.files[0].model.detail, 'Ollama configuration is invalid.');
});
