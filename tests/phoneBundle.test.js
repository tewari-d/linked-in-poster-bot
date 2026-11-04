const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { bundleEntries, scriptsWithCrlf } = require('../src/cli/phoneBundle');

const SECRETS = ['.env', 'data/state.json'];

test('an update bundle never carries the keys or the LinkedIn token', () => {
  const entries = bundleEntries({ withSecrets: false });
  for (const secret of SECRETS) assert.ok(!entries.includes(secret), `${secret} must not be in an update bundle`);
  for (const needed of ['package.json', 'package-lock.json', 'src', 'prompts', 'data/topics.json', 'deploy']) assert.ok(entries.includes(needed));
});

test('the phone scripts in the repo have Unix line endings', () => {
  assert.deepEqual(scriptsWithCrlf({ dir: path.join(__dirname, '..', 'deploy', 'termux') }), []);
});

test('the first-install bundle adds exactly .env and data/state.json', () => {
  const extra = bundleEntries({ withSecrets: true }).filter((e) => !bundleEntries({ withSecrets: false }).includes(e));
  assert.deepEqual(extra, SECRETS);
});
