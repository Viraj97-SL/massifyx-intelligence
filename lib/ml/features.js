'use strict';

// Keyword lists are a coarse, hand-picked domain prior -- NOT mined from the
// 10-example fixture set. That set is far too small to safely derive
// keywords from without overfitting to a handful of sourceUrl slugs. Grow
// these lists from real production false positives/negatives, not by
// tuning against test/fixtures/eval-sample.json.
const POSITIVE_KEYWORDS = [
  'port',
  'ship',
  'shipping',
  'freight',
  'cargo',
  'supplier',
  'factory',
  'plant',
  'canal',
  'strike',
  'union',
  'tariff',
  'export',
  'import',
  'customs',
  'logistics',
  'warehouse',
  'container',
];

const NEGATIVE_KEYWORDS = [
  'festival',
  'celebrity',
  'sports',
  'museum',
  'film',
  'concert',
  'match',
  'election result',
  'award',
  'movie',
  'actor',
  'actress',
  'championship',
];

// Order here is the contract with relevanceClassifier.js -- a trained
// model's `weights` array lines up positionally with this list.
const FEATURE_NAMES = [
  'logNumMentions',
  'logNumSources',
  'logNumArticles',
  'mentionsPerSource',
  'goldsteinScale',
  'avgTone',
  'positiveKeywordCount',
  'negativeKeywordCount',
];

function toFiniteNumber(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Plain substring matching (text.includes(keyword)) was a real production
// bug: "actor" (a NEGATIVE_KEYWORDS entry, meant to catch celebrity/film
// noise) is a substring of the ordinary word "contractor", so any real
// event whose actor/location text contained "contractor" got a spurious
// negative-keyword hit; "port" similarly matched inside "Portugal"/
// "Portland". Word-boundary matching keeps each keyword confined to whole
// words (or whole phrases, for multi-word entries like "election result").
function countKeywordHits(text, keywords) {
  return keywords.reduce((count, keyword) => {
    const pattern = new RegExp(`\\b${escapeRegExp(keyword)}\\b`);
    return pattern.test(text) ? count + 1 : count;
  }, 0);
}

// GDELT counts (numMentions/numSources/numArticles) can range from single
// digits into the hundreds, while goldsteinScale/avgTone are already small
// (~[-10,10] / ~[-100,100]). log1p + fixed-constant scaling keeps every
// feature in a similar rough magnitude so plain (unnormalized) gradient
// descent in relevanceClassifier.js converges without needing to learn or
// store a separate mean/std normalization step.
function extractRelevanceFeatures(rawEvent) {
  const event = rawEvent || {};

  const numMentions = toFiniteNumber(event.numMentions, 0);
  const numSources = toFiniteNumber(event.numSources, 0);
  const numArticles = toFiniteNumber(event.numArticles, 0);
  const goldsteinScale = toFiniteNumber(event.goldsteinScale, 0);
  const avgTone = toFiniteNumber(event.avgTone, 0);

  const text = [event.actor1, event.actor2, event.location]
    .filter((value) => typeof value === 'string')
    .join(' ')
    .toLowerCase();

  const mentionsPerSource = numMentions / Math.max(numSources, 1);

  return [
    Math.log1p(Math.max(numMentions, 0)),
    Math.log1p(Math.max(numSources, 0)),
    Math.log1p(Math.max(numArticles, 0)),
    mentionsPerSource,
    goldsteinScale / 10,
    avgTone / 10,
    countKeywordHits(text, POSITIVE_KEYWORDS),
    countKeywordHits(text, NEGATIVE_KEYWORDS),
  ];
}

module.exports = {
  extractRelevanceFeatures,
  FEATURE_NAMES,
  POSITIVE_KEYWORDS,
  NEGATIVE_KEYWORDS,
};
