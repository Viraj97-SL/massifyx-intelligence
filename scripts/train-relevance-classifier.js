'use strict';

// Dev tool: trains lib/ml/relevanceClassifier.js's DEFAULT_RELEVANCE_MODEL
// against the current test/fixtures/eval-sample.json and prints a
// ready-to-paste object literal. Not wired into `npm test` or `npm run
// eval` -- run it manually after growing/editing the fixture set:
//
//   node scripts/train-relevance-classifier.js
//
// then copy the printed `weights`/`bias`/`featureNames` into
// DEFAULT_RELEVANCE_MODEL in lib/ml/relevanceClassifier.js.

const fs = require('node:fs');
const path = require('node:path');

const { trainRelevanceClassifier, scoreRelevance } = require('../lib/ml/relevanceClassifier');

const fixturePath = path.join(__dirname, '..', 'test', 'fixtures', 'eval-sample.json');
const labelledExamples = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));

const model = trainRelevanceClassifier(labelledExamples);

console.log('// Paste into lib/ml/relevanceClassifier.js as DEFAULT_RELEVANCE_MODEL:');
console.log(
  `const DEFAULT_RELEVANCE_MODEL = ${JSON.stringify(
    { weights: model.weights, bias: model.bias, featureNames: model.featureNames },
    null,
    2,
  )};`,
);

console.log('\n// Per-example scores against the training set:');
for (const example of labelledExamples) {
  const score = scoreRelevance(example.event, model);
  console.log(
    `  relevant=${String(example.relevant).padEnd(5)} score=${score.toFixed(4)}  ${example.event.actor1}`,
  );
}
