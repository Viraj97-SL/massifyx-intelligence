'use strict';

// End-to-end integration test (DESIGN.md §8): boots the real ingest -> enrich
// -> store -> API pipeline with a mocked GDELT export and a mocked (but
// deterministic) LLM — no network, no real key, ever.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');

const { pollOnce } = require('../server.js');
const { createApp } = require('../lib/api/createApp');
const { MemoryEventStore } = require('../lib/store/memoryEventStore');

const gdeltFixtureText = fs.readFileSync(
  path.join(__dirname, 'fixtures', 'gdelt-sample-export.csv'),
  'utf8',
);

const LASTUPDATE_BODY =
  '1 abc123 http://data.gdeltproject.org/gdeltv2/20260728123000.export.CSV.zip';

function fakeFetch() {
  return async (url) => {
    if (url.endsWith('lastupdate.txt')) {
      return { ok: true, text: async () => LASTUPDATE_BODY };
    }
    return { ok: true, arrayBuffer: async () => Buffer.from('fake-zip-bytes') };
  };
}

// Deterministic stand-in for Gemini: every fixture event is relevant,
// labor, severity 4, with a fixed neutral summary.
async function fakeLlmCall(prompt) {
  if (prompt.startsWith('Is the following')) return '0.9';
  if (prompt.startsWith('Classify')) return 'labor';
  if (prompt.startsWith('Rate the severity')) return '4';
  return 'A disruption was reported affecting regional supply chains.';
}

let server;
let base;

test.before(async () => {
  const store = new MemoryEventStore();
  await pollOnce(store, {
    llmCall: fakeLlmCall,
    fetchImpl: fakeFetch(),
    unzipImpl: async () => gdeltFixtureText,
  });

  const app = createApp({
    store,
    getHealthInfo: () => ({ lastIngestAt: new Date().toISOString() }),
  });
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
  await new Promise((resolve) => server.close(resolve));
});

test('the two geolocated fixture rows survive ingest + enrichment', async () => {
  const res = await fetch(`${base}/api/v1/health`);
  const body = await res.json();
  assert.equal(body.eventCount, 2);
});

test('enriched events carry the fake classifier/severity/summary through to the API', async () => {
  const res = await fetch(`${base}/api/v1/disruptions`);
  const body = await res.json();

  assert.equal(body.count, 2);
  for (const event of body.events) {
    assert.equal(event.category, 'labor');
    assert.equal(event.severity, 4);
    assert.equal(event.summary, 'A disruption was reported affecting regional supply chains.');
    assert.ok(Number.isFinite(event.lat));
    assert.ok(Number.isFinite(event.lon));
  }
});

test('a severity filter above what the fake LLM produced returns nothing', async () => {
  const res = await fetch(`${base}/api/v1/disruptions?severity=5`);
  const body = await res.json();
  assert.equal(body.count, 0);
});
