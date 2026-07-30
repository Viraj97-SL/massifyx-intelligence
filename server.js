'use strict';

const { fetchRecentEvents } = require('./lib/gdelt/ingest');
const { unzipToText } = require('./lib/gdelt/unzip');
const { createEventStore } = require('./lib/store');
const { createPoller } = require('./lib/scheduler');
const { enrichEvent } = require('./lib/enrich/pipeline');
const { callGemini } = require('./lib/llm/geminiClient');
const { withResilience } = require('./lib/llm/withResilience');
const { createApp } = require('./lib/api/createApp');

const RETENTION_DAYS = 14;
const DEFAULT_POLL_MINUTES = 15;
const DEFAULT_PORT = 3001;

function createLlmCall(apiKey) {
  return (prompt) => withResilience(() => callGemini({ apiKey, prompt, fetchImpl: fetch }));
}

// fetchImpl/unzipImpl are injectable so integration tests can drive the
// whole ingest+enrich cycle without touching the network — see
// test/integration.test.js.
async function pollOnce(store, { llmCall, fetchImpl = fetch, unzipImpl = unzipToText } = {}) {
  const rawEvents = await fetchRecentEvents({ fetchImpl, unzipImpl });

  if (!llmCall) {
    console.warn(
      `[MIS] ingest cycle: fetched ${rawEvents.length} raw events but skipped enrichment (no GEMINI_API_KEY)`,
    );
    return { fetched: rawEvents.length, upserted: 0, pruned: 0 };
  }

  const enriched = [];
  for (const rawEvent of rawEvents) {
    const result = await enrichEvent(rawEvent, { llmCall });
    if (result) enriched.push(result);
  }

  const { upserted } = await store.upsertEvents(enriched);
  const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000);
  const { pruned } = await store.pruneOlderThan(cutoff);
  console.log(
    `[MIS] ingest cycle: ${rawEvents.length} fetched, ${upserted} enriched+upserted, ${pruned} pruned`,
  );
  return { fetched: rawEvents.length, upserted, pruned };
}

async function main() {
  const store = createEventStore({ databaseUrl: process.env.DATABASE_URL });
  if (typeof store.migrate === 'function') {
    await store.migrate();
  }

  const apiKey = process.env.GEMINI_API_KEY;
  const llmCall = apiKey ? createLlmCall(apiKey) : null;

  const health = { lastIngestAt: null };
  const pollMinutes = Number(process.env.GDELT_POLL_INTERVAL_MINUTES) || DEFAULT_POLL_MINUTES;
  const poller = createPoller(async () => {
    await pollOnce(store, { llmCall });
    health.lastIngestAt = new Date().toISOString();
  }, pollMinutes * 60 * 1000);
  poller.start();
  console.log(
    `[MIS] polling GDELT every ${pollMinutes} minute(s)${llmCall ? '' : ' (enrichment disabled: no GEMINI_API_KEY)'}`,
  );

  const app = createApp({ store, getHealthInfo: () => health });
  const port = Number(process.env.PORT) || DEFAULT_PORT;
  app.listen(port, () => {
    console.log(`[MIS] read API listening on http://localhost:${port}`);
  });

  return { store, poller, app };
}

if (require.main === module) {
  main().catch((err) => {
    console.error('[MIS] fatal startup error:', err);
    process.exit(1);
  });
}

module.exports = { pollOnce, main };
