// Stops keys and the LinkedIn token from reaching git. Runs as the pre-commit hook (.githooks/pre-commit).
// Usage: npm run secrets:check            the staged files, i.e. what the next commit would contain
//        npm run secrets:check -- --all   every file git would upload (tracked + untracked, minus .gitignore)
// Reports file names only, never the secret values.
const fs = require('node:fs');
const path = require('node:path');
const { parseArgs } = require('node:util');
const { execFileSync } = require('node:child_process');

const FORBIDDEN_FILES = [
  { re: /^\.env$/, why: 'holds the API keys' },
  { re: /^\.env\.(?!example$)/, why: 'looks like a copy of .env' },
  { re: /(^|\/)state\.json/, why: 'holds the LinkedIn access token' },
  { re: /\.tgz$/, why: 'may be a phone bundle with keys' },
  { re: /^dist\//, why: 'is build output' },
];
// Shapes of keys that may not be in this laptop's .env (an old or rotated one pasted somewhere).
const KEY_PATTERNS = [
  { re: /\b\d{8,10}:[A-Za-z0-9_-]{35}\b/, what: 'a Telegram bot token' },
  { re: /AIza[0-9A-Za-z_-]{35}/, what: 'a Google API key' },
];
const MIN_SECRET_LENGTH = 6;

function readEnvValues(file) {
  if (!fs.existsSync(file)) return {};
  const values = {};
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([A-Z][A-Z0-9_]*)=(.*)$/);
    if (m && /KEY|TOKEN|SECRET|CLIENT_ID|CHAT_ID/.test(m[1])) values[m[1]] = m[2].trim();
  }
  return values;
}

// The real values on this machine, so a key pasted into any file is caught even if its shape is unusual.
function loadLocalSecrets({ root }) {
  const secrets = readEnvValues(path.join(root, '.env'));
  const stateFile = path.join(root, 'data', 'state.json');
  if (fs.existsSync(stateFile)) {
    const li = JSON.parse(fs.readFileSync(stateFile, 'utf8')).linkedin;
    if (li?.accessToken) secrets['LinkedIn access token'] = li.accessToken;
  }
  return Object.fromEntries(Object.entries(secrets).filter(([, v]) => v && v.length >= MIN_SECRET_LENGTH));
}

function findProblems({ files, secrets }) {
  const problems = [];
  for (const { path: file, content } of files) {
    const forbidden = FORBIDDEN_FILES.find(({ re }) => re.test(file));
    if (forbidden) {
      problems.push(`${file}: must not be committed (${forbidden.why})`);
      continue;
    }
    for (const [name, value] of Object.entries(secrets)) {
      if (content.includes(value)) problems.push(`${file}: contains your ${name}`);
    }
    for (const { re, what } of KEY_PATTERNS) {
      if (re.test(content)) problems.push(`${file}: contains something shaped like ${what}`);
    }
  }
  return problems;
}

const git = (args, cwd) => execFileSync('git', args, { cwd, maxBuffer: 64 * 1024 * 1024 });
const nulList = (buf) => buf.toString('utf8').split('\0').filter(Boolean);

function collectFiles({ root, all }) {
  if (all) {
    return nulList(git(['ls-files', '--cached', '--others', '--exclude-standard', '-z'], root))
      .filter((file) => fs.existsSync(path.join(root, file)))
      .map((file) => ({ path: file, content: fs.readFileSync(path.join(root, file)).toString('latin1') }));
  }
  // The staged version is what gets committed, which may differ from the file on disk.
  return nulList(git(['diff', '--cached', '--name-only', '--diff-filter=ACMR', '-z'], root))
    .map((file) => ({ path: file, content: git(['show', `:${file}`], root).toString('latin1') }));
}

function main() {
  const { values } = parseArgs({ options: { all: { type: 'boolean', default: false } } });
  const root = git(['rev-parse', '--show-toplevel'], process.cwd()).toString('utf8').trim();
  const files = collectFiles({ root, all: values.all });
  const problems = findProblems({ files, secrets: loadLocalSecrets({ root }) });
  if (problems.length) {
    console.error('Blocked: these files would publish secrets.');
    for (const p of problems) console.error(`  - ${p}`);
    console.error('Unstage them (git restore --staged <file>) or remove the secret, then try again.');
    process.exitCode = 1;
    return;
  }
  console.log(`No secrets found in ${files.length} ${values.all ? 'files git would upload' : 'staged files'}.`);
}

if (require.main === module) {
  try {
    main();
  } catch (err) {
    console.error(`Secret check failed to run: ${err.message}`);
    process.exitCode = 1;
  }
}

module.exports = { findProblems, readEnvValues };
