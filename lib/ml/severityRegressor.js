'use strict';

// Additive severity regressor -- built to blend with (never replace) the
// existing LLM+floor severity in lib/enrich/severity.js. Deliberately does
// NOT import from lib/enrich/*: this module ships standalone so it can be
// wired into the pipeline by someone else afterward without touching files
// under concurrent edit elsewhere in the repo. See blendSeverity() at the
// bottom for the actual policy that combines the two signals.
//
// Context: the LLM severity prompt (buildSeverityPrompt in
// lib/enrich/pipeline.js) only ever sees actor names + location +
// numMentions + numSources. That biases it toward reading high attention
// volume as high real-world impact -- a story that goes viral in the news
// cycle (a local restaurant fire, a celebrity court case) can still get
// rated 4-5 purely because it was widely reported, not because it disrupts
// any supply chain. This regressor is trained on hand-labelled *actual*
// disruption magnitude instead, specifically including "viral but trivial"
// and "quiet but serious" examples so it learns to decorrelate severity
// from raw mention/source counts. See test/fixtures/severity-eval-sample.json.

const { extractSeverityFeatures, FEATURE_NAMES } = require('./severityFeatures');

function dot(weights, features) {
  return weights.reduce((sum, w, i) => sum + w * features[i], 0);
}

const DEFAULT_TRAIN_OPTIONS = {
  // Unlike the sigmoid-bounded logistic regression in
  // relevanceClassifier.js, plain linear regression on unnormalized log1p
  // features has an unbounded gradient -- collinearity between
  // logNumMentions/logNumSources/logNumArticles makes the loss surface
  // ill-conditioned, so this needs a much smaller learning rate and many
  // more epochs to converge without diverging to NaN (empirically tuned
  // against this fixture; see scripts/train-severity-regressor.js).
  learningRate: 0.003,
  epochs: 150000,
  l2: 0.003,
};

// Plain batch gradient descent on mean-squared-error, with a small L2
// penalty to keep weights conservative on a training set this small (28
// rows, 13 features + bias). Same shape as trainRelevanceClassifier in
// lib/ml/relevanceClassifier.js -- see that file's header for the
// no-npm-dependency rationale -- but fits a continuous linear regression
// instead of a sigmoid classifier, since severity is a magnitude (1-5), not
// a class label.
//
// labelledExamples: array of { category, severity, event: {...} } matching
// test/fixtures/severity-eval-sample.json's shape.
function trainSeverityRegressor(labelledExamples, options = {}) {
  if (!Array.isArray(labelledExamples) || labelledExamples.length === 0) {
    throw new Error('trainSeverityRegressor requires a non-empty array of labelled examples');
  }

  const { learningRate, epochs, l2 } = { ...DEFAULT_TRAIN_OPTIONS, ...options };

  const featureRows = labelledExamples.map((example) =>
    extractSeverityFeatures({ ...example.event, category: example.category }),
  );
  const targets = labelledExamples.map((example) => example.severity);
  const featureCount = FEATURE_NAMES.length;
  const sampleCount = featureRows.length;

  let weights = new Array(featureCount).fill(0);
  let bias = 0;

  for (let epoch = 0; epoch < epochs; epoch += 1) {
    const weightGradients = new Array(featureCount).fill(0);
    let biasGradient = 0;

    for (let i = 0; i < sampleCount; i += 1) {
      const features = featureRows[i];
      const prediction = dot(weights, features) + bias;
      const error = prediction - targets[i];
      for (let j = 0; j < featureCount; j += 1) {
        weightGradients[j] += error * features[j];
      }
      biasGradient += error;
    }

    weights = weights.map((w, j) => w - learningRate * (weightGradients[j] / sampleCount + l2 * w));
    bias -= learningRate * (biasGradient / sampleCount);
  }

  return { weights, bias, featureNames: FEATURE_NAMES.slice() };
}

// rawEventWithCategory: the raw GDELT-derived event fields (numMentions,
// numSources, numArticles, goldsteinScale, avgTone, ...) plus a `category`
// string, i.e. the same two things the pipeline already has in hand at
// enrichment time (rawEvent and the classified category), merged into one
// object by the caller.
//
// Unclamped by design -- callers decide how/whether to clamp to the 1-5
// scale. blendSeverity() below does its own rounding+clamping as part of
// the blending policy; a caller that wants the raw continuous value for
// other purposes (logging, calibration analysis) can use this directly.
function predictSeverity(rawEventWithCategory, model) {
  const features = extractSeverityFeatures(rawEventWithCategory);
  return dot(model.weights, features) + model.bias;
}

// Pre-trained on the 28 hand-labelled rows in
// test/fixtures/severity-eval-sample.json. Regenerate with
// `node scripts/train-severity-regressor.js` whenever that fixture set
// grows or changes; the printed object is meant to be pasted back in here
// verbatim. Baking the trained weights in as a literal (rather than
// training at require-time) keeps this module deterministic and
// dependency-free at runtime -- requiring this file never runs a training
// loop as a side effect, matching lib/ml/relevanceClassifier.js's
// DEFAULT_RELEVANCE_MODEL pattern.
//
// IMPORTANT: 28 hand-authored examples is a small, transparently synthetic
// starting dataset, not a production-grade training set. The path to a
// materially better model is the same one this repo already uses for the
// relevance classifier (see lib/eval/runEval.js and
// scripts/train-relevance-classifier.js): every real production event whose
// true disruption magnitude diverges from what this model predicts should
// get added to severity-eval-sample.json (with the same category/severity/
// event shape) and the model retrained via the script above. Do not
// hand-tune these weights to fix one bad prediction -- that overfits harder
// to 28 rows.
const DEFAULT_SEVERITY_MODEL = {
  weights: [
    -1.4516824860002429, -1.066863403002504, 2.2721218809841432, 0.024518747794855324,
    -6.590947215966432, 0.5466236485082644, 0.07225577228895359, -0.5097253942179185,
    -0.42402921663982573, 0.6041582563838264, 0.11004830608452473, 0.7059672270095315,
    0.21213969301412394,
  ],
  bias: 2.295998454803789,
  featureNames: FEATURE_NAMES.slice(),
};

const RELEVANCE_TRUST_THRESHOLD = 0.75;

// The actual blending policy (additive -- nothing here touches
// lib/enrich/*, this is handed to whoever wires it into the pipeline):
//
// - relevance >= 0.75 ("clearly on-topic"): trust the existing LLM+floor
//   pipeline severity (llmFloorSeverity) as-is. The category floor in
//   lib/enrich/severity.js already guards the downside for a confidently
//   relevant event, and we don't want to second-guess the LLM's read on the
//   upside once relevance is solid -- that's exactly the case the regressor
//   (28 hand-labelled rows) is least equipped to override confidently.
//
// - relevance < 0.75 ("marginal/borderline match"): this is exactly the
//   regime the reported bug lives in -- a marginally-relevant, high
//   mention/source-count story (media buzz, not real supply-chain content)
//   can still clear the relevance gate and then get inflated by the LLM
//   severity prompt, which only ever sees actor names/location/mentions/
//   sources and has no independent signal on real disruption magnitude. So
//   for marginal relevance we cap the blended severity at whichever is
//   LARGER of: the regressor's own (rounded, clamped) prediction, or the
//   category's floor-implied minimum severity. A marginal-relevance,
//   high-attention story can never ride mention-count alone up to a 4 or 5
//   -- it can only get there if the regressor (trained on real disruption
//   magnitude, not attention) also thinks it's serious, or the category
//   floor already requires it.
function blendSeverity({ llmFloorSeverity, regressorPrediction, relevance, categoryFloor = 1 }) {
  if (relevance >= RELEVANCE_TRUST_THRESHOLD) {
    return llmFloorSeverity;
  }
  const clampedRegressor = Math.min(5, Math.max(1, Math.round(regressorPrediction)));
  const cap = Math.max(clampedRegressor, categoryFloor);
  return Math.min(llmFloorSeverity, cap);
}

module.exports = {
  trainSeverityRegressor,
  predictSeverity,
  blendSeverity,
  DEFAULT_SEVERITY_MODEL,
  RELEVANCE_TRUST_THRESHOLD,
};
