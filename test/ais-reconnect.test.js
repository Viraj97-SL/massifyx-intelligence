'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');

const { startAisStream, MIN_RECONNECT_DELAY_MS, MAX_RECONNECT_DELAY_MS } = require('../lib/ais/reconnectingAisStream');

class FakeWebSocket extends EventEmitter {
  constructor(url) {
    super();
    this.url = url;
    this.closeCalled = false;
  }

  send() {}

  close() {
    this.closeCalled = true;
  }
}

// A controllable fake timer: capture scheduled callbacks instead of
// actually waiting, so the test drives reconnect timing deterministically.
function createFakeTimers() {
  const scheduled = [];
  return {
    setTimeoutImpl(fn, ms) {
      const entry = { fn, ms, cancelled: false };
      scheduled.push(entry);
      return entry;
    },
    clearTimeoutImpl(entry) {
      entry.cancelled = true;
    },
    fireNext() {
      const entry = scheduled.shift();
      if (entry && !entry.cancelled) entry.fn();
    },
    pendingCount() {
      return scheduled.filter((e) => !e.cancelled).length;
    },
  };
}

test('reconnects with exponential backoff after the socket closes', () => {
  const created = [];
  const WebSocketImpl = class extends FakeWebSocket {
    constructor(url) {
      super(url);
      created.push(this);
    }
  };
  const timers = createFakeTimers();

  startAisStream({
    apiKey: 'k',
    onVessel: () => {},
    WebSocketImpl,
    setTimeoutImpl: timers.setTimeoutImpl,
    clearTimeoutImpl: timers.clearTimeoutImpl,
  });

  assert.equal(created.length, 1);
  created[0].emit('close');
  assert.equal(timers.pendingCount(), 1);

  timers.fireNext();
  assert.equal(created.length, 2);

  created[1].emit('close');
  timers.fireNext();
  assert.equal(created.length, 3);
});

test('stop() prevents further reconnects and closes the current socket', () => {
  const created = [];
  const WebSocketImpl = class extends FakeWebSocket {
    constructor(url) {
      super(url);
      created.push(this);
    }
  };
  const timers = createFakeTimers();

  const handle = startAisStream({
    apiKey: 'k',
    onVessel: () => {},
    WebSocketImpl,
    setTimeoutImpl: timers.setTimeoutImpl,
    clearTimeoutImpl: timers.clearTimeoutImpl,
  });

  handle.stop();
  assert.equal(created[0].closeCalled, true);

  created[0].emit('close');
  assert.equal(timers.pendingCount(), 0);
  assert.equal(created.length, 1);
});

test('a successful open resets the backoff delay', () => {
  const created = [];
  const WebSocketImpl = class extends FakeWebSocket {
    constructor(url) {
      super(url);
      created.push(this);
    }
  };
  const delays = [];
  const timers = {
    setTimeoutImpl(fn, ms) {
      delays.push(ms);
      const entry = { fn, cancelled: false };
      return entry;
    },
    clearTimeoutImpl() {},
  };

  startAisStream({
    apiKey: 'k',
    onVessel: () => {},
    WebSocketImpl,
    setTimeoutImpl: timers.setTimeoutImpl,
    clearTimeoutImpl: timers.clearTimeoutImpl,
  });

  created[0].emit('close'); // delay #1 recorded, no open in between
  assert.equal(delays[0], MIN_RECONNECT_DELAY_MS);
});

// Resilience case: a real outage isn't just one disconnect, it's many in a
// row with the remote end never coming back up long enough for 'open' to
// fire. Confirms the exponential backoff actually stops growing at
// MAX_RECONNECT_DELAY_MS instead of climbing indefinitely (which would
// eventually schedule a reconnect so far in the future it looks like the
// stream gave up entirely).
test('repeated disconnects with no successful open in between cap the delay at MAX_RECONNECT_DELAY_MS', () => {
  const created = [];
  const WebSocketImpl = class extends FakeWebSocket {
    constructor(url) {
      super(url);
      created.push(this);
    }
  };
  const delays = [];
  const pending = [];
  const timers = {
    setTimeoutImpl(fn, ms) {
      delays.push(ms);
      const entry = { fn, cancelled: false };
      pending.push(entry);
      return entry;
    },
    clearTimeoutImpl(entry) {
      entry.cancelled = true;
    },
  };

  startAisStream({
    apiKey: 'k',
    onVessel: () => {},
    WebSocketImpl,
    setTimeoutImpl: timers.setTimeoutImpl,
    clearTimeoutImpl: timers.clearTimeoutImpl,
  });

  // Well past the number of doublings needed to hit the cap from
  // MIN_RECONNECT_DELAY_MS (1s -> 2 -> 4 -> 8 -> 16 -> 30, capped).
  for (let i = 0; i < 10; i += 1) {
    created[created.length - 1].emit('close');
    const next = pending.pop();
    next.fn();
  }

  assert.equal(Math.max(...delays), MAX_RECONNECT_DELAY_MS);
  assert.equal(delays[delays.length - 1], MAX_RECONNECT_DELAY_MS, 'the delay must stay capped, not keep growing');
});
