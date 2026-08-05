'use strict';

const DEFAULT_LIST_LIMIT = 500;

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

  // Mirrors PostgresEventStore.listAll's filter/limit contract (see that
  // file's docstring) so both stores behave identically from createApp.js's
  // point of view.
  async listAll(filters = {}) {
    let events = [...this.events.values()];
    if (filters.minSeverity !== undefined) {
      events = events.filter((e) => e.severity >= filters.minSeverity);
    }
    if (filters.category !== undefined) {
      events = events.filter((e) => e.category === filters.category);
    }
    if (filters.since !== undefined) {
      events = events.filter((e) => e.lastUpdatedAt >= filters.since);
    }
    events.sort((a, b) => b.lastUpdatedAt - a.lastUpdatedAt);
    return events.slice(0, filters.limit ?? DEFAULT_LIST_LIMIT);
  }

  async countAll() {
    return this.events.size;
  }
}

module.exports = { MemoryEventStore };
