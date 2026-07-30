CREATE TABLE IF NOT EXISTS disruption_events (
  gdelt_id TEXT PRIMARY KEY,
  event_date TEXT,
  actor1 TEXT,
  actor2 TEXT,
  event_code TEXT,
  goldstein_scale REAL,
  num_mentions INTEGER,
  num_sources INTEGER,
  num_articles INTEGER,
  avg_tone REAL,
  location TEXT,
  country_code TEXT,
  lat DOUBLE PRECISION NOT NULL,
  lon DOUBLE PRECISION NOT NULL,
  date_added TEXT,
  source_url TEXT,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_disruption_events_last_updated_at
  ON disruption_events (last_updated_at);
