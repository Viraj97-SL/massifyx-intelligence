'use strict';

// Reference implementation of the event-store contract (upsertEvents /
// pruneOlderThan / listAll), keyed by the enriched event's stable `id`
// (see lib/enrich/clusterKey.js). Used in tests and as a no-Postgres
// local-dev fallback. PostgresEventStore implements the same contract for
// production.
class MemoryEventStore {
  constructor() {
    this.events = new Map();
  }

  async upsertEvents(events) {
    const now = new Date();
    for (const event of events) {
      const existing = this.events.get(event.id);
      const rawRefs = existing
        ? Array.from(new Set([...(existing.rawRefs || []), ...(event.rawRefs || [])]))
        : event.rawRefs || [];
      this.events.set(event.id, {
        ...event,
        rawRefs,
        firstSeenAt: existing ? existing.firstSeenAt : now,
        lastUpdatedAt: now,
      });
    }
    return { upserted: events.length };
  }

  async pruneOlderThan(cutoffDate) {
    let pruned = 0;
    for (const [id, event] of this.events) {
      if (event.lastUpdatedAt < cutoffDate) {
        this.events.delete(id);
        pruned += 1;
      }
    }
    return { pruned };
  }

  async listAll() {
    return [...this.events.values()].sort((a, b) => b.lastUpdatedAt - a.lastUpdatedAt);
  }
}

module.exports = { MemoryEventStore };
