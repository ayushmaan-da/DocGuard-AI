import assert from 'node:assert/strict';
import test from 'node:test';
import { getOllamaConfiguration, analyzeWithOllama } from '../src/services/ollama-analyser-service.js';
import { validateAnalyserOutput } from '../src/services/analyser-response-validator.js';
import { createAnalyserOutput, ollamaResponse } from '../test-fixtures/analyser-output.js';

const PROJECT = {
  project: {
    name: 'sample',
    source: {
      type: 'github',
      repositoryUrl: 'https://github.com/example/sample',
      ref: 'main',
      commitSha: 'a'.repeat(40),
    },
    sourceFiles: [{
      path: 'src/app.js',
      content: '\uFEFFconst title = "DocGuard";\r\n',
      originalBytesBase64: 'must-not-be-sent',
    }],
    documentation: [{
      path: 'docs/guide.pdf',
      filename: 'guide.pdf',
      source: 'github',
      format: 'text/plain',
      originalFormat: 'application/pdf',
      extractedText: '--- Page 1 ---\nGuide page',
      pages: [{ pageNumber: 1, text: 'Guide page' }],
      original: { referenceId: 'must-not-be-sent' },
    }],
    warnings: [],
  },
};

function configuration(overrides = {}) {
  return {
    endpoint: 'http://127.0.0.1:11434/api/chat',
    model: 'test-model',
    requestTimeoutMs: 100,
    maxResponseBytes: 2 * 1024 * 1024,
    maxInputBytes: 15 * 1024 * 1024,
    ...overrides,
  };
}

test('prepares separate original source and PDF documentation with project metadata', async () => {
  let requestUrl;
  let requestOptions;
  const result = await analyzeWithOllama(PROJECT, {
    configuration: configuration(),
    fetchImpl: async (url, options) => {
      requestUrl = url;
      requestOptions = options;
      return ollamaResponse(createAnalyserOutput());
    },
  });

  assert.equal(requestUrl, 'http://127.0.0.1:11434/api/chat');
  assert.equal(requestOptions.method, 'POST');
  assert.equal(requestOptions.redirect, 'error');
  const request = JSON.parse(requestOptions.body);
  assert.equal(request.model, 'test-model');
  assert.equal(request.stream, false);
  assert.equal(request.format.type, 'object');
  assert.equal(request.messages[0].role, 'system');
  assert.match(request.messages[0].content, /untrusted data/);
  const input = JSON.parse(request.messages[1].content);
  assert.deepEqual(input.metadata, {
    projectName: 'sample',
    type: 'github',
    repositoryUrl: 'https://github.com/example/sample',
    ref: 'main',
    commitSha: 'a'.repeat(40),
  });
  assert.deepEqual(input.sourceFiles, [{
    path: 'src/app.js',
    content: '\uFEFFconst title = "DocGuard";\r\n',
  }]);
  assert.deepEqual(input.documentation, PROJECT.project.documentation.map(({
    original,
    ...document
  }) => document));
  assert.equal(request.messages[1].content.includes('must-not-be-sent'), false);
  assert.deepEqual(result, {
    model: 'test-model',
    analysis: createAnalyserOutput(),
  });
});

test('requires a configured model and validates the Ollama base URL', async () => {
  assert.throws(
    () => getOllamaConfiguration({ OLLAMA_BASE_URL: 'https://user:secret@example.com' }),
    (error) => error.code === 'ANALYSER_CONFIGURATION_ERROR',
  );
  assert.throws(
    () => getOllamaConfiguration({ OLLAMA_BASE_URL: 'file:///tmp/ollama' }),
    (error) => error.code === 'ANALYSER_CONFIGURATION_ERROR',
  );
  assert.throws(
    () => getOllamaConfiguration({ OLLAMA_BASE_URL: 'http://localhost:11434/evil' }),
    (error) => error.code === 'ANALYSER_CONFIGURATION_ERROR',
  );
  await assert.rejects(
    analyzeWithOllama(PROJECT, {
      configuration: configuration({ model: '' }),
      fetchImpl: async () => assert.fail('must not fetch without a configured model'),
    }),
    (error) => error.code === 'ANALYSER_NOT_CONFIGURED',
  );
});

test('maps connection failures, timeouts, HTTP errors, and model errors safely', async () => {
  await assert.rejects(
    analyzeWithOllama(PROJECT, {
      configuration: configuration(),
      fetchImpl: async () => {
        throw new Error('secret host and stack should not escape');
      },
    }),
    (error) => error.statusCode === 503
      && error.code === 'ANALYSER_UNAVAILABLE'
      && !error.message.includes('secret'),
  );

  await assert.rejects(
    analyzeWithOllama(PROJECT, {
      configuration: configuration({ requestTimeoutMs: 5 }),
      fetchImpl: (_url, { signal }) => new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
      }),
    }),
    (error) => error.statusCode === 504 && error.code === 'ANALYSER_TIMEOUT',
  );

  await assert.rejects(
    analyzeWithOllama(PROJECT, {
      configuration: configuration(),
      fetchImpl: async () => new Response('private model details', { status: 500 }),
    }),
    (error) => error.statusCode === 502
      && error.code === 'ANALYSER_HTTP_ERROR'
      && !error.message.includes('private'),
  );

  await assert.rejects(
    analyzeWithOllama(PROJECT, {
      configuration: configuration(),
      fetchImpl: async () => new Response(JSON.stringify({ error: 'model unavailable' }), { status: 200 }),
    }),
    (error) => error.code === 'ANALYSER_MODEL_ERROR'
      && !error.message.includes('model unavailable'),
  );

  await assert.rejects(
    analyzeWithOllama(PROJECT, {
      configuration: configuration(),
      fetchImpl: async () => new Response('not found', { status: 404 }),
    }),
    (error) => error.statusCode === 503 && error.code === 'ANALYSER_MODEL_UNAVAILABLE',
  );
});

test('rejects malformed, incomplete, invalid, and oversized Ollama responses', async () => {
  for (const [response, expectedCode] of [
    [new Response('not json', { status: 200 }), 'INVALID_ANALYSER_RESPONSE'],
    [new Response(JSON.stringify({ done: false, message: { role: 'assistant', content: '{}' } }), { status: 200 }), 'INVALID_ANALYSER_RESPONSE'],
    [ollamaResponse({ summary: 'missing findings' }), 'INVALID_ANALYSER_OUTPUT'],
    [ollamaResponse({
      summary: 'invalid severity',
      findings: [{ ...createAnalyserOutput().findings[0], severity: 'urgent' }],
    }), 'INVALID_ANALYSER_OUTPUT'],
    [ollamaResponse({
      summary: 'missing field',
      findings: [{ severity: 'low', title: 'title' }],
    }), 'INVALID_ANALYSER_OUTPUT'],
    [new Response('x'.repeat(100), { status: 200 }), 'ANALYSER_RESPONSE_TOO_LARGE'],
  ]) {
    await assert.rejects(
      analyzeWithOllama(PROJECT, {
        configuration: configuration({
          maxResponseBytes: expectedCode === 'ANALYSER_RESPONSE_TOO_LARGE' ? 50 : 2 * 1024 * 1024,
        }),
        fetchImpl: async () => response,
      }),
      (error) => error.code === expectedCode,
    );
  }
});

test('rejects oversized prepared inputs without contacting Ollama', async () => {
  await assert.rejects(
    analyzeWithOllama(PROJECT, {
      configuration: configuration({ maxInputBytes: 10 }),
      fetchImpl: async () => assert.fail('must not fetch an oversized input'),
    }),
    (error) => error.statusCode === 413 && error.code === 'ANALYSER_INPUT_TOO_LARGE',
  );
});

test('validates findings while preserving valid analyser output', () => {
  const output = createAnalyserOutput();
  assert.equal(validateAnalyserOutput(output), output);
  for (const invalid of [
    null,
    { summary: '', findings: [] },
    { summary: 'ok', findings: 'no findings array' },
    { summary: 'ok', findings: [{ ...output.findings[0], documentationReferences: [{ path: '' }] }] },
    { summary: 'ok', findings: [{ ...output.findings[0], extra: 'unexpected' }] },
  ]) {
    assert.throws(
      () => validateAnalyserOutput(invalid),
      (error) => error.code === 'INVALID_ANALYSER_OUTPUT',
    );
  }
});
