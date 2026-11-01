import assert from 'node:assert/strict';
import test from 'node:test';
import cases from './cases.js';
import { analyzeDocumentationDrift } from '../drift-engine.js';

const EMPTY_ANALYSIS = {
  summary: 'No model finding was requested by this input adaptation test.',
  findings: [],
};

test('all 21 evaluation examples preserve individual source paths and extracted documentation', async () => {
  assert.equal(cases.length, 21);

  for (const testCase of cases) {
    let receivedProject;
    const result = await analyzeDocumentationDrift({
      projectName: testCase.id,
      sourceFiles: [{ path: `src/${testCase.id}.js`, content: testCase.updated }],
      documentation: [{ path: 'README.md', extractedText: testCase.readme }],
    }, {
      runAnalyser: async (project) => {
        receivedProject = project;
        return { model: 'adapter-test', analysis: EMPTY_ANALYSIS };
      },
    });

    assert.deepEqual(receivedProject.project.sourceFiles, [{
      path: `src/${testCase.id}.js`,
      content: testCase.updated,
    }], `${testCase.id}: source path/content changed`);
    assert.equal(receivedProject.project.documentation[0].path, 'README.md');
    assert.equal(receivedProject.project.documentation[0].extractedText, testCase.readme);
    assert.deepEqual(result.analysis, EMPTY_ANALYSIS);
  }
});
