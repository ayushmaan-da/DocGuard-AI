import cases from './cases.js';
import { analyzeProjectDocumentation } from '../src/services/project-analysis-service.js';

function readLimit() {
  const argument = process.argv.find(value => value.startsWith('--limit='));
  if (!argument) return cases.length;
  const limit = Number(argument.slice('--limit='.length));
  if (!Number.isSafeInteger(limit) || limit < 1) throw new Error('--limit must be a positive integer');
  return Math.min(limit, cases.length);
}

async function main() {
  const selected = cases.slice(0, readLimit());
  const results = [];
  for (const [index, testCase] of selected.entries()) {
    const input = {
      project: {
        name: testCase.id,
        source: { type: 'evaluation' },
        sourceFiles: [{ path: `src/${testCase.id}.js`, content: testCase.updated }],
        documentation: [{
          path: 'README.md',
          filename: 'README.md',
          format: 'text/plain',
          originalFormat: 'text/plain',
          extractedText: testCase.readme,
        }],
        warnings: [],
      },
    };
    process.stdout.write(`[${index + 1}/${selected.length}] ${testCase.id} ... `);
    const result = await analyzeProjectDocumentation(input);
    const row = {
      id: testCase.id,
      description: testCase.description,
      expectedDiffScenario: testCase.expected,
      model: result.model,
      analysis: result.analysis,
    };
    results.push(row);
    console.log(`returned ${result.analysis.findings.length} analyser finding(s)`);
  }
  console.log(JSON.stringify({ scenarioCount: results.length, results }, null, 2));
}

main().catch(error => {
  console.error(`Evaluation failed: ${error.message}`);
  process.exitCode = 1;
});
