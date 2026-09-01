'use strict';

// Same 7 categories the pipeline classifies into (lib/enrich/category.js) --
// duplicated here rather than imported so this ml/ module tree stays
// self-contained and never reaches into lib/enrich (see severityRegressor.js
// header for why that separation matters right now).
const CATEGORIES = ['weather', 'geopolitical', 'labor', 'logistics', 'regulatory', 'supplier', 'other'];

// Order here is the contract with severityRegressor.js -- a trained model's
// `weights` array lines up positionally with this list.
const FEATURE_NAMES = [
  'logNumMentions',
  'logNumSources',
  'logNumArticles',
  'mentionsPerSource',
  'goldsteinScale',
  'avgTone',
  ...CATEGORIES.map((category) => `cat_${category}`),
];

function toFiniteNumber(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

// GDELT attention counts (numMentions/numSources/numArticles) can range from
// single digits into the hundreds, while goldsteinScale/avgTone are already
// small (~[-10,10]). log1p + fixed-constant scaling keeps every numeric
// feature in a similar rough magnitude so plain (unnormalized) gradient
// descent converges without a separate learned mean/std step -- this
// mirrors lib/ml/features.js's extractRelevanceFeatures exactly, on
// purpose, since that approach is already proven in this repo.
//
// mentionsPerSource is carried through unscaled and is the single most
// direct proxy for "viral buzz relative to how many distinct outlets
// actually reported it" -- a story with 200 mentions from 3 sources is
// mention-farming/syndication, not 3x the corroboration of one with 200
// mentions from 60 sources. This is deliberately the feature most likely to
// counteract the media-buzz bias described in the pipeline's severity
// prompt.
function extractSeverityFeatures(rawEventWithCategory) {
  const event = rawEventWithCategory || {};

  const numMentions = toFiniteNumber(event.numMentions, 0);
  const numSources = toFiniteNumber(event.numSources, 0);
  const numArticles = toFiniteNumber(event.numArticles, 0);
  const goldsteinScale = toFiniteNumber(event.goldsteinScale, 0);
  const avgTone = toFiniteNumber(event.avgTone, 0);
  const mentionsPerSource = numMentions / Math.max(numSources, 1);

  const oneHotCategory = CATEGORIES.map((category) => (category === event.category ? 1 : 0));

  return [
    Math.log1p(Math.max(numMentions, 0)),
    Math.log1p(Math.max(numSources, 0)),
    Math.log1p(Math.max(numArticles, 0)),
    mentionsPerSource,
    goldsteinScale / 10,
    avgTone / 10,
    ...oneHotCategory,
  ];
}

module.exports = {
  extractSeverityFeatures,
  FEATURE_NAMES,
  CATEGORIES,
};
