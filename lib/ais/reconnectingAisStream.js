'use strict';

const { connectAisStream } = require('./aisStreamClient');

const MIN_RECONNECT_DELAY_MS = 1000;
const MAX_RECONNECT_DELAY_MS = 30000;

// Keeps an AIS stream connection alive, reconnecting with exponential
// backoff on close. Returns { stop() } so callers (server.js, tests) can
// shut it down cleanly instead of leaking a socket + timer.
function startAisStream({
  apiKey,
  onVessel,
  WebSocketImpl,
  boundingBoxes,
  url,
  setTimeoutImpl = setTimeout,
  clearTimeoutImpl = clearTimeout,
}) {
  let stopped = false;
  let delay = MIN_RECONNECT_DELAY_MS;
  let socket = null;
  let timer = null;

  function scheduleReconnect() {
    if (stopped) return;
    timer = setTimeoutImpl(() => {
      delay = Math.min(delay * 2, MAX_RECONNECT_DELAY_MS);
      connect();
    }, delay);
  }

  function connect() {
    if (stopped) return;
    socket = connectAisStream({ apiKey, onVessel, WebSocketImpl, boundingBoxes, url });
    socket.on('open', () => {
      delay = MIN_RECONNECT_DELAY_MS;
    });
    socket.on('close', scheduleReconnect);
    // 'close' still fires after 'error' on a ws-compatible socket, so the
    // reconnect is driven from there; this just stops an unhandled 'error'
    // from crashing the process.
    socket.on('error', () => {});
  }

  connect();

  return {
    stop() {
      stopped = true;
      if (timer) clearTimeoutImpl(timer);
      if (socket && typeof socket.close === 'function') socket.close();
    },
  };
}

module.exports = { startAisStream, MIN_RECONNECT_DELAY_MS, MAX_RECONNECT_DELAY_MS };
