'use strict';

// Production implementation of the same contract as MemoryEventStore.
// Not unit-tested here (would need a live Postgres) — the store's
// upsert/prune *logic* is unit-tested via MemoryEventStore; this class is
// intentionally a thin, mechanical SQL translation of that same contract.
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
             gdelt_id, event_date, actor1, actor2, event_code,
             goldstein_scale, num_mentions, num_sources, num_articles,
             avg_tone, location, country_code, lat, lon,
             date_added, source_url, first_seen_at, last_updated_at
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,now(),now())
           ON CONFLICT (gdelt_id) DO UPDATE SET
             num_mentions = EXCLUDED.num_mentions,
             num_sources = EXCLUDED.num_sources,
             num_articles = EXCLUDED.num_articles,
             avg_tone = EXCLUDED.avg_tone,
             last_updated_at = now()`,
          [
            event.gdeltId, event.eventDate, event.actor1, event.actor2, event.eventCode,
            event.goldsteinScale, event.numMentions, event.numSources, event.numArticles,
            event.avgTone, event.location, event.countryCode, event.lat, event.lon,
            event.dateAdded, event.sourceUrl,
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
    return result.rows;
  }
}

module.exports = { PostgresEventStore };
