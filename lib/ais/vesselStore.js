'use strict';

// In-memory only -- vessel positions are inherently ephemeral live state.
// Unlike disruption events (which get a Postgres store for history), there
// is no value in persisting a stale AIS position across a restart.
const DEFAULT_STALE_AFTER_MS = 10 * 60 * 1000;

class VesselStore {
  constructor({ staleAfterMs = DEFAULT_STALE_AFTER_MS } = {}) {
    this.staleAfterMs = staleAfterMs;
    this.vessels = new Map();
  }

  upsert(vessel, now = new Date()) {
    this.vessels.set(vessel.mmsi, { ...vessel, lastUpdatedAt: now });
  }

  pruneStale(now = new Date()) {
    let pruned = 0;
    for (const [mmsi, vessel] of this.vessels) {
      if (now - vessel.lastUpdatedAt > this.staleAfterMs) {
        this.vessels.delete(mmsi);
        pruned += 1;
      }
    }
    return { pruned };
  }

  listAll() {
    return [...this.vessels.values()];
  }

  size() {
    return this.vessels.size;
  }
}

module.exports = { VesselStore, DEFAULT_STALE_AFTER_MS };
