// Packs the bot into dist/linkedin-poster.tgz for copying to the phone over USB.
// Usage: npm run phone:bundle                    code only (for updates: the phone keeps its own .env and state)
//        npm run phone:bundle -- --with-secrets  first install: also .env and data/state.json (the LinkedIn token)
const fs = require('node:fs');
const path = require('node:path');
const { parseArgs } = require('node:util');
const { spawnSync } = require('node:child_process');

const ROOT_DIR = path.resolve(__dirname, '..', '..');
// Relative to ROOT_DIR. A relative archive path also keeps GNU tar from reading "C:" as a remote host.
const OUT_FILE = path.join('dist', 'linkedin-poster.tgz');
const CODE_ENTRIES = ['package.json', 'package-lock.json', '.env.example', 'src', 'prompts', 'data/topics.json', 'deploy', 'tests'];
const SECRET_ENTRIES = ['.env', 'data/state.json'];

function bundleEntries({ withSecrets }) {
  return withSecrets ? [...CODE_ENTRIES, ...SECRET_ENTRIES] : [...CODE_ENTRIES];
}

// Termux runs these with sh/bash, which fail on Windows line endings ("pipefail\r: invalid option").
function scriptsWithCrlf({ dir }) {
  return fs.readdirSync(dir).filter((name) => fs.readFileSync(path.join(dir, name), 'utf8').includes('\r'));
}

function main() {
  const { values } = parseArgs({ options: { 'with-secrets': { type: 'boolean', default: false } } });
  const withSecrets = values['with-secrets'];
  const entries = bundleEntries({ withSecrets });

  const missing = entries.filter((entry) => !fs.existsSync(path.join(ROOT_DIR, entry)));
  if (missing.length) {
    throw new Error(`Cannot bundle, missing: ${missing.join(', ')}. ${missing.includes('data/state.json') ? 'Run the bot once on the laptop first, or connect LinkedIn on the phone later with /linkedin.' : ''}`.trim());
  }

  const crlf = scriptsWithCrlf({ dir: path.join(ROOT_DIR, 'deploy', 'termux') });
  if (crlf.length) {
    throw new Error(`These phone scripts have Windows line endings: ${crlf.join(', ')}. Convert them to LF (VS Code: click "CRLF" in the status bar, pick LF, save).`);
  }

  fs.mkdirSync(path.join(ROOT_DIR, 'dist'), { recursive: true });
  // ustar: Windows tar otherwise adds file-flag headers that make the phone's GNU tar warn about every file.
  const result = spawnSync('tar', ['--format=ustar', '-czf', OUT_FILE, ...entries], { cwd: ROOT_DIR, stdio: 'inherit' });
  if (result.error) throw new Error(`Could not run tar (${result.error.code}). It ships with Windows 10+ and Termux.`, { cause: result.error });
  if (result.status !== 0) throw new Error(`tar exited with code ${result.status}`);

  const { size } = fs.statSync(path.join(ROOT_DIR, OUT_FILE));
  console.log(`Created ${path.join(ROOT_DIR, OUT_FILE)} (${Math.round(size / 1024)} KB)${withSecrets ? ', INCLUDING .env and the LinkedIn token' : ', code only'}.`);
  console.log('Copy it to the phone\'s Download folder over USB (File transfer), then follow the steps in Termux.');
  if (withSecrets) {
    console.log('It contains your keys: delete it from the laptop and from the phone\'s Download folder once it is unpacked.');
    console.log('From now on the bot runs on the phone only. Do not start it on the laptop again (Telegram allows one bot copy).');
  }
}

if (require.main === module) {
  try {
    main();
  } catch (err) {
    console.error(`Error: ${err.message}`);
    process.exitCode = 1;
  }
}

module.exports = { bundleEntries, scriptsWithCrlf };
