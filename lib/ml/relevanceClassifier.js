'use strict';

const { extractRelevanceFeatures, FEATURE_NAMES } = require('./features');

function sigmoid(z) {
  return 1 / (1 + Math.exp(-z));
}

function dot(weights, features) {
  return weights.reduce((sum, w, i) => sum + w * features[i], 0);
}

const DEFAULT_TRAIN_OPTIONS = {
  learningRate: 0.3,
  epochs: 5000,
  l2: 0.01,
};

// Plain batch gradient descent on the standard logistic-regression
// cross-entropy loss, with a small L2 penalty to keep weights from
// exploding on a training set this small (10 rows). No matrix library or
// npm dependency -- a hand-rolled loop over ~8 features x ~10 rows is both
// sufficient and easier to audit than pulling in a dependency for it.
function trainRelevanceClassifier(labelledExamples, options = {}) {
  const { learningRate, epochs, l2 } = { ...DEFAULT_TRAIN_OPTIONS, ...options };

  const featureRows = labelledExamples.map((example) => extractRelevanceFeatures(example.event));
  const labels = labelledExamples.map((example) => (example.relevant ? 1 : 0));
  const featureCount = FEATURE_NAMES.length;
  const sampleCount = featureRows.length;

  let weights = new Array(featureCount).fill(0);
  let bias = 0;

  for (let epoch = 0; epoch < epochs; epoch += 1) {
    const weightGradients = new Array(featureCount).fill(0);
    let biasGradient = 0;

    for (let i = 0; i < sampleCount; i += 1) {
      const features = featureRows[i];
      const prediction = sigmoid(dot(weights, features) + bias);
      const error = prediction - labels[i];
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

function scoreRelevance(rawEvent, model) {
  const features = extractRelevanceFeatures(rawEvent);
  return sigmoid(dot(model.weights, features) + model.bias);
}

// Pre-trained on the 10 hand-labelled rows in test/fixtures/eval-sample.json.
// Regenerate with `node scripts/train-relevance-classifier.js` whenever that
// fixture set grows or changes; the printed object is meant to be pasted
// back in here verbatim. Baking the trained weights in as a literal (rather
// than training at require-time) keeps this module deterministic and
// dependency-free at runtime, matching the rest of this repo's offline
// testing philosophy -- no training loop runs as a side effect of
// `require('./relevanceClassifier')`.
//
// IMPORTANT: this is a lightweight learned pre-filter, not a
// production-grade classifier. 10 examples is not enough data to trust its
// judgment near the decision boundary -- see isConfidentlyIrrelevant below
// for how this is used defensively. The path to a materially better model
// is simply a bigger, more diverse fixture set: every false positive/false
// negative found in production should be added to eval-sample.json (or a
// dedicated larger training file) and the model retrained via the script
// above. Do not tune the threshold or feature weights by hand to fix one
// bad example -- that just overfits harder to 10 rows.
const DEFAULT_RELEVANCE_MODEL = {
  weights: [
    0.08996376817851913, -0.2620044841183591, 0, 0.8581052437590226, 0, 0, 1.707056980854362,
    -2.9534430629153117,
  ],
  bias: -1.832856764520511,
  featureNames: FEATURE_NAMES.slice(),
};

// A cheap pre-LLM-call short-circuit for lib/enrich/pipeline.js's caller:
// true only when the model is confident an event is noise, so the caller
// can skip the DeepSeek relevance call entirely.
//
// The threshold is deliberately far below the 0.5 relevance boundary used
// downstream (see RELEVANCE_THRESHOLD in lib/enrich/pipeline.js). With only
// 10 labelled examples behind this model, its calibration cannot be trusted
// near the boundary -- it can be confidently wrong on anything ambiguous.
// A low threshold (default 0.15) means this only vetoes events the model
// rates as clear-cut noise (no supply-chain keywords, negative-domain
// wording present, low goldstein/mentions signal) -- exactly the cases a
// human skimming the same three fields would also call obviously
// irrelevant. It never second-guesses a marginal score; those still go to
// the real LLM call.
function isConfidentlyIrrelevant(rawEvent, model = DEFAULT_RELEVANCE_MODEL, threshold = 0.15) {
  return scoreRelevance(rawEvent, model) < threshold;
}

module.exports = {
  trainRelevanceClassifier,
  scoreRelevance,
  isConfidentlyIrrelevant,
  DEFAULT_RELEVANCE_MODEL,
  sigmoid,
};
