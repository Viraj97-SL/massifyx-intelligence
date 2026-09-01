'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { extractRelevanceFeatures, FEATURE_NAMES } = require('../lib/ml/features');
const {
  trainRelevanceClassifier,
  scoreRelevance,
  isConfidentlyIrrelevant,
  DEFAULT_RELEVANCE_MODEL,
} = require('../lib/ml/relevanceClassifier');

const fixtureSample = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'fixtures', 'eval-sample.json'), 'utf8'),
);

test('extractRelevanceFeatures returns a fixed-length numeric vector', () => {
  const features = extractRelevanceFeatures({
    actor1: 'ROTTERDAM PORT AUTHORITY',
    actor2: 'DOCKWORKERS UNION',
    location: 'Rotterdam, Zuid-Holland, Netherlands',
    numMentions: 38,
    numSources: 12,
    numArticles: 40,
    goldsteinScale: -5,
    avgTone: -3.2,
  });

  assert.equal(features.length, FEATURE_NAMES.length);
  assert.ok(features.every((value) => typeof value === 'number' && Number.isFinite(value)));

  // "port"/"union" are positive keywords; nothing negative in this text.
  const positiveIndex = FEATURE_NAMES.indexOf('positiveKeywordCount');
  const negativeIndex = FEATURE_NAMES.indexOf('negativeKeywordCount');
  assert.ok(features[positiveIndex] >= 2);
  assert.equal(features[negativeIndex], 0);
});

test('extractRelevanceFeatures handles null/missing fields without throwing', () => {
  const features = extractRelevanceFeatures({});
  assert.equal(features.length, FEATURE_NAMES.length);
  assert.ok(features.every((value) => Number.isFinite(value)));

  const featuresFromNulls = extractRelevanceFeatures({
    actor1: null,
    actor2: undefined,
    location: null,
    numMentions: null,
    numSources: undefined,
    numArticles: null,
    goldsteinScale: undefined,
    avgTone: null,
  });
  assert.equal(featuresFromNulls.length, FEATURE_NAMES.length);
  assert.ok(featuresFromNulls.every((value) => Number.isFinite(value)));
});

test('keyword matching is word-boundary, not substring -- "contractor" is not "actor"', () => {
  // Regression test: text.includes('actor') used to match inside the
  // ordinary word "contractor", silently flagging real events (a main
  // contractor, a subcontractor) with a bogus negative-keyword hit.
  const features = extractRelevanceFeatures({
    actor1: 'MAIN CONTRACTOR',
    actor2: 'CITY COUNCIL',
    location: 'Berlin, Germany',
  });
  const negativeIndex = FEATURE_NAMES.indexOf('negativeKeywordCount');
  assert.equal(features[negativeIndex], 0);
});

test('keyword matching is word-boundary, not substring -- "Portugal"/"Portland" are not "port"', () => {
  const features = extractRelevanceFeatures({
    actor1: 'LOCAL COUNCIL',
    actor2: 'RESIDENTS ASSOCIATION',
    location: 'Portland, Oregon, United States',
  });
  const positiveIndex = FEATURE_NAMES.indexOf('positiveKeywordCount');
  assert.equal(features[positiveIndex], 0);
});

test('extractRelevanceFeatures detects negative-domain keywords and no positive ones', () => {
  const features = extractRelevanceFeatures({
    actor1: 'LOCAL FILM FESTIVAL',
    actor2: 'CELEBRITY GUESTS',
    location: 'Cannes, France',
  });

  const positiveIndex = FEATURE_NAMES.indexOf('positiveKeywordCount');
  const negativeIndex = FEATURE_NAMES.indexOf('negativeKeywordCount');
  assert.equal(features[positiveIndex], 0);
  assert.ok(features[negativeIndex] >= 1);
});

test('trainRelevanceClassifier converges to reasonable separation on a synthetic set', () => {
  const relevantExample = (overrides) => ({
    relevant: true,
    event: {
      actor1: 'PORT AUTHORITY',
      actor2: 'SHIPPING LINE',
      location: 'Some Port, Some Country',
      numMentions: 30,
      numSources: 10,
      numArticles: 30,
      goldsteinScale: -4,
      avgTone: -2,
      ...overrides,
    },
  });

  const irrelevantExample = (overrides) => ({
    relevant: false,
    event: {
      actor1: 'FILM FESTIVAL',
      actor2: 'CELEBRITY GUESTS',
      location: 'Some City, Some Country',
      numMentions: 20,
      numSources: 8,
      numArticles: 20,
      goldsteinScale: 1,
      avgTone: 3,
      ...overrides,
    },
  });

  const syntheticSet = [
    relevantExample({ actor1: 'FREIGHT TERMINAL', location: 'Rotterdam, Netherlands' }),
    relevantExample({ actor1: 'CARGO WAREHOUSE', location: 'Long Beach, United States' }),
    relevantExample({ actor1: 'UNION STRIKE COMMITTEE', location: 'Marseille, France' }),
    relevantExample({ actor1: 'CUSTOMS EXPORT OFFICE', location: 'Shenzhen, China' }),
    irrelevantExample({ actor1: 'MUSEUM CURATOR', location: 'Florence, Italy' }),
    irrelevantExample({ actor1: 'SPORTS CHAMPIONSHIP', location: 'Manchester, United Kingdom' }),
    irrelevantExample({ actor1: 'MOVIE AWARD CEREMONY', location: 'Los Angeles, United States' }),
    irrelevantExample({ actor1: 'CONCERT PROMOTER', location: 'Berlin, Germany' }),
  ];

  const model = trainRelevanceClassifier(syntheticSet);

  assert.equal(model.weights.length, FEATURE_NAMES.length);
  assert.ok(Number.isFinite(model.bias));

  for (const example of syntheticSet) {
    const score = scoreRelevance(example.event, model);
    if (example.relevant) {
      assert.ok(score > 0.5, `expected relevant example to score > 0.5, got ${score}`);
    } else {
      assert.ok(score < 0.5, `expected irrelevant example to score < 0.5, got ${score}`);
    }
  }
});

test('scoreRelevance always returns a probability in [0, 1]', () => {
  for (const example of fixtureSample) {
    const score = scoreRelevance(example.event, DEFAULT_RELEVANCE_MODEL);
    assert.ok(score >= 0 && score <= 1, `score ${score} out of [0,1] range`);
  }

  // Also sane on a degenerate/empty event.
  const emptyScore = scoreRelevance({}, DEFAULT_RELEVANCE_MODEL);
  assert.ok(emptyScore >= 0 && emptyScore <= 1);
});

test('isConfidentlyIrrelevant vetoes obvious noise but not an obvious port strike', () => {
  const filmFestival = {
    actor1: 'LOCAL FILM FESTIVAL',
    actor2: 'CELEBRITY GUESTS',
    location: 'Cannes, France',
    numMentions: 18,
    numSources: 6,
  };

  const portStrike = {
    actor1: 'ROTTERDAM PORT AUTHORITY',
    actor2: 'DOCKWORKERS UNION',
    location: 'Rotterdam, Zuid-Holland, Netherlands',
    numMentions: 38,
    numSources: 12,
  };

  assert.equal(isConfidentlyIrrelevant(filmFestival, DEFAULT_RELEVANCE_MODEL), true);
  assert.equal(isConfidentlyIrrelevant(portStrike, DEFAULT_RELEVANCE_MODEL), false);
});

test('a "contractor" actor name does not flip the veto decision vs an equivalent "builder" name', () => {
  // Regression test for the pre-fix substring bug: swapping only the word
  // "CONTRACTOR" for "BUILDER" in an otherwise identical event used to flip
  // isConfidentlyIrrelevant from true to false, silently dropping real
  // events before any LLM call ever ran.
  const withContractor = {
    actor1: 'MAIN CONTRACTOR',
    actor2: 'CITY COUNCIL',
    location: 'Berlin, Germany',
    numMentions: 6,
    numSources: 2,
    numArticles: 6,
    goldsteinScale: -2,
    avgTone: -1,
  };
  const withBuilder = { ...withContractor, actor1: 'MAIN BUILDER' };

  assert.equal(
    isConfidentlyIrrelevant(withContractor, DEFAULT_RELEVANCE_MODEL),
    isConfidentlyIrrelevant(withBuilder, DEFAULT_RELEVANCE_MODEL),
  );
});

test('isConfidentlyIrrelevant never vetoes an actually-relevant fixture example', () => {
  for (const example of fixtureSample.filter((sample) => sample.relevant)) {
    assert.equal(
      isConfidentlyIrrelevant(example.event, DEFAULT_RELEVANCE_MODEL),
      false,
      `should not veto relevant example: ${example.event.actor1}`,
    );
  }
});
