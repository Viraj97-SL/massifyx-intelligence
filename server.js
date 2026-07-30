'use strict';

const { fetchRecentEvents } = require('./lib/gdelt/ingest');
const { unzipToText } = require('./lib/gdelt/unzip');
const { createEventStore } = require('./lib/store');
const { createPoller } = require('./lib/scheduler');

const RETENTION_DAYS = 14;
const DEFAULT_POLL_MINUTES = 15;

async function pollOnce(store) {
  const events = await fetchRecentEvents({ fetchImpl: fetch, unzipImpl: unzipToText });
  const { upserted } = await store.upsertEvents(events);
  const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000);
  const { pruned } = await store.pruneOlderThan(cutoff);
  console.log(`[MIS] ingest cycle: ${upserted} upserted, ${pruned} pruned`);
}

async function main() {
  const store = createEventStore({ databaseUrl: process.env.DATABASE_URL });
  if (typeof store.migrate === 'function') {
    await store.migrate();
  }

  const pollMinutes = Number(process.env.GDELT_POLL_INTERVAL_MINUTES) || DEFAULT_POLL_MINUTES;
  const poller = createPoller(() => pollOnce(store), pollMinutes * 60 * 1000);
  poller.start();
  console.log(`[MIS] polling GDELT every ${pollMinutes} minute(s)`);
}

if (require.main === module) {
  main().catch((err) => {
    console.error('[MIS] fatal startup error:', err);
    process.exit(1);
  });
}

module.exports = { pollOnce, main };
