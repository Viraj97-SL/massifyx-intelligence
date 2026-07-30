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
  relevance_score REAL,
  raw_refs TEXT[] NOT NULL DEFAULT '{}',
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_disruption_events_last_updated_at
  ON disruption_events (last_updated_at);

CREATE INDEX IF NOT EXISTS idx_disruption_events_severity
  ON disruption_events (severity);
