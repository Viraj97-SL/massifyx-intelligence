'use strict';

const STREAM_URL = 'wss://stream.aisstream.io/v0/stream';

// Subscribes to the whole world -- aisstream.io's free tier supports this,
// but expect a high message volume; narrow this to specific corridors
// (e.g. Suez, Malacca, Panama approaches) if that becomes a problem.
const GLOBAL_BBOX = [[[-90, -180], [90, 180]]];

// Parses one aisstream.io PositionReport message into our vessel shape.
// Returns null for anything that isn't a usable position report --
// aisstream.io's schema isn't ours to control, so this stays defensive
// rather than assuming every field is always present or always spelled
// exactly this way.
function parsePositionReport(raw) {
  let message;
  try {
    message = typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch {
    return null;
  }

  if (!message || message.MessageType !== 'PositionReport') return null;

  const report = message.Message && message.Message.PositionReport;
  const meta = message.MetaData;
  if (!report || !meta) return null;

  const lat = Number(report.Latitude);
  const lon = Number(report.Longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (meta.MMSI === undefined || meta.MMSI === null) return null;

  const heading = Number(report.TrueHeading);
  const speed = Number(report.Sog);

  return {
    mmsi: String(meta.MMSI),
    shipName: typeof meta.ShipName === 'string' ? meta.ShipName.trim() : null,
    lat,
    lon,
    headingDeg: Number.isFinite(heading) && heading <= 360 ? heading : null,
    speedKnots: Number.isFinite(speed) ? speed : null,
  };
}

// WebSocketImpl is injected so tests never open a real connection -- same
// pattern as fetchImpl everywhere else in this codebase.
function connectAisStream({ apiKey, onVessel, WebSocketImpl, boundingBoxes = GLOBAL_BBOX, url = STREAM_URL }) {
  if (!apiKey) throw new Error('apiKey is required');
  if (typeof onVessel !== 'function') throw new Error('onVessel callback is required');

  const Impl = WebSocketImpl || require('ws');
  const socket = new Impl(url);

  socket.on('open', () => {
    socket.send(
      JSON.stringify({
        APIKey: apiKey,
        BoundingBoxes: boundingBoxes,
        FilterMessageTypes: ['PositionReport'],
      }),
    );
  });

  socket.on('message', (data) => {
    const vessel = parsePositionReport(data && data.toString ? data.toString() : data);
    if (vessel) onVessel(vessel);
  });

  return socket;
}

module.exports = { connectAisStream, parsePositionReport, GLOBAL_BBOX, STREAM_URL };
