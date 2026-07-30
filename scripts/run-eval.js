#!/usr/bin/env node
'use strict';

// Reportable eval step (DESIGN.md §8) — not a hard CI gate. Prints
// precision/recall on relevance + category accuracy against the
// hand-labelled sample. Skips (exit 0) when no GEMINI_API_KEY is set, so CI
// stays green without a live key while still reporting real numbers once
// one is configured.

const fs = require('node:fs');
const path = require('node:path');

const { runEval } = require('../lib/eval/runEval');
const { buildRelevancePrompt, buildClassifyPrompt, parseRelevanceScore, RELEVANCE_THRESHOLD } = require('../lib/enrich/pipeline');
const { validateCategory } = require('../lib/enrich/category');
const { callGemini } = require('../lib/llm/geminiClient');
const { withResilience } = require('../lib/llm/withResilience');

async function classifyWithGemini(apiKey, event) {
  const relevanceText = await withResilience(() =>
    callGemini({ apiKey, prompt: buildRelevancePrompt(event), fetchImpl: fetch }),
  );
  const relevance = parseRelevanceScore(relevanceText);
  const relevant = relevance >= RELEVANCE_THRESHOLD;
  if (!relevant) return { relevant: false, category: null };

  const categoryText = await withResilience(() =>
    callGemini({ apiKey, prompt: buildClassifyPrompt(event), fetchImpl: fetch }),
  );
  return { relevant: true, category: validateCategory(categoryText) };
}

async function main() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.log('[eval] skipped: no GEMINI_API_KEY set — nothing to run live against.');
    return;
  }

  const samplePath = path.join(__dirname, '..', 'test', 'fixtures', 'eval-sample.json');
  const sample = JSON.parse(fs.readFileSync(samplePath, 'utf8'));

  const results = await runEval(sample, (event) => classifyWithGemini(apiKey, event));
  console.log('[eval] sample size:', results.sampleSize);
  console.log('[eval] relevance precision:', results.precision.toFixed(2));
  console.log('[eval] relevance recall:', results.recall.toFixed(2));
  console.log('[eval] category accuracy:', results.categoryAccuracy.toFixed(2));
}

main().catch((err) => {
  console.error('[eval] run failed:', err.message);
  // Reportable, not a gate — never fail the build over this.
  process.exit(0);
});
