'use strict';

// Reference implementation of the event-store contract (upsertEvents /
// pruneOlderThan / listAll). Used in tests and as a no-Postgres local-dev
// fallback. PostgresEventStore implements the same contract for production.
class MemoryEventStore {
  constructor() {
    this.events = new Map();
  }

  async upsertEvents(events) {
    const now = new Date();
    for (const event of events) {
      const existing = this.events.get(event.gdeltId);
      this.events.set(event.gdeltId, {
        ...event,
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
