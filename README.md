# MassifyX Intelligence Service (MIS)

Decoupled microservice powering the MassifyX site's `/live` supply chain
disruption monitor. See the sibling `MassifyX_Global` repo's
`docs/internal/DESIGN.md` for the full technical design and
`docs/internal/BUILD_INSTRUCTIONS.md` for the staged build plan this repo
follows.

MIS ingests GDELT events, filters and enriches them with an AI pipeline
(relevance, classification, clustering, severity, summarisation), and exposes
a read-only, rate-limited JSON API. It never talks back to the site — the
site fetches from MIS server-side and degrades gracefully if MIS is down.

## Status

Stage 2: GDELT ingestion + storage. No AI enrichment yet — events are
persisted raw, keyed by GDELT's own event id.

## Setup

```
npm install
cp .env.example .env
npm test
```

`npm start` / `npm run dev` boot the poll loop: fetch the latest GDELT event
export, keep only geolocated events, upsert them into the store, and prune
anything older than 14 days. Without `DATABASE_URL` set, it falls back to an
in-memory store for local dev (nothing persists across restarts).

## Datastore

Managed Postgres (e.g. Supabase or Neon) via `DATABASE_URL`. No local disk
persistence — hosts here may have an ephemeral filesystem. Schema lives in
`db/schema.sql` and is applied automatically on startup when Postgres is
configured.

## Architecture

- `lib/gdelt/parseEvents.js` — pure parser for the GDELT 2.0 Event export
  format (tab-separated, 61 columns); drops events without valid lat/lon.
- `lib/gdelt/ingest.js` — orchestrates fetching `lastupdate.txt` + the export
  zip; `fetchImpl`/`unzipImpl` are injected so tests never touch the network.
- `lib/gdelt/unzip.js` — the real unzip implementation (`adm-zip`), used only
  by `server.js`, never by tests.
- `lib/store/` — repository-pattern event store: `MemoryEventStore` (tests +
  local-dev fallback) and `PostgresEventStore` (production) implement the
  same `upsertEvents` / `pruneOlderThan` / `listAll` contract.
- `lib/scheduler.js` — start/stop-able poll loop wrapper around
  `setInterval`.
