import assert from 'node:assert/strict';
import test from 'node:test';
import api, {
  API_BASE_URL,
  analyzePullRequest,
  analyzeProject,
  getApiBaseUrl,
  getApiErrorMessage,
  getHealth,
  ingestGithubRepository,
  ingestPullRequest,
  uploadPdfDocuments,
} from '../docguard-frontend/src/services/api.js';

function installAdapter(testContext, data, status = 200) {
  const previousAdapter = api.defaults.adapter;
  const requests = [];
  api.defaults.adapter = async (config) => {
    requests.push(config);
    return {
      data,
      status,
      statusText: 'OK',
      headers: {},
      config,
      request: {},
    };
  };
  testContext.after(() => {
    api.defaults.adapter = previousAdapter;
  });
  return requests;
}

function requestBody(request) {
  return typeof request.data === 'string' ? JSON.parse(request.data) : request.data;
}

test('uses the configured API URL and defaults to the backend port 3000', () => {
  assert.equal(getApiBaseUrl({ VITE_API_URL: 'http://localhost:8000/api/' }), 'http://localhost:8000/api');
  assert.equal(getApiBaseUrl({ VITE_API_URL: '' }), 'http://localhost:3000/api');
  assert.equal(API_BASE_URL, 'http://localhost:3000/api');
  assert.equal(api.defaults.baseURL, API_BASE_URL);
});

test('calls the health endpoint through the shared client', async (testContext) => {
  const requests = installAdapter(testContext, { status: 'ok', service: 'docguard-ai-backend' });
  const result = await getHealth();

  assert.deepEqual(result, { status: 'ok', service: 'docguard-ai-backend' });
  assert.equal(requests[0].method, 'get');
  assert.equal(requests[0].url, '/health');
});

test('submits GitHub repositories with uploaded PDF references', async (testContext) => {
  const payload = {
    repositoryUrl: 'https://github.com/example/project',
    uploadedDocumentIds: ['pdf-reference-1'],
  };
  const requests = installAdapter(testContext, { projectId: 'project-reference' }, 201);
  const result = await ingestGithubRepository(payload);

  assert.equal(requests[0].url, '/projects/from-github');
  assert.deepEqual(requestBody(requests[0]), payload);
  assert.equal(result.projectId, 'project-reference');
});

test('uploads multiple PDFs under the backend documents multipart field', async (testContext) => {
  const requests = installAdapter(testContext, { documentation: [] }, 201);
  const firstPdf = new Blob(['%PDF-1.4'], { type: 'application/pdf' });
  const secondPdf = new Blob(['%PDF-1.4'], { type: 'application/pdf' });
  Object.defineProperty(firstPdf, 'name', { value: 'guide.pdf' });
  Object.defineProperty(secondPdf, 'name', { value: 'reference.pdf' });

  await uploadPdfDocuments([firstPdf, secondPdf]);

  const request = requests[0];
  assert.equal(request.url, '/projects/documents');
  assert.ok(request.data instanceof FormData);
  assert.deepEqual(request.data.getAll('documents').map((file) => file.name), ['guide.pdf', 'reference.pdf']);
  const contentType = request.headers.getContentType();
  assert.ok(!contentType || /boundary=/i.test(contentType));
});

test('analyzes the ingested project reference without resubmitting its repository', async (testContext) => {
  const requests = installAdapter(testContext, {
    projectId: 'project-id',
    analysis: { summary: 'No drift.', findings: [] },
  });
  const result = await analyzeProject('project-id');

  assert.equal(requests[0].method, 'post');
  assert.equal(requests[0].url, '/projects/project-id/analyze');
  assert.equal(requests[0].data, undefined);
  assert.deepEqual(result.analysis.findings, []);
});

test('submits pull request URLs to the change-context endpoint', async (testContext) => {
  const requests = installAdapter(testContext, { pullRequest: { number: 42 }, changeContext: {} });
  await ingestPullRequest('https://github.com/example/project/pull/42');

  assert.equal(requests[0].url, '/pull-requests/from-github');
  assert.deepEqual(requestBody(requests[0]), {
    pullRequestUrl: 'https://github.com/example/project/pull/42',
  });
});

test('submits pull request URLs to the analysis endpoint with its longer execution timeout', async (testContext) => {
  const requests = installAdapter(testContext, {
    pullRequest: { number: 42 },
    changeContext: {},
    driftAnalysis: { contract: 'drift-engine/v1' },
  });
  await analyzePullRequest('https://github.com/example/project/pull/42');

  assert.equal(requests[0].url, '/pull-requests/analyze');
  assert.equal(requests[0].timeout, 900_000);
  assert.deepEqual(requestBody(requests[0]), {
    pullRequestUrl: 'https://github.com/example/project/pull/42',
  });
});

test('extracts structured backend error messages for the UI', () => {
  assert.equal(
    getApiErrorMessage({ response: { data: { error: { code: 'PDF_ENCRYPTED', message: 'PDF is encrypted.' } } } }),
    'PDF is encrypted.',
  );
  assert.match(getApiErrorMessage({ code: 'ERR_NETWORK' }), /Could not connect to the backend/);
  assert.equal(getApiErrorMessage(new Error('The analysis response was incomplete.')), 'The analysis response was incomplete.');
});
