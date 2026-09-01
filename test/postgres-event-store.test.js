'use strict';

// PostgresEventStore has never had direct test coverage (see that file's own
// header comment: "not unit-tested here -- would need a live Postgres").
// That's true for the SQL semantics themselves, but the *class's own logic*
// around a `pg`-shaped pool -- acquiring/releasing a client, transaction
// bracketing, error propagation, parameter binding -- is exactly the kind of
// thing a fake pool double can exercise deterministically, offline, the same
// way MemoryEventStore's tests already stand in for a real store. This file
// is that coverage: a minimal fake pool/client, never a real database
// connection or network call.

const test = require('node:test');
const assert = require('node:assert/strict');

const { PostgresEventStore } = require('../lib/store/postgresEventStore');

function sampleEvent(overrides = {}) {
  return {
    id: 'evt_0000000000000001',
    title: 'Dockworkers strike halts container throughput',
    summary: 'Dockworkers in Rotterdam began a strike affecting container throughput.',
    category: 'labor',
    severity: 4,
    lat: 51.9225,
    lon: 4.47917,
    location: 'Rotterdam, Zuid-Holland, Netherlands',
    sourceCount: 12,
    sourceUrl: 'https://example.com/rotterdam-strike',
    eventDate: '2026-07-28',
    relevanceScore: 0.9,
    rawRefs: ['1001127001'],
    ...overrides,
  };
}

function firstLine(sql) {
  return sql.trim().split('\n')[0].trim();
}

function makeFakeClient() {
  const queries = [];
  const client = {
    released: false,
    queries,
    query: async (text) => {
      queries.push(firstLine(text));
      return { rows: [], rowCount: 0 };
    },
    release: () => {
      client.released = true;
    },
  };
  return client;
}

test('upsertEvents brackets each transaction in BEGIN/COMMIT and always releases the client', async () => {
  const client = makeFakeClient();
  const pool = { connect: async () => client };
  const store = new PostgresEventStore(pool);

  const { upserted } = await store.upsertEvents([sampleEvent()]);

  assert.equal(upserted, 1);
  assert.equal(client.queries[0], 'BEGIN');
  assert.equal(client.queries[client.queries.length - 1], 'COMMIT');
  assert.ok(client.queries[1].startsWith('INSERT INTO disruption_events'));
  assert.equal(client.released, true);
});

test('upsertEvents rolls back and still releases the client when a query fails partway through', async () => {
  const queries = [];
  const client = {
    released: false,
    query: async (text) => {
      const line = firstLine(text);
      queries.push(line);
      if (line.startsWith('INSERT')) throw new Error('duplicate key value violates unique constraint');
      return { rows: [], rowCount: 0 };
    },
    release: () => {
      client.released = true;
    },
  };
  const pool = { connect: async () => client };
  const store = new PostgresEventStore(pool);

  await assert.rejects(
    store.upsertEvents([sampleEvent()]),
    /duplicate key value violates unique constraint/,
  );

  assert.deepEqual(queries, ['BEGIN', 'INSERT INTO disruption_events (', 'ROLLBACK']);
  assert.equal(client.released, true, 'the client must go back to the pool even after a failed transaction');
});

// Explicitly requested resilience case: a pool that can't hand out a
// connection at all (exhausted pool, DB unreachable) must surface a clear
// rejection rather than hanging pollOnce() forever.
test('upsertEvents surfaces a clear rejection when the pool cannot provide a connection', async () => {
  const pool = {
    connect: async () => {
      throw new Error('remaining connection slots are reserved for non-replication superuser connections');
    },
  };
  const store = new PostgresEventStore(pool);

  await assert.rejects(
    store.upsertEvents([sampleEvent()]),
    /remaining connection slots are reserved/,
  );
});

test('countAll and listAll surface a clear rejection when the pool query itself fails', async () => {
  const pool = {
    query: async () => {
      throw new Error('connection terminated unexpectedly');
    },
  };
  const store = new PostgresEventStore(pool);

  await assert.rejects(store.countAll(), /connection terminated unexpectedly/);
  await assert.rejects(store.listAll(), /connection terminated unexpectedly/);
});

// Concurrency case explicitly called out in the audit: two overlapping
// upsertEvents() calls (e.g. from two overlapping poll cycles -- see
// lib/scheduler.js's overlap-guard fix, which is the real mitigation for
// this in production) must not share or stomp on each other's client state.
// Each call should acquire its own client from the pool, exactly like the
// real `pg` Pool does, so their transactions are logically independent.
test('two overlapping upsertEvents calls each acquire their own client rather than sharing one', async () => {
  const clients = [];
  const pool = {
    connect: async () => {
      const client = makeFakeClient();
      // Force real interleaving: yield to the event loop mid-transaction so
      // the two calls' queries can genuinely race against each other, not
      // just run one another to completion back-to-back.
      const rawQuery = client.query;
      client.query = async (text) => {
        await new Promise((resolve) => setImmediate(resolve));
        return rawQuery(text);
      };
      clients.push(client);
      return client;
    },
  };
  const store = new PostgresEventStore(pool);

  const [resultA, resultB] = await Promise.all([
    store.upsertEvents([sampleEvent({ id: 'evt_a' })]),
    store.upsertEvents([sampleEvent({ id: 'evt_b' })]),
  ]);

  assert.equal(resultA.upserted, 1);
  assert.equal(resultB.upserted, 1);
  assert.equal(clients.length, 2, 'each call should have acquired a distinct client from the pool');
  for (const client of clients) {
    assert.deepEqual(client.queries, ['BEGIN', 'INSERT INTO disruption_events (', 'COMMIT']);
    assert.equal(client.released, true);
  }
});

test('listAll parameterizes every filter value rather than concatenating it into the SQL text', async () => {
  let capturedSql;
  let capturedParams;
  const pool = {
    query: async (sql, params) => {
      capturedSql = sql;
      capturedParams = params;
      return { rows: [] };
    },
  };
  const store = new PostgresEventStore(pool);

  const maliciousCategory = "labor'; DROP TABLE disruption_events; --";
  const since = new Date('2026-01-01T00:00:00.000Z');
  await store.listAll({ minSeverity: 3, category: maliciousCategory, since, limit: 10 });

  assert.ok(
    !capturedSql.includes('DROP TABLE'),
    'a filter value must never be concatenated directly into the SQL text',
  );
  assert.deepEqual(capturedParams, [3, maliciousCategory, since, 10]);
  assert.match(capturedSql, /severity >= \$1/);
  assert.match(capturedSql, /category = \$2/);
  assert.match(capturedSql, /last_updated_at >= \$3/);
  assert.match(capturedSql, /LIMIT \$4/);
});

test('migrate() executes the real db/schema.sql against the pool', async () => {
  let executedSql;
  const pool = {
    query: async (sql) => {
      executedSql = sql;
    },
  };
  const store = new PostgresEventStore(pool);

  await store.migrate();

  assert.match(executedSql, /CREATE TABLE IF NOT EXISTS disruption_events/);
  assert.match(executedSql, /ALTER TABLE disruption_events ADD COLUMN IF NOT EXISTS event_date/);
});
