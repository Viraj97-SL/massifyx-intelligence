'use strict';

const { MemoryEventStore } = require('./memoryEventStore');
const { PostgresEventStore } = require('./postgresEventStore');

// Factory so callers depend only on the contract, never on which store
// backs it — see DESIGN.md's repository-pattern requirement.
function createEventStore({ databaseUrl, Pool } = {}) {
  if (!databaseUrl) {
    return new MemoryEventStore();
  }
  const PgPool = Pool || require('pg').Pool;
  const pool = new PgPool({ connectionString: databaseUrl });
  return new PostgresEventStore(pool);
}

module.exports = { createEventStore, MemoryEventStore, PostgresEventStore };
