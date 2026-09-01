'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { enrichEvent } = require('../lib/enrich/pipeline');

function rawEvent(overrides = {}) {
  return {
    actor1: 'ROTTERDAM PORT AUTHORITY',
    actor2: 'DOCKWORKERS UNION',
    location: 'Rotterdam, Zuid-Holland, Netherlands',
    lat: 51.9225,
    lon: 4.47917,
    eventDate: '20260728',
    numMentions: 38,
    numSources: 12,
    sourceUrl: 'https://example.com/rotterdam-strike',
    ...overrides,
  };
}

// Responses in call order: relevance, category, severity, summary.
function scriptedLlmCall(responses) {
  let call = 0;
  return async () => {
    const response = responses[call];
    call += 1;
    if (response instanceof Error) throw response;
    return response;
  };
}

test('happy path: relevant event is fully enriched', async () => {
  const llmCall = scriptedLlmCall([
    '0.9',
    'labor',
    '4',
    'Dockworkers in Rotterdam began a strike affecting container throughput.',
  ]);

  const event = await enrichEvent(rawEvent(), { llmCall });

  assert.ok(event);
  assert.equal(event.category, 'labor');
  assert.equal(event.severity, 4);
  assert.equal(event.lat, 51.9225);
  assert.equal(event.lon, 4.47917);
  assert.equal(event.sourceCount, 12);
  assert.equal(
    event.summary,
    'Dockworkers in Rotterdam began a strike affecting container throughput.',
  );
  assert.ok(event.id.startsWith('evt_'));
  assert.equal(event.eventDate, '2026-07-28');
});

test('the ML relevance pre-filter vetoes obvious noise before any LLM call runs', async () => {
  let llmCallCount = 0;
  const llmCall = async () => {
    llmCallCount += 1;
    return '0.9';
  };

  const event = await enrichEvent(
    rawEvent({
      actor1: 'LOCAL FILM FESTIVAL',
      actor2: 'CELEBRITY GUESTS',
      location: 'Cannes, France',
      numMentions: 18,
      numSources: 6,
    }),
    { llmCall },
  );

  assert.equal(event, null);
  assert.equal(llmCallCount, 0);
});

test('a marginally-relevant, high-attention story has its severity capped by the regressor rather than trusting the LLM outright', async () => {
  // Same "viral-but-trivial" shape as test/fixtures/severity-eval-sample.json's
  // restaurant-fire example: high mentions/sources, low real disruption
  // magnitude. Relevance is scripted at 0.7 -- above RELEVANCE_THRESHOLD
  // (0.65) so the event isn't dropped outright, but below blendSeverity's
  // RELEVANCE_TRUST_THRESHOLD (0.75), which is exactly the gap this test
  // exercises: the LLM alone would rate this a 5.
  const llmCall = scriptedLlmCall([
    '0.7',
    'other',
    '5',
    'A fire damaged a local restaurant in Nashville, drawing heavy media attention but no supply-chain impact.',
  ]);

  const event = await enrichEvent(
    rawEvent({
      actor1: 'LOCAL RESTAURANT',
      actor2: 'NEIGHBORHOOD FIRE DEPARTMENT',
      location: 'Nashville, Tennessee, United States',
      numMentions: 140,
      numSources: 38,
      numArticles: 65,
      goldsteinScale: -2,
      avgTone: -6,
    }),
    { llmCall },
  );

  assert.ok(event);
  assert.ok(
    event.severity < 5,
    `expected the regressor to cap severity below the LLM's raw 5, got ${event.severity}`,
  );
});

test('below-threshold relevance drops the event before any further calls', async () => {
  let classifyCalled = false;
  const llmCall = async (prompt) => {
    if (prompt.includes('Classify')) classifyCalled = true;
    return '0.2';
  };

  const event = await enrichEvent(rawEvent(), { llmCall });

  assert.equal(event, null);
  assert.equal(classifyCalled, false);
});

test('an invalid category from the model drops the event rather than guessing', async () => {
  const llmCall = scriptedLlmCall(['0.8', 'sports']);
  const event = await enrichEvent(rawEvent(), { llmCall });
  assert.equal(event, null);
});

test('an LLM call that never recovers drops the event, never half-enriched', async () => {
  const llmCall = async () => {
    throw new Error('provider outage');
  };

  const event = await enrichEvent(rawEvent(), {
    llmCall,
    resilienceOptions: { retries: 1, timeoutMs: 50 },
  });

  assert.equal(event, null);
});

test('severity floor still applies even when the model under-scores it', async () => {
  const llmCall = scriptedLlmCall([
    '0.95',
    'logistics',
    '1',
    'A canal blockage halted transit shipping for several days.',
  ]);

  const event = await enrichEvent(rawEvent(), { llmCall });

  assert.ok(event);
  assert.equal(event.severity, 2); // logistics floor, overriding the model's "1"
});
