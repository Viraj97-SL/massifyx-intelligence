'use strict';

const { parseGdeltEventExport } = require('./parseEvents');

const LASTUPDATE_URL = 'http://data.gdeltproject.org/gdeltv2/lastupdate.txt';

// lastupdate.txt has three lines (export, mentions, gkg), each
// "<size> <md5> <url>". We only want the event export.
function pickExportUrl(lastUpdateText) {
  const line = lastUpdateText
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l.includes('.export.CSV.zip'));
  if (!line) {
    throw new Error('No export CSV URL found in GDELT lastupdate.txt');
  }
  return line.split(' ').pop();
}

// fetchImpl/unzipImpl are injected so tests never touch the network or a
// real zip file — see test/gdelt-ingest.test.js.
async function fetchRecentEvents({ fetchImpl, unzipImpl }) {
  if (typeof fetchImpl !== 'function') throw new Error('fetchImpl is required');
  if (typeof unzipImpl !== 'function') throw new Error('unzipImpl is required');

  const lastUpdateRes = await fetchImpl(LASTUPDATE_URL);
  if (!lastUpdateRes.ok) {
    throw new Error(`GDELT lastupdate.txt fetch failed: ${lastUpdateRes.status}`);
  }
  const exportUrl = pickExportUrl(await lastUpdateRes.text());

  const exportRes = await fetchImpl(exportUrl);
  if (!exportRes.ok) {
    throw new Error(`GDELT export fetch failed: ${exportRes.status}`);
  }
  const zipBuffer = Buffer.from(await exportRes.arrayBuffer());
  const csvText = await unzipImpl(zipBuffer);

  return parseGdeltEventExport(csvText);
}

module.exports = { fetchRecentEvents, pickExportUrl, LASTUPDATE_URL };
