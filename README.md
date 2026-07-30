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

Stage 3: AI enrichment pipeline (relevance, classify, severity, summarise)
behind a swappable Gemini-backed LLM client. No live key configured yet —
enrichment is fully unit-tested against injected fakes; wiring a real
`GEMINI_API_KEY` is a follow-up, not required for this stage.

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
- `lib/enrich/` — the AI pipeline: `category.js` (fixed enum validation),
  `severity.js` (deterministic per-category floor), `clusterKey.js`
  (deterministic stable `id` via geo/date bucketing — no embedding call
  needed per ingest cycle), `pipeline.js` (`enrichEvent`, orchestrating
  relevance → classify → severity → summarise; drops rather than
  half-enriches on any failure).
- `lib/llm/` — `geminiClient.js` (thin REST wrapper, no SDK dependency) and
  `withResilience.js` (timeout + retry for every LLM call).
- `lib/eval/runEval.js` + `scripts/run-eval.js` — precision/recall on
  relevance and category accuracy against `test/fixtures/eval-sample.json`
  (10 hand-labelled events). Reportable CI step, not a gate: skips cleanly
  without a `GEMINI_API_KEY`.

## Enrichment pipeline

`enrichEvent(rawEvent, { llmCall })` takes an injected `llmCall(prompt) =>
Promise<string>` so every caller — production (`geminiClient`) or tests — can
swap the model out. Order: relevance filter (drop below threshold) → category
classify (drop if outside the fixed enum) → severity score (AI proposal,
floored per category) → one-sentence summary. Any unresolved failure after
retries drops the event entirely; it's never emitted half-enriched.
