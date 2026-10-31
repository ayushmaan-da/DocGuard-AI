import assert from 'node:assert/strict';
import test from 'node:test';
import { ingestGitHubPullRequest } from '../src/services/github-pull-request-service.js';
import { HttpError } from '../src/utils/http-error.js';

const PULL_REQUEST_URL = 'https://github.com/example/project/pull/42';
const BASE_SHA = 'a'.repeat(40);
const HEAD_SHA = 'b'.repeat(40);

function jsonResponse(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function createMetadata(overrides = {}) {
  return {
    number: 42,
    title: 'Update configuration docs',
    state: 'open',
    html_url: PULL_REQUEST_URL,
    changed_files: 0,
    base: {
      ref: 'main',
      sha: BASE_SHA,
      repo: {
        full_name: 'example/project',
        private: false,
      },
    },
    head: {
      ref: 'docs/update-timeout',
      sha: HEAD_SHA,
    },
    ...overrides,
  };
}

function createChangedFile(filename, overrides = {}) {
  return {
    filename,
    status: 'modified',
    additions: 1,
    deletions: 1,
    changes: 2,
    patch: '@@ -1 +1 @@\n-old\n+new\n',
    ...overrides,
  };
}

function createGitHubMock({
  metadata = createMetadata(),
  files = [],
  overrides = {},
} = {}) {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url: String(url), options });
    const parsedUrl = new URL(url);
    if (overrides[parsedUrl.pathname]) {
      return overrides[parsedUrl.pathname](url, options);
    }
    if (parsedUrl.pathname === '/repos/example/project/pulls/42') {
      return jsonResponse(metadata);
    }
    if (parsedUrl.pathname === '/repos/example/project/pulls/42/files') {
      const page = Number(parsedUrl.searchParams.get('page'));
      const start = (page - 1) * 100;
      return jsonResponse(files.slice(start, start + 100));
    }
    throw new Error(`Unexpected GitHub request: ${url}`);
  };
  return { calls, fetchImpl };
}

const TEST_LIMITS = {
  maxFiles: 100,
  maxResponseBytes: 2 * 1024 * 1024,
  maxPatchBytes: 256 * 1024,
  maxTotalPatchBytes: 2 * 1024 * 1024,
  requestTimeoutMs: 100,
};

test('ingests PR metadata and separates source, documentation, binary, and other changes', async () => {
  const files = [
    createChangedFile('src/config.js', { status: 'modified' }),
    createChangedFile('docs/README.md', { status: 'modified' }),
    createChangedFile('assets/logo.png', {
      status: 'added',
      additions: 0,
      deletions: 0,
      changes: 0,
      patch: undefined,
    }),
    createChangedFile('src/generated.js', { patch: undefined }),
    createChangedFile('src/renamed.js', {
      status: 'renamed',
      previous_filename: 'src/old-name.js',
    }),
    createChangedFile('docs/removed.md', {
      status: 'removed',
      additions: 0,
      deletions: 5,
      changes: 5,
    }),
    createChangedFile('data/custom.unknown', { status: 'added' }),
  ];
  const { calls, fetchImpl } = createGitHubMock({
    metadata: createMetadata({ changed_files: files.length }),
    files,
  });

  const result = await ingestGitHubPullRequest(
    { pullRequestUrl: PULL_REQUEST_URL },
    { fetchImpl, limits: TEST_LIMITS },
  );

  assert.deepEqual(result.source, {
    type: 'github-pull-request',
    owner: 'example',
    repository: 'project',
    repositoryUrl: 'https://github.com/example/project',
  });
  assert.deepEqual(result.pullRequest, {
    number: 42,
    title: 'Update configuration docs',
    state: 'open',
    url: PULL_REQUEST_URL,
    base: { branch: 'main', commitSha: BASE_SHA },
    head: { branch: 'docs/update-timeout', commitSha: HEAD_SHA },
  });
  assert.deepEqual(result.changeContext.sourceChanges.map(({ path, status, originalPath }) => ({
    path,
    status,
    originalPath,
  })), [
    { path: 'src/config.js', status: 'modified', originalPath: null },
    { path: 'src/generated.js', status: 'modified', originalPath: null },
    { path: 'src/renamed.js', status: 'renamed', originalPath: 'src/old-name.js' },
  ]);
  assert.equal(result.changeContext.sourceChanges[1].patchStatus, 'not-provided');
  assert.equal(
    result.changeContext.sourceChanges[1].patchUnavailableReason,
    'patch-not-returned-by-github',
  );
  assert.deepEqual(result.changeContext.documentationChanges.map(({ path, status }) => ({
    path,
    status,
  })), [
    { path: 'docs/README.md', status: 'modified' },
    { path: 'docs/removed.md', status: 'removed' },
  ]);
  assert.equal(result.changeContext.binaryChanges[0].path, 'assets/logo.png');
  assert.equal(result.changeContext.binaryChanges[0].patchStatus, 'not-provided');
  assert.equal(result.changeContext.binaryChanges[0].patchUnavailableReason, 'binary-file');
  assert.equal(result.changeContext.otherChanges[0].classification, 'other');
  assert.deepEqual(result.changeContext.summary, {
    totalFiles: 7,
    sourceFiles: 3,
    documentationFiles: 2,
    binaryFiles: 1,
    otherFiles: 1,
    patchesAvailable: 5,
    patchesUnavailable: 2,
    patchesOmittedByLimit: 0,
  });
  assert.equal(calls.length, 2);
  assert.equal(calls[0].url, 'https://api.github.com/repos/example/project/pulls/42');
  assert.match(calls[1].url, /\/pulls\/42\/files\?per_page=100&page=1$/);
  assert.equal(calls[0].options.redirect, 'error');
  assert.equal(calls[0].options.headers['X-GitHub-Api-Version'], '2022-11-28');
});

test('omits Authorization when GITHUB_TOKEN is not configured', async () => {
  const originalToken = process.env.GITHUB_TOKEN;
  delete process.env.GITHUB_TOKEN;
  try {
    const { calls, fetchImpl } = createGitHubMock();
    await ingestGitHubPullRequest(
      { pullRequestUrl: PULL_REQUEST_URL },
      { fetchImpl, limits: TEST_LIMITS },
    );
    assert.equal(calls.length, 1);
    assert.equal(calls[0].options.headers.Authorization, undefined);
  } finally {
    if (originalToken !== undefined) {
      process.env.GITHUB_TOKEN = originalToken;
    }
  }
});

test('includes the configured Bearer token on metadata and paginated file requests', async () => {
  const testToken = 'test-token-not-a-real-credential';
  const originalToken = process.env.GITHUB_TOKEN;
  process.env.GITHUB_TOKEN = testToken;
  try {
    const files = Array.from({ length: 101 }, (_, index) => createChangedFile(`src/file-${index}.js`));
    const { calls, fetchImpl } = createGitHubMock({
      metadata: createMetadata({ changed_files: files.length }),
      files,
    });
    const result = await ingestGitHubPullRequest(
      { pullRequestUrl: PULL_REQUEST_URL },
      { fetchImpl, limits: { ...TEST_LIMITS, maxFiles: 150 } },
    );

    assert.equal(result.changeContext.summary.totalFiles, 101);
    assert.equal(calls.length, 3);
    assert.equal(calls.every(({ options }) => (
      options.headers.Authorization === `Bearer ${testToken}`
    )), true);
    assert.equal(JSON.stringify(result).includes(testToken), false);
  } finally {
    if (originalToken === undefined) {
      delete process.env.GITHUB_TOKEN;
    } else {
      process.env.GITHUB_TOKEN = originalToken;
    }
  }
});

test('does not expose configured token in errors or logs', async () => {
  const testToken = 'test-token-not-a-real-credential';
  const originalToken = process.env.GITHUB_TOKEN;
  const originalConsoleError = console.error;
  const originalConsoleWarn = console.warn;
  const originalConsoleLog = console.log;
  const logMessages = [];
  process.env.GITHUB_TOKEN = testToken;
  const captureLog = (...values) => {
    logMessages.push(values.map(String).join(' '));
  };
  console.error = captureLog;
  console.warn = captureLog;
  console.log = captureLog;
  try {
    await assert.rejects(
      ingestGitHubPullRequest(
        { pullRequestUrl: PULL_REQUEST_URL },
        {
          fetchImpl: async () => { throw new Error(testToken); },
          limits: TEST_LIMITS,
        },
      ),
      (error) => error.code === 'GITHUB_NETWORK_ERROR'
        && error.message.includes(testToken) === false,
    );
    assert.equal(logMessages.some((message) => message.includes(testToken)), false);
  } finally {
    console.error = originalConsoleError;
    console.warn = originalConsoleWarn;
    console.log = originalConsoleLog;
    if (originalToken === undefined) {
      delete process.env.GITHUB_TOKEN;
    } else {
      process.env.GITHUB_TOKEN = originalToken;
    }
  }
});

test('rejects invalid PR URLs before making a GitHub request', async () => {
  const invalidUrls = [
    '',
    'https://github.com/example/project',
    'http://github.com/example/project/pull/42',
    'https://github.com.evil.example/example/project/pull/42',
    'https://github.com/example/project/pull/0',
    'https://github.com/example/project/pull/01',
    'https://github.com/example/project/pull/1/files',
    'https://github.com/example/%2e%2e/pull/42',
    'https://github.com/example/project/pull/9007199254740992',
    'https://user@github.com/example/project/pull/42',
    'https://github.com/example/project/pull/42?tab=files',
  ];
  const { fetchImpl } = createGitHubMock();
  for (const pullRequestUrl of invalidUrls) {
    await assert.rejects(
      ingestGitHubPullRequest({ pullRequestUrl }, { fetchImpl, limits: TEST_LIMITS }),
      (error) => error instanceof HttpError
        && error.statusCode === 400
        && error.code === 'INVALID_PULL_REQUEST_URL',
      pullRequestUrl,
    );
  }
});

test('rejects invalid request data and mismatched or malformed PR metadata', async () => {
  await assert.rejects(
    ingestGitHubPullRequest(null, { fetchImpl: async () => assert.fail('must not fetch') }),
    (error) => error.code === 'INVALID_REQUEST',
  );
  for (const metadata of [
    { ...createMetadata(), number: 41 },
    { ...createMetadata(), base: { ...createMetadata().base, repo: { full_name: 'other/repo' } } },
    { ...createMetadata(), changed_files: -1 },
    { ...createMetadata(), base: { ...createMetadata().base, sha: 'not-a-commit' } },
    { ...createMetadata(), html_url: 'https://github.com/other/repo/pull/1' },
    { ...createMetadata(), base: { ...createMetadata().base, ref: '../main' } },
  ]) {
    const { fetchImpl } = createGitHubMock({ metadata });
    await assert.rejects(
      ingestGitHubPullRequest({ pullRequestUrl: PULL_REQUEST_URL }, { fetchImpl, limits: TEST_LIMITS }),
      (error) => error.statusCode === 502 && error.code === 'INVALID_GITHUB_PULL_REQUEST',
    );
  }

  const { fetchImpl } = createGitHubMock({
    metadata: {
      ...createMetadata(),
      base: { ...createMetadata().base, repo: { ...createMetadata().base.repo, private: true } },
    },
  });
  await assert.rejects(
    ingestGitHubPullRequest({ pullRequestUrl: PULL_REQUEST_URL }, { fetchImpl, limits: TEST_LIMITS }),
    (error) => error.statusCode === 404 && error.code === 'GITHUB_PULL_REQUEST_NOT_FOUND',
  );
});

test('handles GitHub API not-found, rate-limit, and upstream errors without leaking response details', async () => {
  for (const [status, code, expectedStatus] of [
    [404, 'GITHUB_PULL_REQUEST_NOT_FOUND', 404],
    [403, 'GITHUB_RATE_LIMITED', 503],
    [429, 'GITHUB_RATE_LIMITED', 503],
    [500, 'GITHUB_UPSTREAM_ERROR', 502],
  ]) {
    const { fetchImpl } = createGitHubMock({
      overrides: {
        '/repos/example/project/pulls/42': async () => jsonResponse({ message: 'private upstream detail' }, status),
      },
    });
    await assert.rejects(
      ingestGitHubPullRequest({ pullRequestUrl: PULL_REQUEST_URL }, { fetchImpl, limits: TEST_LIMITS }),
      (error) => error.statusCode === expectedStatus
        && error.code === code
        && !error.message.includes('private upstream detail'),
    );
  }
});

test('maps network failures and request timeouts to safe errors', async () => {
  await assert.rejects(
    ingestGitHubPullRequest(
      { pullRequestUrl: PULL_REQUEST_URL },
      { fetchImpl: async () => { throw new Error('private network detail'); }, limits: TEST_LIMITS },
    ),
    (error) => error.code === 'GITHUB_NETWORK_ERROR' && !error.message.includes('private'),
  );

  const timeoutFetch = (_url, { signal }) => new Promise((_resolve, reject) => {
    signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
  });
  await assert.rejects(
    ingestGitHubPullRequest(
      { pullRequestUrl: PULL_REQUEST_URL },
      { fetchImpl: timeoutFetch, limits: { ...TEST_LIMITS, requestTimeoutMs: 5 } },
    ),
    (error) => error.statusCode === 504 && error.code === 'GITHUB_REQUEST_TIMEOUT',
  );
});

test('rejects oversized and malformed GitHub responses', async () => {
  const largeResponse = new Response('x'.repeat(100), { status: 200 });
  await assert.rejects(
    ingestGitHubPullRequest(
      { pullRequestUrl: PULL_REQUEST_URL },
      {
        fetchImpl: async () => largeResponse,
        limits: { ...TEST_LIMITS, maxResponseBytes: 20 },
      },
    ),
    (error) => error.code === 'GITHUB_RESPONSE_TOO_LARGE',
  );

  const malformedJson = new Response('not json', { status: 200 });
  await assert.rejects(
    ingestGitHubPullRequest(
      { pullRequestUrl: PULL_REQUEST_URL },
      { fetchImpl: async () => malformedJson, limits: TEST_LIMITS },
    ),
    (error) => error.code === 'INVALID_GITHUB_RESPONSE',
  );
});

test('validates changed file shapes, paths, duplicates, and complete responses', async () => {
  const badCases = [
    {
      metadata: createMetadata({ changed_files: 1 }),
      files: [{ ...createChangedFile('../escape.js') }],
      code: 'INVALID_GITHUB_PULL_REQUEST_FILES',
    },
    {
      metadata: createMetadata({ changed_files: 1 }),
      files: [{ ...createChangedFile('src/a.js'), status: 'mystery' }],
      code: 'INVALID_GITHUB_PULL_REQUEST_FILES',
    },
    {
      metadata: createMetadata({ changed_files: 1 }),
      files: [{ ...createChangedFile('src/a.js'), status: 'renamed' }],
      code: 'INVALID_GITHUB_PULL_REQUEST_FILES',
    },
    {
      metadata: createMetadata({ changed_files: 2 }),
      files: [createChangedFile('src/a.js'), createChangedFile('src/a.js')],
      code: 'DUPLICATE_PULL_REQUEST_FILE',
    },
    {
      metadata: createMetadata({ changed_files: 2 }),
      files: [createChangedFile('src/a.js')],
      code: 'INCOMPLETE_GITHUB_PULL_REQUEST',
    },
  ];
  for (const { metadata, files, code } of badCases) {
    const { fetchImpl } = createGitHubMock({ metadata, files });
    await assert.rejects(
      ingestGitHubPullRequest({ pullRequestUrl: PULL_REQUEST_URL }, { fetchImpl, limits: TEST_LIMITS }),
      (error) => error.code === code,
    );
  }
});

test('paginates changed-file results and rejects a PR above the configured file limit', async () => {
  const files = Array.from({ length: 101 }, (_, index) => createChangedFile(`src/file-${index}.js`));
  const { calls, fetchImpl } = createGitHubMock({
    metadata: createMetadata({ changed_files: files.length }),
    files,
  });
  const result = await ingestGitHubPullRequest(
    { pullRequestUrl: PULL_REQUEST_URL },
    { fetchImpl, limits: { ...TEST_LIMITS, maxFiles: 150 } },
  );
  assert.equal(result.changeContext.sourceChanges.length, 101);
  assert.match(calls[2].url, /page=2$/);

  const limited = createGitHubMock({
    metadata: createMetadata({ changed_files: 2 }),
    files: [createChangedFile('src/a.js'), createChangedFile('src/b.js')],
  });
  await assert.rejects(
    ingestGitHubPullRequest(
      { pullRequestUrl: PULL_REQUEST_URL },
      { fetchImpl: limited.fetchImpl, limits: { ...TEST_LIMITS, maxFiles: 1 } },
    ),
    (error) => error.statusCode === 413 && error.code === 'PULL_REQUEST_FILE_LIMIT_EXCEEDED',
  );
  assert.equal(limited.calls.length, 1);

  const beyondGitHubApiLimit = createGitHubMock({
    metadata: createMetadata({ changed_files: 301 }),
  });
  await assert.rejects(
    ingestGitHubPullRequest(
      { pullRequestUrl: PULL_REQUEST_URL },
      { fetchImpl: beyondGitHubApiLimit.fetchImpl, limits: { ...TEST_LIMITS, maxFiles: 300 } },
    ),
    (error) => error.statusCode === 413 && error.code === 'PULL_REQUEST_FILE_LIMIT_EXCEEDED',
  );
  assert.equal(beyondGitHubApiLimit.calls.length, 1);
});

test('omits patches above per-file and aggregate limits while retaining change metadata', async () => {
  const files = [
    createChangedFile('src/large.js', { patch: 'x'.repeat(11) }),
    createChangedFile('src/aggregate.js', { patch: 'y'.repeat(8) }),
    createChangedFile('docs/next.md', { patch: 'z'.repeat(8) }),
  ];
  const { fetchImpl } = createGitHubMock({
    metadata: createMetadata({ changed_files: files.length }),
    files,
  });
  const result = await ingestGitHubPullRequest(
    { pullRequestUrl: PULL_REQUEST_URL },
    { fetchImpl, limits: { ...TEST_LIMITS, maxPatchBytes: 10, maxTotalPatchBytes: 10 } },
  );

  assert.equal(result.changeContext.sourceChanges[0].patch, null);
  assert.equal(result.changeContext.sourceChanges[0].patchStatus, 'omitted-per-file-limit');
  assert.equal(result.changeContext.sourceChanges[1].patch, 'yyyyyyyy');
  assert.equal(result.changeContext.documentationChanges[0].patch, null);
  assert.equal(result.changeContext.documentationChanges[0].patchStatus, 'omitted-total-limit');
  assert.equal(result.changeContext.summary.patchesOmittedByLimit, 2);
});

test('returns an empty change context for a Pull Request with no changed files', async () => {
  const { calls, fetchImpl } = createGitHubMock();
  const result = await ingestGitHubPullRequest(
    { pullRequestUrl: PULL_REQUEST_URL },
    { fetchImpl, limits: TEST_LIMITS },
  );
  assert.equal(result.changeContext.summary.totalFiles, 0);
  assert.equal(calls.length, 1);
});
