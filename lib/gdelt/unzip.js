'use strict';

const AdmZip = require('adm-zip');

// Real unzip implementation for production use. GDELT ships each export as
// a zip with one CSV inside; we take the first entry regardless of name.
function unzipToText(buffer) {
  const zip = new AdmZip(buffer);
  const entries = zip.getEntries();
  if (entries.length === 0) {
    throw new Error('GDELT export zip had no entries');
  }
  return entries[0].getData().toString('utf8');
}

module.exports = { unzipToText };
