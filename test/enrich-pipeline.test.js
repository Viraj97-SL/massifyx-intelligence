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
