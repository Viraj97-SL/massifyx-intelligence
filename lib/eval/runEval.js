'use strict';

// Precision/recall on relevance + category accuracy against a hand-labelled
// sample (DESIGN.md §8). classifyFn(event) => Promise<{ relevant: boolean,
// category: string|null }> is injected so this can run against the real
// pipeline or a test double — see scripts/run-eval.js for the live wiring.
async function runEval(labelledSample, classifyFn) {
  let truePositive = 0;
  let falsePositive = 0;
  let falseNegative = 0;
  let categoryCorrect = 0;
  let categoryTotal = 0;

  for (const sample of labelledSample) {
    const prediction = await classifyFn(sample.event);

    if (prediction.relevant && sample.relevant) truePositive += 1;
    if (prediction.relevant && !sample.relevant) falsePositive += 1;
    if (!prediction.relevant && sample.relevant) falseNegative += 1;

    if (sample.relevant) {
      categoryTotal += 1;
      if (prediction.category === sample.category) categoryCorrect += 1;
    }
  }

  const precision =
    truePositive + falsePositive === 0 ? 1 : truePositive / (truePositive + falsePositive);
  const recall =
    truePositive + falseNegative === 0 ? 1 : truePositive / (truePositive + falseNegative);
  const categoryAccuracy = categoryTotal === 0 ? 1 : categoryCorrect / categoryTotal;

  return { precision, recall, categoryAccuracy, sampleSize: labelledSample.length };
}

module.exports = { runEval };
