# MIS Runbook

Operational playbook for the MassifyX Intelligence Service. See
`../MassifyX_Global/docs/internal/DESIGN.md` for the full design; this file
is the "something's wrong, what do I do" reference (DESIGN.md §10).

## MIS is down

**Symptom:** `/api/v1/health` doesn't respond, or the site's `/live` page
shows "temporarily unavailable."

**Impact:** `/live` on the site degrades to a static panel and still returns
200 — every other page on the site is completely unaffected. This is by
design (DESIGN.md §2's fault-isolation goal); an MIS outage is never a site
incident.

**Fix:**
1. Check the process is actually running (`node server.js` / your process
   manager's status command).
2. Check `DATABASE_URL` — if Postgres is unreachable, `store.migrate()` at
   startup throws and the process exits. Check connectivity/credentials.
3. Restart. `/live` recovers automatically on the site's next poll of
   `/api/v1/health` (no site-side restart needed).

## GDELT changed format

**Symptom:** `eventCount` stops growing; logs show `[MIS] ingest cycle: 0
fetched` repeatedly, or `pollOnce` throws from `lib/gdelt/parseEvents.js` /
`lib/gdelt/ingest.js`.

**Cause:** GDELT's 2.0 Event export is a stable, versioned format, but if it
ever changes column layout or the `lastupdate.txt` URL scheme, the parser
in `lib/gdelt/parseEvents.js` (hardcoded column indices, `FIELD` constant)
will silently misparse or `pickExportUrl` in `lib/gdelt/ingest.js` will throw.

**Fix:**
1. Manually fetch `https://data.gdeltproject.org/gdeltv2/lastupdate.txt` and
   compare against what `pickExportUrl` expects.
2. Download a fresh export CSV, diff its column count/order against the
   `FIELD` map in `lib/gdelt/parseEvents.js`.
3. Update the fixture at `test/fixtures/gdelt-sample-export.csv` to match
   the new real format, update `FIELD`, re-run `npm test` until green.

**Known instance of this (2026-09):** GDELT's real `lastupdate.txt` lists the
export URL as plain `http://`, not `https://`, even though the identical
path is also served over `https` on the same host. `assertExpectedExportUrl`
requires `https:`, so every real ingestion attempt failed with "GDELT export
URL failed the host/scheme allow-list" until `pickExportUrl` started
upgrading the scheme itself before validating (`lib/gdelt/ingest.js`). If
this guard starts rejecting again, check whether GDELT's declared scheme
changed again before assuming the host allow-list itself needs loosening —
the point of upgrading to https ourselves is to never have to trust
whatever scheme the feed happens to claim.

## Cost spike

**Symptom:** `[MIS] COST ALERT: estimated spend this month is $X, over the
$Y ceiling` in the logs (see `lib/costMonitor.js`, wired into `server.js`'s
`pollOnce`).

**Note:** this is a rough estimate (flat cost-per-call, not real token
billing) meant as a tripwire, not an exact figure — check your actual
DeepSeek billing dashboard for the real number.

**Fix:**
1. Check `GDELT_POLL_INTERVAL_MINUTES` — polling too frequently multiplies
   LLM calls linearly. 60 minutes is the default; widening it further is
   the fastest lever.
2. Check whether GDELT's raw event volume spiked (a major global news day
   means more candidate events reach the relevance filter, each still
   costing one LLM call even when rejected as irrelevant).
3. As a last resort, unset `DEEPSEEK_API_KEY` to stop enrichment entirely
   (ingest keeps running, `/api/v1/disruptions` just stops growing) while
   you investigate.
4. Raise or lower `LLM_MONTHLY_COST_CEILING_USD` once you've decided what's
   actually acceptable.

## Live feed data quality (irrelevant/vacuous/mismatched/stale entries)

**Symptom:** `/live` on the site shows entries with no real supply-chain
relevance, summaries that assert nothing concrete, a source link that
doesn't match the headline, old (weeks/months-old) events presented as
"recent", or severity 4-5 on plainly trivial events.

**Root causes fixed 2026-09** (see the git history around this section for
the actual diffs):

1. **Irrelevant/vacuous entries** — the relevance/severity/summary prompts
   in `lib/enrich/pipeline.js` used to give the model only actor names +
   location, with no description of what actually happened. Fixed by
   passing the CAMEO event-code description (`lib/enrich/cameoCodes.js`),
   Goldstein scale, and average tone through to every prompt, raising
   `RELEVANCE_THRESHOLD`, and adding a vacuous-summary gate
   (`isObviouslyVacuous`). `lib/ml/relevanceClassifier.js` and
   `lib/ml/summaryGroundedness.js` add a cheap pre-filter / specificity check
   on top of the LLM calls.
2. **Source doesn't match the headline** — `lib/enrich/clusterKey.js`'s
   geo/date bucketing was coarse enough (0.5°/3 days, no actor signal) that
   two unrelated stories in the same region/category/week collided onto the
   same id, and `lib/store/postgresEventStore.js`'s upsert kept the first
   insert's `source_url` forever while overwriting title/summary with
   whichever story landed next. Fixed by tightening the buckets, keying on
   the lead actor, and adding `source_url` to the `ON CONFLICT` update.
3. **Old events shown as recent** — `eventDate` (GDELT's real event date) was
   parsed but never persisted; `lastUpdatedAt` was also being bumped to
   `now()` on every poll cycle even when nothing about the event actually
   changed, which is how a re-emitted old story kept sorting to the top of
   "recent". Fixed by persisting/exposing `eventDate` and only advancing
   `lastUpdatedAt` when real content changed. The consuming site
   (`MassifyX_Global`) still needs its own change to actually sort/label
   `/live` by `eventDate` rather than `lastUpdatedAt` — that's tracked in
   that repo, not here.
4. **Severity 4-5 on trivial events** — the severity prompt got
   `numMentions`/`numSources` but no real content, so a viral-but-irrelevant
   story could score high purely from attention volume. Fixed by
   `lib/ml/severityRegressor.js`'s `blendSeverity`: once relevance is below
   0.75 ("marginal", not confidently on-topic), the result is capped at
   `max(regressor's prediction, category floor)` instead of trusting the
   LLM+floor pipeline outright — a marginal-relevance, high-mention story
   can only reach 4-5 if a model trained on real disruption magnitude (not
   attention volume) also thinks it's serious.

If `/live` still shows one of these symptoms after this fix, it's most
likely the ML modules' tiny hand-labelled training sets (`test/fixtures/
eval-sample.json`, `test/fixtures/severity-eval-sample.json`) not covering
the new case — grow those fixtures and retrain
(`scripts/train-relevance-classifier.js`, `scripts/train-severity-
regressor.js`) rather than hand-tuning thresholds blind.

## Rollback

MIS and the site deploy and roll back independently (DESIGN.md §2's whole
point). To roll back MIS:

1. Redeploy the previous known-good commit/image on whatever host you're
   using — no site-side change needed, since the site only depends on the
   API contract (`GET /api/v1/health`, `GET /api/v1/disruptions`), not any
   particular MIS version.
2. If a bad deploy corrupted stored events (e.g. wrong enrichment logic
   wrote garbage categories), the store can be safely wiped and
   repopulated: events aren't the source of truth for anything else, and
   the next few ingest cycles rebuild the last 14 days from GDELT.
3. If the *site* needs to roll back independently (e.g. a bad `/live`
   deploy), that's a normal revert on `MassifyX_Global`'s own PR/deploy
   flow — MIS is untouched either way.
