# Detector evaluation suite

This suite measures the Ollama model's candidate quality on 21 isolated documentation-drift scenarios. Every case has its own `README.md`, original code, updated code, generated Git-style diff, and expected findings under `cases/<case-id>/`. It measures the model layer, not the deterministic removed-response-field rule in `drift-engine.js`; a passing model result is not production verification.

The 21 scenarios cover response bodies and status codes, resource lookup, PUT and PATCH semantics, validation, duplicates, filtering, authentication, errors, route removal, pagination, unknown routes, pre-existing inaccuracies, undocumented changes, comments, and behavior-preserving edits.

## Run

From the fixture root:

```sh
npm run evaluate
```

The default service is `http://localhost:11434/api/generate` and the default model is `qwen2.5-coder:7b`. Set `OLLAMA_URL` and `OLLAMA_MODEL` to evaluate another endpoint or model. The runner evaluates each scenario independently at temperature 0.

To create all case files without calling Ollama:

```sh
npm run evaluate:prepare
```

For a short trial, run `node evaluation/evaluate.js --limit=3`. The full run prints the expected and actual findings for every case and writes a detailed report to `evaluation/results.md` plus machine-readable results to `evaluation/results/results.json`.

## Scoring

The report separates exact-sentence claim detection from exact-evidence findings. A true positive must match the expected documentation sentence, added/removed side, and exact code line; citing the old line instead of the new line is a false positive and a miss. It gives exact case accuracy, precision, recall, F1, and the share of findings that pass schema and changed-line validation. Wrong or extra findings count as false positives; missed expected findings count as false negatives. Invalid JSON, invented sentences, and evidence that fails exact-line validation are reported as failures rather than silently treated as an empty result. The runner exits with a nonzero status when any case fails, while still saving the complete report.

If results have already been collected and only the report needs to be regenerated, run `npm run evaluate:report`; this does not call the model again.

This is a broad regression suite, not proof of correctness for every API or README. Expand `cases.js` with cases for your own routes, middleware, and domain rules when they are added to the fixture.
