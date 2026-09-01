'use strict';

// Dev tool: trains lib/ml/severityRegressor.js's DEFAULT_SEVERITY_MODEL
// against the current test/fixtures/severity-eval-sample.json and prints a
// ready-to-paste object literal plus a leave-nothing-out MAE. Not wired into
// `npm test` or `npm run eval` -- run it manually after growing/editing the
// fixture set:
//
//   node scripts/train-severity-regressor.js
//
// then copy the printed `weights`/`bias`/`featureNames` into
// DEFAULT_SEVERITY_MODEL in lib/ml/severityRegressor.js.

const fs = require('node:fs');
const path = require('node:path');

const { trainSeverityRegressor, predictSeverity } = require('../lib/ml/severityRegressor');

function clampSeverity(value) {
  return Math.min(5, Math.max(1, Math.round(value)));
}

const fixturePath = path.join(__dirname, '..', 'test', 'fixtures', 'severity-eval-sample.json');
const labelledExamples = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));

const model = trainSeverityRegressor(labelledExamples);

console.log('// Paste into lib/ml/severityRegressor.js as DEFAULT_SEVERITY_MODEL:');
console.log(
  `const DEFAULT_SEVERITY_MODEL = ${JSON.stringify(
    { weights: model.weights, bias: model.bias, featureNames: model.featureNames },
    null,
    2,
  )};`,
);

console.log('\n// Per-example predictions against the training set:');
let absoluteErrorSum = 0;
for (const example of labelledExamples) {
  const input = { ...example.event, category: example.category };
  const rawPrediction = predictSeverity(input, model);
  const clamped = clampSeverity(rawPrediction);
  absoluteErrorSum += Math.abs(clamped - example.severity);
  console.log(
    `  gold=${example.severity} pred=${clamped} (raw=${rawPrediction.toFixed(2)})  ` +
      `${example.category.padEnd(12)} ${example.event.actor1}`,
  );
}

const mae = absoluteErrorSum / labelledExamples.length;
console.log(`\n[train] sample size: ${labelledExamples.length}`);
console.log(`[train] leave-nothing-out MAE (clamped 1-5): ${mae.toFixed(3)}`);
