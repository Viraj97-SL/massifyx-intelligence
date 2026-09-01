'use strict';

// Same default as lib/api/createApp.js's DEFAULT_LIMIT for the public API,
// but this is the store-level backstop -- it applies even to internal
// callers that don't go through that route (see listAll() below).
const DEFAULT_LIST_LIMIT = 500;

// Production implementation of the same contract as MemoryEventStore.
// Not unit-tested here (would need a live Postgres) — the store's
// upsert/prune *logic* is unit-tested via MemoryEventStore; this class is
// intentionally a thin, mechanical SQL translation of that same contract.
function mapRow(row) {
  return {
    id: row.id,
    title: row.title,
    summary: row.summary,
    category: row.category,
    severity: row.severity,
    lat: Number(row.lat),
    lon: Number(row.lon),
    location: row.location,
    sourceCount: row.source_count,
    sourceUrl: row.source_url,
    eventDate: row.event_date,
    relevanceScore: row.relevance_score,
    rawRefs: row.raw_refs,
    firstSeenAt: row.first_seen_at,
    lastUpdatedAt: row.last_updated_at,
  };
}

class PostgresEventStore {
  constructor(pool) {
    this.pool = pool;
  }

  async migrate() {
    const fs = require('node:fs');
    const path = require('node:path');
    const schema = fs.readFileSync(path.join(__dirname, '..', '..', 'db', 'schema.sql'), 'utf8');
    await this.pool.query(schema);
  }

  async upsertEvents(events) {
    if (events.length === 0) return { upserted: 0 };
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      for (const event of events) {
        await client.query(
          // Bug fix: the previous version of this UPDATE SET list omitted
          // source_url entirely -- on a clusterKey collision between two
          // unrelated stories (see clusterKey.js's docstring), Postgres kept
          // the FIRST insert's source_url forever while happily overwriting
          // title/summary with whatever story landed next, guaranteeing a
          // mismatched source on every collision. event_date is similarly
          // now updated so a corrected/re-enriched event's real-world date
          // stays in sync with its content.
          //
          // last_updated_at only advances when the content actually
          // changed. Previously every poll cycle that merely re-touched an
          // already-known event (GDELT re-emitting the same story with no
          // new information) bumped last_updated_at to now() unconditionally
          // -- which is exactly how an old (2024/2025) incident could keep
          // sorting to the top of a feed filtered/ordered by "recent". A
          // real content change (a new severity, an updated summary, a
          // corrected source) still counts as a genuine update.
          `INSERT INTO disruption_events (
             id, title, summary, category, severity, lat, lon, location,
             source_count, source_url, event_date, relevance_score, raw_refs,
             first_seen_at, last_updated_at
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,now(),now())
           ON CONFLICT (id) DO UPDATE SET
             title = EXCLUDED.title,
             summary = EXCLUDED.summary,
             category = EXCLUDED.category,
             severity = EXCLUDED.severity,
             source_count = EXCLUDED.source_count,
             source_url = EXCLUDED.source_url,
             event_date = EXCLUDED.event_date,
             relevance_score = EXCLUDED.relevance_score,
             raw_refs = (
               SELECT array_agg(DISTINCT ref)
               FROM unnest(disruption_events.raw_refs || EXCLUDED.raw_refs) AS ref
             ),
             last_updated_at = CASE
               -- Deliberately excludes source_count: mention/source counts
               -- drift upward on their own for any still-covered story
               -- regardless of whether it's a new incident or a months-old
               -- one GDELT keeps re-aggregating -- treating that alone as
               -- "changed" would keep re-bumping last_updated_at for an old
               -- event, undermining the whole point of this check.
               WHEN disruption_events.title IS DISTINCT FROM EXCLUDED.title
                 OR disruption_events.summary IS DISTINCT FROM EXCLUDED.summary
                 OR disruption_events.category IS DISTINCT FROM EXCLUDED.category
                 OR disruption_events.severity IS DISTINCT FROM EXCLUDED.severity
                 OR disruption_events.source_url IS DISTINCT FROM EXCLUDED.source_url
                 OR disruption_events.event_date IS DISTINCT FROM EXCLUDED.event_date
               THEN now()
               ELSE disruption_events.last_updated_at
             END`,
          [
            event.id, event.title, event.summary, event.category, event.severity,
            event.lat, event.lon, event.location, event.sourceCount, event.sourceUrl,
            event.eventDate, event.relevanceScore, event.rawRefs || [],
          ],
        );
      }
      await client.query('COMMIT');
      return { upserted: events.length };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async pruneOlderThan(cutoffDate) {
    const result = await this.pool.query(
      'DELETE FROM disruption_events WHERE last_updated_at < $1',
      [cutoffDate],
    );
    return { pruned: result.rowCount };
  }

  // filters mirrors lib/api/createApp.js's parseQueryFilters shape
  // (minSeverity, category, since, limit) -- pushed into the WHERE/LIMIT
  // clause here instead of fetched-then-filtered in JS, so a growing table
  // never means an unbounded SELECT * over the wire. `limit` defaults to
  // DEFAULT_LIMIT (bounded, not "everything") -- callers that genuinely
  // need every row (health check, tests) use countAll() or pass an
  // explicit higher limit.
  async listAll(filters = {}) {
    const conditions = [];
    const params = [];

    if (filters.minSeverity !== undefined) {
      params.push(filters.minSeverity);
      conditions.push(`severity >= $${params.length}`);
    }
    if (filters.category !== undefined) {
      params.push(filters.category);
      conditions.push(`category = $${params.length}`);
    }
    if (filters.since !== undefined) {
      params.push(filters.since);
      conditions.push(`last_updated_at >= $${params.length}`);
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    params.push(filters.limit ?? DEFAULT_LIST_LIMIT);
    // event_date is cast to text rather than left as `pg`'s default DATE
    // (oid 1082) type: with no custom type parser registered anywhere in
    // this repo, `pg` hands back a JS Date constructed in the server's
    // *local* timezone, not UTC -- on any non-UTC host that silently shifts
    // the calendar date backward a day once serialized, reintroducing the
    // exact "wrong event date" bug this column exists to fix. Casting in
    // SQL keeps the "YYYY-MM-DD" string toIsoDate() actually wrote intact,
    // with no global pg.types side effect that could affect unrelated code.
    const sql = `SELECT id, title, summary, category, severity, lat, lon, location,
             source_count, source_url, event_date::text AS event_date, relevance_score,
             raw_refs, first_seen_at, last_updated_at
           FROM disruption_events ${where} ORDER BY last_updated_at DESC LIMIT $${params.length}`;

    const result = await this.pool.query(sql, params);
    return result.rows.map(mapRow);
  }

  async countAll() {
    const result = await this.pool.query('SELECT count(*)::int AS count FROM disruption_events');
    return result.rows[0].count;
  }
}

module.exports = { PostgresEventStore };
