'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { runEval } = require('../lib/eval/runEval');

const sample = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'fixtures', 'eval-sample.json'), 'utf8'),
);

test('a perfect classifier scores 1.0 on every metric', async () => {
  const perfectClassify = async (event) => {
    const labelled = sample.find((s) => s.event === event);
    return { relevant: labelled.relevant, category: labelled.category };
  };

  const results = await runEval(sample, perfectClassify);

  assert.equal(results.precision, 1);
  assert.equal(results.recall, 1);
  assert.equal(results.categoryAccuracy, 1);
  assert.equal(results.sampleSize, sample.length);
});

test('a classifier that marks everything relevant hurts precision but not recall', async () => {
  const alwaysRelevant = async () => ({ relevant: true, category: 'other' });

  const results = await runEval(sample, alwaysRelevant);

  const actualRelevantCount = sample.filter((s) => s.relevant).length;
  assert.equal(results.recall, 1);
  assert.equal(results.precision, actualRelevantCount / sample.length);
});

test('a classifier that marks everything irrelevant hurts recall but not precision', async () => {
  const alwaysIrrelevant = async () => ({ relevant: false, category: null });

  const results = await runEval(sample, alwaysIrrelevant);

  assert.equal(results.precision, 1); // no false positives possible
  assert.equal(results.recall, 0);
  assert.equal(results.categoryAccuracy, 0);
});
