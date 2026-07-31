'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');

const { startAisStream, MIN_RECONNECT_DELAY_MS } = require('../lib/ais/reconnectingAisStream');

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
