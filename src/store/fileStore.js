const fs = require('node:fs');
const path = require('node:path');

const EMPTY_STATE = () => ({ drafts: [] });
const LOCK_CODES = new Set(['EPERM', 'EBUSY', 'EACCES']);
const RENAME_ATTEMPTS = 5;

function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

// On Windows, OneDrive sync or antivirus can hold a brief lock on the file being replaced.
function renameWithRetry(from, to) {
  for (let attempt = 1; ; attempt++) {
    try {
      fs.renameSync(from, to);
      return;
    } catch (err) {
      if (!LOCK_CODES.has(err.code) || attempt >= RENAME_ATTEMPTS) throw err;
      sleepSync(100 * attempt);
    }
  }
}

function createFileStore({ dataDir }) {
  const filePath = path.join(dataDir, 'state.json');

  function load() {
    try {
      return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch (err) {
      if (err.code === 'ENOENT') return EMPTY_STATE();
      throw new Error(`Cannot read ${filePath}: ${err.message}. Fix it or restore ${filePath}.bak`, { cause: err });
    }
  }

  // Write to a temp file and rename, so a crash or power cut mid-write never leaves a half-written state.
  function save(state) {
    fs.mkdirSync(dataDir, { recursive: true });
    const tmpPath = `${filePath}.tmp`;
    fs.writeFileSync(tmpPath, `${JSON.stringify(state, null, 2)}\n`);
    try {
      if (fs.existsSync(filePath)) fs.copyFileSync(filePath, `${filePath}.bak`);
    } catch {
      // The .bak copy is a convenience for manual recovery; a locked file must not block the real save.
    }
    renameWithRetry(tmpPath, filePath);
  }

  return { filePath, load, save };
}

module.exports = { createFileStore };
