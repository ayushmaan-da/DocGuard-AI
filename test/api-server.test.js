import assert from 'node:assert/strict';
import { request as createRequest } from 'node:http';
import test from 'node:test';
import { createApp } from '../src/app.js';
import { HttpError } from '../src/utils/http-error.js';

async function startTestServer(testContext, options) {
  const server = createApp(options);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });

  testContext.after(async () => {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  });

  return server.address().port;
}

function sendRequest(port, path, { method = 'GET', body, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const request = createRequest({
      hostname: '127.0.0.1',
      port,
      path,
      method,
      headers,
    }, (response) => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => {
        body += chunk;
      });
      response.on('end', () => {
        resolve({
          statusCode: response.statusCode,
          contentType: response.headers['content-type'],
          headers: response.headers,
          body: body ? JSON.parse(body) : undefined,
        });
      });
    });

    request.on('error', reject);
    request.end(body);
  });
}

function sendJsonRequest(port, path, payload, method = 'POST') {
  return sendRequest(port, path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

test('GET /api/health returns a successful JSON health response', async (testContext) => {
  const port = await startTestServer(testContext);
  const response = await sendRequest(port, '/api/health');

  assert.equal(response.statusCode, 200);
  assert.match(response.contentType, /application\/json/);
  assert.deepEqual(response.body, {
    status: 'ok',
    service: 'docguard-ai-backend',
  });
});

test('health endpoint accepts query parameters', async (testContext) => {
  const port = await startTestServer(testContext);
  const response = await sendRequest(port, '/api/health?check=ready');

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.status, 'ok');
});

test('allows Vite development origins and answers CORS preflight requests', async (testContext) => {
  const port = await startTestServer(testContext, {
    corsOrigins: ['http://localhost:5173'],
  });
  const response = await sendRequest(port, '/api/projects/from-github', {
    method: 'OPTIONS',
    headers: {
      Origin: 'http://localhost:5173',
      'Access-Control-Request-Method': 'POST',
      'Access-Control-Request-Headers': 'content-type',
    },
  });

  assert.equal(response.statusCode, 204);
  assert.equal(response.headers['access-control-allow-origin'], 'http://localhost:5173');
  assert.match(response.headers['access-control-allow-methods'], /POST/);
  assert.match(response.headers['access-control-allow-headers'], /Content-Type/i);
});

test('rejects origins not explicitly allowed by the local CORS policy', async (testContext) => {
  const port = await startTestServer(testContext, {
    corsOrigins: ['http://localhost:5173'],
  });
  const response = await sendRequest(port, '/api/health', {
    headers: { Origin: 'https://untrusted.example' },
  });

  assert.equal(response.statusCode, 403);
  assert.equal(response.body.error.code, 'CORS_ORIGIN_NOT_ALLOWED');
  assert.equal(response.headers['access-control-allow-origin'], undefined);
});

test('unknown routes return a JSON 404 response', async (testContext) => {
  const port = await startTestServer(testContext);
  const response = await sendRequest(port, '/api/unknown');

  assert.equal(response.statusCode, 404);
  assert.match(response.contentType, /application\/json/);
  assert.deepEqual(response.body, {
    error: { code: 'NOT_FOUND', message: 'Route not found.' },
  });
});

test('unsupported methods return a JSON 404 response', async (testContext) => {
  const port = await startTestServer(testContext);
  const response = await sendRequest(port, '/api/health', { method: 'POST' });

  assert.equal(response.statusCode, 404);
  assert.deepEqual(response.body, {
    error: { code: 'NOT_FOUND', message: 'Route not found.' },
  });
});

test('POST /api/projects returns validated project files without changing contents', async (testContext) => {
  const port = await startTestServer(testContext);
  const payload = {
    project: {
      name: 'sample',
      files: [
        { path: 'src/app.js', content: 'const x = 1;\r\n' },
        { path: 'docs/README.md', content: '# Original  \n' },
        { path: 'data/config.json', content: '{"x":1}' },
      ],
    },
  };
  const response = await sendJsonRequest(port, '/api/projects', payload);

  assert.equal(response.statusCode, 201);
  assert.deepEqual(response.body.project, {
    name: 'sample',
    files: [
      { path: 'src/app.js', content: 'const x = 1;\r\n', category: 'source' },
      { path: 'docs/README.md', content: '# Original  \n', category: 'documentation' },
      { path: 'data/config.json', content: '{"x":1}', category: 'other' },
    ],
  });
  assert.match(response.body.projectId, /^[0-9a-f-]{36}$/i);
  assert.ok(Number.isFinite(Date.parse(response.body.expiresAt)));
});

test('POST /api/projects accepts an empty project', async (testContext) => {
  const port = await startTestServer(testContext);
  const response = await sendJsonRequest(port, '/api/projects', {
    project: { name: 'empty', files: [] },
  });

  assert.equal(response.statusCode, 201);
  assert.deepEqual(response.body.project, { name: 'empty', files: [] });
  assert.match(response.body.projectId, /^[0-9a-f-]{36}$/i);
});

test('POST /api/projects returns a consistent error for unsafe paths', async (testContext) => {
  const port = await startTestServer(testContext);
  const response = await sendJsonRequest(port, '/api/projects', {
    project: {
      name: 'unsafe',
      files: [{ path: '../outside.js', content: 'untouched' }],
    },
  });

  assert.equal(response.statusCode, 400);
  assert.match(response.contentType, /application\/json/);
  assert.deepEqual(response.body, {
    error: {
      code: 'UNSAFE_FILE_PATH',
      message: 'File path "../outside.js" is not a safe relative path.',
    },
  });
});

test('POST /api/projects rejects duplicate file paths', async (testContext) => {
  const port = await startTestServer(testContext);
  const response = await sendJsonRequest(port, '/api/projects', {
    project: {
      name: 'duplicate',
      files: [
        { path: 'src/app.js', content: 'one' },
        { path: 'src/app.js', content: 'two' },
      ],
    },
  });

  assert.equal(response.statusCode, 400);
  assert.equal(response.body.error.code, 'DUPLICATE_FILE_PATH');
});

test('project endpoint reports malformed JSON and unsupported content types', async (testContext) => {
  const port = await startTestServer(testContext);
  const malformedResponse = await sendRequest(port, '/api/projects', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{"project":',
  });
  const mediaTypeResponse = await sendRequest(port, '/api/projects', {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain' },
    body: 'not json',
  });

  assert.equal(malformedResponse.statusCode, 400);
  assert.equal(malformedResponse.body.error.code, 'INVALID_JSON');
  assert.equal(mediaTypeResponse.statusCode, 415);
  assert.equal(mediaTypeResponse.body.error.code, 'UNSUPPORTED_MEDIA_TYPE');
});

test('project endpoint rejects invalid UTF-8 instead of replacing original bytes', async (testContext) => {
  const port = await startTestServer(testContext);
  const response = await sendRequest(port, '/api/projects', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: Buffer.from([0x7b, 0x22, 0x78, 0x22, 0x3a, 0x22, 0xff, 0x22, 0x7d]),
  });

  assert.equal(response.statusCode, 400);
  assert.equal(response.body.error.code, 'INVALID_JSON');
});

test('project endpoint rejects oversized request bodies', async (testContext) => {
  const port = await startTestServer(testContext);
  const response = await sendRequest(port, '/api/projects', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: ' '.repeat(10 * 1024 * 1024 + 1),
  });

  assert.equal(response.statusCode, 413);
  assert.equal(response.body.error.code, 'REQUEST_TOO_LARGE');
});

test('POST /api/projects/from-github returns the ingested project', async (testContext) => {
  let receivedInput;
  const port = await startTestServer(testContext, {
    ingestRepository: async (input) => {
      receivedInput = input;
      return {
        project: {
          name: 'project',
          files: [{ path: 'docs/README.md', content: '# Original\n', category: 'documentation' }],
        },
        source: {
          type: 'github',
          repositoryUrl: 'https://github.com/example/project',
          ref: 'main',
          commitSha: 'a'.repeat(40),
        },
        summary: { totalFiles: 1, sourceFiles: 0, documentationFiles: 1, otherFiles: 0 },
        unsupportedAssets: [],
      };
    },
  });
  const response = await sendJsonRequest(port, '/api/projects/from-github', {
    repositoryUrl: 'https://github.com/example/project',
  });

  assert.equal(response.statusCode, 201);
  assert.equal(receivedInput.repositoryUrl, 'https://github.com/example/project');
  assert.deepEqual(response.body.project.files, [
    { path: 'docs/README.md', content: '# Original\n', category: 'documentation' },
  ]);
  assert.equal(response.body.source.ref, 'main');
  assert.match(response.body.projectId, /^[0-9a-f-]{36}$/i);
});

test('GitHub ingestion endpoint returns service errors as consistent JSON', async (testContext) => {
  const port = await startTestServer(testContext, {
    ingestRepository: async () => {
      throw new HttpError(413, 'REPOSITORY_FILE_LIMIT_EXCEEDED', 'Repository exceeds the supported file count.');
    },
  });
  const response = await sendJsonRequest(port, '/api/projects/from-github', {
    repositoryUrl: 'https://github.com/example/project',
  });

  assert.equal(response.statusCode, 413);
  assert.deepEqual(response.body, {
    error: {
      code: 'REPOSITORY_FILE_LIMIT_EXCEEDED',
      message: 'Repository exceeds the supported file count.',
    },
  });
});

test('POST /api/pull-requests/from-github returns prepared PR change context', async (testContext) => {
  let receivedInput;
  const expectedContext = {
    source: {
      type: 'github-pull-request',
      owner: 'example',
      repository: 'project',
      repositoryUrl: 'https://github.com/example/project',
    },
    pullRequest: {
      number: 42,
      title: 'Update docs',
      state: 'open',
      url: 'https://github.com/example/project/pull/42',
      base: { branch: 'main', commitSha: 'a'.repeat(40) },
      head: { branch: 'feature/docs', commitSha: 'b'.repeat(40) },
    },
    changeContext: {
      sourceChanges: [],
      documentationChanges: [],
      binaryChanges: [],
      otherChanges: [],
      summary: { totalFiles: 0 },
    },
  };
  const port = await startTestServer(testContext, {
    ingestPullRequest: async (input) => {
      receivedInput = input;
      return expectedContext;
    },
  });
  const response = await sendJsonRequest(port, '/api/pull-requests/from-github', {
    pullRequestUrl: 'https://github.com/example/project/pull/42',
  });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(receivedInput, { pullRequestUrl: 'https://github.com/example/project/pull/42' });
  assert.deepEqual(response.body, expectedContext);
});

test('PR ingestion endpoint returns safe GitHub errors as consistent JSON', async (testContext) => {
  const port = await startTestServer(testContext, {
    ingestPullRequest: async () => {
      throw new HttpError(503, 'GITHUB_RATE_LIMITED', 'GitHub API rate limit was reached.');
    },
  });
  const response = await sendJsonRequest(port, '/api/pull-requests/from-github', {
    pullRequestUrl: 'https://github.com/example/project/pull/42',
  });

  assert.equal(response.statusCode, 503);
  assert.deepEqual(response.body, {
    error: {
      code: 'GITHUB_RATE_LIMITED',
      message: 'GitHub API rate limit was reached.',
    },
  });
});

test('POST /api/pull-requests/analyze returns the PR-specific drift engine contract', async (testContext) => {
  let receivedInput;
  const expectedAnalysis = {
    contract: 'drift-engine/v1',
    filesAnalyzed: 1,
    findings: [],
    suggestions: [],
    diagnostics: { status: 'analysis-completed', files: [] },
  };
  const port = await startTestServer(testContext, {
    runPullRequestAnalysis: async (input) => {
      receivedInput = input;
      return {
        source: { type: 'github-pull-request' },
        pullRequest: { number: 42 },
        changeContext: { sourceChanges: [] },
        driftAnalysis: expectedAnalysis,
      };
    },
  });
  const response = await sendJsonRequest(port, '/api/pull-requests/analyze', {
    pullRequestUrl: 'https://github.com/example/project/pull/42',
  });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(receivedInput, { pullRequestUrl: 'https://github.com/example/project/pull/42' });
  assert.deepEqual(response.body.driftAnalysis, expectedAnalysis);
});

test('POST /api/projects/:projectId/analyze analyzes a stored project without re-uploading files', async (testContext) => {
  let receivedProject;
  const port = await startTestServer(testContext, {
    runAnalysis: async (project) => {
      receivedProject = project;
      return {
        model: 'mock-model',
        analysis: { summary: 'No drift found.', findings: [] },
      };
    },
  });
  const projectResponse = await sendJsonRequest(port, '/api/projects', {
    project: {
      name: 'sample',
      files: [
        { path: 'src/app.js', content: '\uFEFFconst ready = true;\r\n' },
        { path: 'docs/README.md', content: '# Sample docs\n' },
        { path: 'asset.bin', content: 'not source text' },
      ],
    },
  });
  const projectId = projectResponse.body.projectId;
  const analysisResponse = await sendRequest(port, `/api/projects/${projectId}/analyze`, {
    method: 'POST',
  });

  assert.equal(analysisResponse.statusCode, 200);
  assert.deepEqual(analysisResponse.body, {
    projectId,
    analysis: { summary: 'No drift found.', findings: [] },
  });
  assert.deepEqual(receivedProject.project.sourceFiles, [{
    path: 'src/app.js',
    content: '\uFEFFconst ready = true;\r\n',
  }]);
  assert.deepEqual(receivedProject.project.documentation.map(({ path, extractedText }) => ({
    path,
    extractedText,
  })), [{ path: 'docs/README.md', extractedText: '# Sample docs\n' }]);
  assert.equal(JSON.stringify(receivedProject).includes('asset.bin'), false);
});

test('analysis endpoint rejects invalid or expired project references with JSON errors', async (testContext) => {
  const port = await startTestServer(testContext);
  const response = await sendRequest(port, '/api/projects/not-a-project/analyze', { method: 'POST' });
  assert.equal(response.statusCode, 404);
  assert.deepEqual(response.body.error, {
    code: 'PROJECT_REFERENCE_NOT_FOUND',
    message: 'The project reference is invalid or has expired.',
  });
});
