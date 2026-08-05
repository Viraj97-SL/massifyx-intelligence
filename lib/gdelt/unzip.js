'use strict';

const AdmZip = require('adm-zip');

// GDELT's real 15-minute event exports run a few hundred KB to a few MB.
// 100 MB uncompressed is already two orders of magnitude past anything
// legitimate, so anything past it is treated as a zip-bomb / corrupted feed
// rather than decompressed. AdmZip's getEntries() reads only the central
// directory (declared sizes), so this check runs before the actual inflate
// (zip.getEntries()[i].getData()) does any CPU-heavy work.
const MAX_UNCOMPRESSED_BYTES = 100 * 1024 * 1024;

// Real unzip implementation for production use. GDELT ships each export as
// a zip with one CSV inside; we take the first entry regardless of name.
function unzipToText(buffer) {
  const zip = new AdmZip(buffer);
  const entries = zip.getEntries();
  if (entries.length === 0) {
    throw new Error('GDELT export zip had no entries');
  }
  const declaredSize = entries[0].header.size;
  if (declaredSize > MAX_UNCOMPRESSED_BYTES) {
    throw new Error(
      `GDELT export entry declares ${declaredSize} uncompressed bytes, over the ${MAX_UNCOMPRESSED_BYTES}-byte cap -- refusing to decompress`
    );
  }
  return entries[0].getData().toString('utf8');
}

module.exports = { unzipToText, MAX_UNCOMPRESSED_BYTES };
