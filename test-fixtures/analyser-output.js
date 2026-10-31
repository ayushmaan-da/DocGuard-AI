export function createAnalyserOutput(overrides = {}) {
  return {
    summary: 'The documentation describes a previous default value.',
    findings: [{
      severity: 'medium',
      title: 'Documented default differs from source',
      explanation: 'The source sets the timeout to 30 while the guide says 20.',
      sourceReferences: [{ path: 'src/config.js', startLine: 4, endLine: 4 }],
      documentationReferences: [{ path: 'docs/guide.pdf', pageNumber: 2, quote: 'timeout is 20' }],
      recommendation: 'Update the guide to describe the current timeout.',
    }],
    ...overrides,
  };
}

export function ollamaResponse(output, overrides = {}) {
  return new Response(JSON.stringify({
    model: 'test-model',
    done: true,
    message: {
      role: 'assistant',
      content: JSON.stringify(output),
    },
    ...overrides,
  }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}
