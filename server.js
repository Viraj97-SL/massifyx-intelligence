'use strict';

const { fetchRecentEvents } = require('./lib/gdelt/ingest');
const { unzipToText } = require('./lib/gdelt/unzip');
const { createEventStore } = require('./lib/store');
const { createPoller } = require('./lib/scheduler');
const { enrichEvent } = require('./lib/enrich/pipeline');
const { callDeepSeek } = require('./lib/llm/deepseekClient');
const { withResilience } = require('./lib/llm/withResilience');
const { createApp } = require('./lib/api/createApp');
const { CostMonitor } = require('./lib/costMonitor');
const { startAisStream } = require('./lib/ais/reconnectingAisStream');
const { VesselStore } = require('./lib/ais/vesselStore');

const RETENTION_DAYS = 14;
const DEFAULT_POLL_MINUTES = 60;
const DEFAULT_PORT = 3001;
const VESSEL_PRUNE_INTERVAL_MS = 60_000;

// Bug fix (2026-09 audit): `Number(process.env.PORT) || DEFAULT_PORT` looks
// right but treats an explicit PORT=0 as falsy and silently falls back to
// DEFAULT_PORT -- port 0 is a real, meaningful request ("ask the OS for any
// free ephemeral port"), used by test/smoke.test.js to boot a real server
// without a fixed/colliding port number. `||` can't distinguish "not set" /
// "not a number" from "explicitly zero"; Number.isFinite can. An unset or
// blank PORT (undefined, or accidentally left as `PORT=` in an .env file)
// still falls back to defaultPort, same as before this fix -- only a
// genuinely-provided value of "0" is treated as intentional.
function resolvePort(envValue, defaultPort) {
  if (envValue === undefined || envValue === null || String(envValue).trim() === '') {
    return defaultPort;
  }
  const parsed = Number(envValue);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : defaultPort;
}

function createLlmCall(apiKey) {
  return (prompt) => withResilience(() => callDeepSeek({ apiKey, prompt, fetchImpl: fetch }));
}

// Wraps llmCall to count every actual call made during a cycle, without the
// enrichment pipeline itself needing to know cost tracking exists.
function countingLlmCall(llmCall, counter) {
  return async (prompt) => {
    counter.count += 1;
    return llmCall(prompt);
  };
}

// fetchImpl/unzipImpl are injectable so integration tests can drive the
// whole ingest+enrich cycle without touching the network — see
// test/integration.test.js.
async function pollOnce(store, { llmCall, fetchImpl = fetch, unzipImpl = unzipToText, costMonitor } = {}) {
  const rawEvents = await fetchRecentEvents({ fetchImpl, unzipImpl });

  if (!llmCall) {
    console.warn(
      `[MIS] ingest cycle: fetched ${rawEvents.length} raw events but skipped enrichment (no DEEPSEEK_API_KEY)`,
    );
    return { fetched: rawEvents.length, upserted: 0, pruned: 0 };
  }

  const counter = { count: 0 };
  const countedLlmCall = countingLlmCall(llmCall, counter);

  const enriched = [];
  for (const rawEvent of rawEvents) {
    const result = await enrichEvent(rawEvent, { llmCall: countedLlmCall });
    if (result) enriched.push(result);
  }

  if (costMonitor) {
    const spend = costMonitor.recordCalls(counter.count);
    if (costMonitor.isOverCeiling()) {
      console.error(
        `[MIS] COST ALERT: estimated spend this month is $${spend.toFixed(2)}, over the $${costMonitor.ceilingUsd} ceiling. Check DEEPSEEK_API_KEY usage / GDELT poll frequency.`,
      );
    }
  }

  const { upserted } = await store.upsertEvents(enriched);
  const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000);
  const { pruned } = await store.pruneOlderThan(cutoff);
  console.log(
    `[MIS] ingest cycle: ${rawEvents.length} fetched, ${upserted} enriched+upserted, ${pruned} pruned, ${counter.count} LLM calls`,
  );
  return { fetched: rawEvents.length, upserted, pruned };
}

async function main() {
  const store = createEventStore({ databaseUrl: process.env.DATABASE_URL });
  if (typeof store.migrate === 'function') {
    await store.migrate();
  }

  const apiKey = process.env.DEEPSEEK_API_KEY;
  const llmCall = apiKey ? createLlmCall(apiKey) : null;
  const costMonitor = new CostMonitor();

  const health = { lastIngestAt: null };
  const pollMinutes = Number(process.env.GDELT_POLL_INTERVAL_MINUTES) || DEFAULT_POLL_MINUTES;
  const poller = createPoller(async () => {
    await pollOnce(store, { llmCall, costMonitor });
    health.lastIngestAt = new Date().toISOString();
  }, pollMinutes * 60 * 1000);
  poller.start();
  console.log(
    `[MIS] polling GDELT every ${pollMinutes} minute(s)${llmCall ? '' : ' (enrichment disabled: no DEEPSEEK_API_KEY)'}`,
  );

  // Optional: real-time AIS vessel positions (DESIGN.md's Phase B hint,
  // pulled forward as a visual-only layer). Skipped entirely without a key
  // -- /api/v1/vessels still responds, just with an empty, unavailable list,
  // same graceful-degradation posture as everything else here.
  let vesselStore;
  let aisStream;
  const aisApiKey = process.env.AISSTREAM_API_KEY;
  if (aisApiKey) {
    vesselStore = new VesselStore();
    aisStream = startAisStream({
      apiKey: aisApiKey,
      onVessel: (vessel) => vesselStore.upsert(vessel),
    });
    setInterval(() => vesselStore.pruneStale(), VESSEL_PRUNE_INTERVAL_MS).unref();
    console.log('[MIS] AIS vessel stream connecting...');
  } else {
    console.log('[MIS] AIS vessel tracking disabled (no AISSTREAM_API_KEY)');
  }

  const app = createApp({ store, getHealthInfo: () => health, vesselStore });
  const port = resolvePort(process.env.PORT, DEFAULT_PORT);
  // Captured (rather than left as an unreferenced app.listen() return value)
  // and awaited until 'listening' actually fires -- test/smoke.test.js needs
  // a real handle to read back the bound port (PORT=0 picks an ephemeral
  // one) and to close it cleanly afterward, and any future graceful-shutdown
  // code would need the same handle.
  const server = await new Promise((resolve) => {
    const httpServer = app.listen(port, () => {
      console.log(`[MIS] read API listening on http://localhost:${port}`);
      resolve(httpServer);
    });
  });

  return { store, poller, app, server, aisStream };
}

if (require.main === module) {
  main().catch((err) => {
    console.error('[MIS] fatal startup error:', err);
    process.exit(1);
  });
}

module.exports = { pollOnce, main, resolvePort };
