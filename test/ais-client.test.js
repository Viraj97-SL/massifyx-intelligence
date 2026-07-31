'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');

const { connectAisStream, parsePositionReport, STREAM_URL } = require('../lib/ais/aisStreamClient');

class FakeWebSocket extends EventEmitter {
  constructor(url) {
    super();
    this.url = url;
    this.sent = [];
    this.closed = false;
  }

  send(data) {
    this.sent.push(data);
  }

  close() {
    this.closed = true;
    this.emit('close');
  }
}

const VALID_POSITION_REPORT = JSON.stringify({
  MessageType: 'PositionReport',
  MetaData: { MMSI: 123456789, ShipName: '  EVER GIVEN  ' },
  Message: { PositionReport: { Latitude: 30.01, Longitude: 32.58, Sog: 12.3, TrueHeading: 87 } },
});

test('parsePositionReport extracts the fields we use, trimming ship name', () => {
  const vessel = parsePositionReport(VALID_POSITION_REPORT);
  assert.deepEqual(vessel, {
    mmsi: '123456789',
    shipName: 'EVER GIVEN',
    lat: 30.01,
    lon: 32.58,
    headingDeg: 87,
    speedKnots: 12.3,
  });
});

test('parsePositionReport returns null for a non-position message type', () => {
  const msg = JSON.stringify({ MessageType: 'ShipStaticData', MetaData: {}, Message: {} });
  assert.equal(parsePositionReport(msg), null);
});

test('parsePositionReport returns null for malformed JSON', () => {
  assert.equal(parsePositionReport('not json{'), null);
});

test('parsePositionReport returns null when lat/lon are missing or invalid', () => {
  const msg = JSON.stringify({
    MessageType: 'PositionReport',
    MetaData: { MMSI: 1 },
    Message: { PositionReport: { Latitude: 'nope', Longitude: 32.58 } },
  });
  assert.equal(parsePositionReport(msg), null);
});

test('parsePositionReport returns null without an MMSI', () => {
  const msg = JSON.stringify({
    MessageType: 'PositionReport',
    MetaData: {},
    Message: { PositionReport: { Latitude: 1, Longitude: 1 } },
  });
  assert.equal(parsePositionReport(msg), null);
});

test('parsePositionReport treats an out-of-range heading (360 = unavailable) as null', () => {
  const msg = JSON.stringify({
    MessageType: 'PositionReport',
    MetaData: { MMSI: 1 },
    Message: { PositionReport: { Latitude: 1, Longitude: 1, TrueHeading: 511 } },
  });
  const vessel = parsePositionReport(msg);
  assert.equal(vessel.headingDeg, null);
});

test('connectAisStream sends the subscription message on open', () => {
  const socket = connectAisStream({
    apiKey: 'test-key',
    onVessel: () => {},
    WebSocketImpl: FakeWebSocket,
  });

  assert.equal(socket.url, STREAM_URL);
  socket.emit('open');

  assert.equal(socket.sent.length, 1);
  const subscription = JSON.parse(socket.sent[0]);
  assert.equal(subscription.APIKey, 'test-key');
  assert.deepEqual(subscription.FilterMessageTypes, ['PositionReport']);
});

test('connectAisStream calls onVessel for each valid position report', () => {
  const received = [];
  const socket = connectAisStream({
    apiKey: 'test-key',
    onVessel: (v) => received.push(v),
    WebSocketImpl: FakeWebSocket,
  });

  socket.emit('message', VALID_POSITION_REPORT);
  socket.emit('message', 'garbage, not json');

  assert.equal(received.length, 1);
  assert.equal(received[0].mmsi, '123456789');
});

test('connectAisStream requires an apiKey and an onVessel callback', () => {
  assert.throws(
    () => connectAisStream({ onVessel: () => {}, WebSocketImpl: FakeWebSocket }),
    /apiKey is required/,
  );
  assert.throws(
    () => connectAisStream({ apiKey: 'k', WebSocketImpl: FakeWebSocket }),
    /onVessel callback is required/,
  );
});
