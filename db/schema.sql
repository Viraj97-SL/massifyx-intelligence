CREATE TABLE IF NOT EXISTS disruption_events (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  category TEXT NOT NULL,
  severity SMALLINT NOT NULL,
  lat DOUBLE PRECISION NOT NULL,
  lon DOUBLE PRECISION NOT NULL,
  location TEXT,
  source_count INTEGER,
  source_url TEXT,
  event_date DATE,
  relevance_score REAL,
  raw_refs TEXT[] NOT NULL DEFAULT '{}',
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- event_date is new (2026-09 live-feed-quality fix): the real-world GDELT
-- event date, as opposed to first_seen_at/last_updated_at (this service's
-- own ingest-time bookkeeping). CREATE TABLE IF NOT EXISTS above is a no-op
-- against an already-existing table, so an already-deployed table needs its
-- own idempotent migration -- same pattern as the sibling warroom service's
-- impactLevel column. NULL on old rows needs no backfill: the API and store
-- layers already treat a missing event_date as "unknown", not "invalid".
ALTER TABLE disruption_events ADD COLUMN IF NOT EXISTS event_date DATE;

CREATE INDEX IF NOT EXISTS idx_disruption_events_last_updated_at
  ON disruption_events (last_updated_at);

CREATE INDEX IF NOT EXISTS idx_disruption_events_severity
  ON disruption_events (severity);
