'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  trainSeverityRegressor,
  predictSeverity,
  blendSeverity,
  DEFAULT_SEVERITY_MODEL,
} = require('../lib/ml/severityRegressor');

const fixtureSample = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'fixtures', 'severity-eval-sample.json'), 'utf8'),
);

test('DEFAULT_SEVERITY_MODEL has one weight per feature name', () => {
  assert.equal(DEFAULT_SEVERITY_MODEL.weights.length, DEFAULT_SEVERITY_MODEL.featureNames.length);
  assert.ok(Number.isFinite(DEFAULT_SEVERITY_MODEL.bias));
  assert.ok(DEFAULT_SEVERITY_MODEL.weights.every((w) => Number.isFinite(w)));
});

test('trainSeverityRegressor converges on an obvious synthetic linear relationship', () => {
  // severity == numMentions / 20, everything else held constant/irrelevant
  // -- a fully separable, noise-free relationship a linear regressor should
  // recover almost exactly regardless of the L2 penalty's exact strength.
  const synthetic = [
    { category: 'logistics', severity: 1, event: { numMentions: 20, numSources: 5, numArticles: 10, goldsteinScale: 0, avgTone: 0 } },
    { category: 'logistics', severity: 2, event: { numMentions: 40, numSources: 5, numArticles: 10, goldsteinScale: 0, avgTone: 0 } },
    { category: 'logistics', severity: 3, event: { numMentions: 60, numSources: 5, numArticles: 10, goldsteinScale: 0, avgTone: 0 } },
    { category: 'logistics', severity: 4, event: { numMentions: 80, numSources: 5, numArticles: 10, goldsteinScale: 0, avgTone: 0 } },
    { category: 'logistics', severity: 5, event: { numMentions: 100, numSources: 5, numArticles: 10, goldsteinScale: 0, avgTone: 0 } },
  ];

  const model = trainSeverityRegressor(synthetic, { learningRate: 0.001, epochs: 20000, l2: 0.001 });

  assert.ok(model.weights.every((w) => Number.isFinite(w)), 'training must not diverge to NaN/Infinity');

  for (const example of synthetic) {
    const prediction = predictSeverity({ ...example.event, category: example.category }, model);
    assert.ok(
      Math.abs(prediction - example.severity) < 0.75,
      `expected prediction near ${example.severity}, got ${prediction}`,
    );
  }
});

test('trainSeverityRegressor throws on empty input instead of returning a useless model', () => {
  assert.throws(() => trainSeverityRegressor([]));
});

test('predictSeverity orders a real disruption above a trivial one with equal attention', () => {
  const bigRealDisruption = {
    category: 'logistics',
    numMentions: 60,
    numSources: 20,
    numArticles: 35,
    goldsteinScale: -6,
    avgTone: -6,
  };
  const trivialSameAttention = {
    category: 'other',
    numMentions: 60,
    numSources: 20,
    numArticles: 35,
    goldsteinScale: 0,
    avgTone: -1,
  };

  const seriousScore = predictSeverity(bigRealDisruption, DEFAULT_SEVERITY_MODEL);
  const trivialScore = predictSeverity(trivialSameAttention, DEFAULT_SEVERITY_MODEL);

  assert.ok(
    seriousScore > trivialScore,
    `expected the real disruption (${seriousScore}) to outrank the trivial story (${trivialScore})`,
  );
});

test('predictSeverity ranks a quiet-but-serious port closure above a viral-but-trivial story', () => {
  const quietButSerious = fixtureSample.find(
    (ex) => ex.event.actor1 === 'MOUNTAIN PASS TUNNEL AUTHORITY',
  );
  const viralButTrivial = fixtureSample.find((ex) => ex.event.actor1 === 'LOCAL RESTAURANT');

  const quietScore = predictSeverity(
    { ...quietButSerious.event, category: quietButSerious.category },
    DEFAULT_SEVERITY_MODEL,
  );
  const viralScore = predictSeverity(
    { ...viralButTrivial.event, category: viralButTrivial.category },
    DEFAULT_SEVERITY_MODEL,
  );

  assert.ok(quietButSerious.event.numMentions < viralButTrivial.event.numMentions);
  assert.ok(
    quietScore > viralScore,
    `expected the quiet real disruption (${quietScore}) to outrank the viral trivial one (${viralScore})`,
  );
});

// "Leave-nothing-out" names what this actually is: an in-sample fit check
// against the same 28 rows the model was trained on, not a held-out/
// leave-one-out cross-validation. With 13 features over 28 rows a low MAE
// here is expected and is not evidence of generalization -- see
// severityRegressor.js's header for the overfitting caveat and the path to
// a real held-out evaluation (grow the fixture set).
test('leave-nothing-out MAE against the hand-labelled fixture stays well within a 5-point scale', () => {
  let absoluteErrorSum = 0;
  for (const example of fixtureSample) {
    const input = { ...example.event, category: example.category };
    const clamped = Math.min(5, Math.max(1, Math.round(predictSeverity(input, DEFAULT_SEVERITY_MODEL))));
    absoluteErrorSum += Math.abs(clamped - example.severity);
  }
  const mae = absoluteErrorSum / fixtureSample.length;

  assert.ok(mae < 1, `expected leave-nothing-out MAE under 1 point, got ${mae}`);
});

test('blendSeverity pulls down a high-LLM-severity, low-relevance, low-regressor-prediction case', () => {
  const blended = blendSeverity({
    llmFloorSeverity: 5, // LLM (biased by huge mention/source volume) said "severe"
    regressorPrediction: 1.2, // regressor trained on real disruption magnitude disagrees
    relevance: 0.4, // marginal relevance -- exactly the bug's failure mode
    categoryFloor: 1,
  });

  assert.ok(blended < 5, 'a marginal-relevance viral story must not keep a 5');
  assert.equal(blended, 1);
});

test('blendSeverity leaves a high-relevance case alone even if the regressor disagrees', () => {
  const blended = blendSeverity({
    llmFloorSeverity: 5,
    regressorPrediction: 1.2,
    relevance: 0.9, // clearly on-topic -- trust the existing LLM+floor pipeline
    categoryFloor: 1,
  });

  assert.equal(blended, 5);
});

test('blendSeverity never lets the cap fall below the category floor', () => {
  const blended = blendSeverity({
    llmFloorSeverity: 4,
    regressorPrediction: 1, // regressor says trivial
    relevance: 0.5, // marginal
    categoryFloor: 2, // but the category (e.g. geopolitical) has a floor of 2
  });

  assert.equal(blended, 2);
});

test('blendSeverity never raises severity above what the LLM+floor pipeline already proposed', () => {
  const blended = blendSeverity({
    llmFloorSeverity: 2,
    regressorPrediction: 5, // regressor thinks this is severe
    relevance: 0.3, // marginal relevance
    categoryFloor: 1,
  });

  // The cap only ever pulls a marginal-relevance score DOWN toward reality;
  // it must never push it up past what the LLM+floor pipeline itself said.
  assert.equal(blended, 2);
});
