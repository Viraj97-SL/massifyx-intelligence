'use strict';

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
          `INSERT INTO disruption_events (
             id, title, summary, category, severity, lat, lon, location,
             source_count, source_url, relevance_score, raw_refs,
             first_seen_at, last_updated_at
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,now(),now())
           ON CONFLICT (id) DO UPDATE SET
             title = EXCLUDED.title,
             summary = EXCLUDED.summary,
             category = EXCLUDED.category,
             severity = EXCLUDED.severity,
             source_count = EXCLUDED.source_count,
             relevance_score = EXCLUDED.relevance_score,
             raw_refs = (
               SELECT array_agg(DISTINCT ref)
               FROM unnest(disruption_events.raw_refs || EXCLUDED.raw_refs) AS ref
             ),
             last_updated_at = now()`,
          [
            event.id, event.title, event.summary, event.category, event.severity,
            event.lat, event.lon, event.location, event.sourceCount, event.sourceUrl,
            event.relevanceScore, event.rawRefs || [],
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

  async listAll() {
    const result = await this.pool.query(
      'SELECT * FROM disruption_events ORDER BY last_updated_at DESC',
    );
    return result.rows.map(mapRow);
  }
}

module.exports = { PostgresEventStore };
