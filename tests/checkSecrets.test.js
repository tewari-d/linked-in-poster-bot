const test = require('node:test');
const assert = require('node:assert/strict');
const { findProblems } = require('../src/cli/checkSecrets');

// Built at runtime so this file itself never contains a key-shaped string.
const fakeTelegramToken = `${'1'.repeat(10)}:${'A'.repeat(35)}`;
const fakeGoogleKey = `AIza${'B'.repeat(35)}`;

test('files that hold keys or the token are refused by name', () => {
  const files = ['.env', '.env.backup', 'data/state.json', 'data/state.json.bak', 'dist/linkedin-poster.tgz', 'linkedin-poster.tgz']
    .map((path) => ({ path, content: '' }));
  assert.equal(findProblems({ files, secrets: {} }).length, files.length);
  assert.deepEqual(findProblems({ files: [{ path: '.env.example', content: 'GEMINI_API_KEY=' }], secrets: {} }), []);
});

test('a real local secret value inside any file is caught, without printing the value', () => {
  const problems = findProblems({
    files: [{ path: 'src/config.js', content: 'const key = "my-real-gemini-key-123";' }],
    secrets: { GEMINI_API_KEY: 'my-real-gemini-key-123' },
  });
  assert.deepEqual(problems, ['src/config.js: contains your GEMINI_API_KEY']);
  assert.ok(!problems.join().includes('my-real-gemini-key-123'));
});

test('key-shaped strings are caught even when they are not this machine\'s keys', () => {
  const problems = findProblems({ files: [{ path: 'notes.md', content: `old token ${fakeTelegramToken} and ${fakeGoogleKey}` }], secrets: {} });
  assert.equal(problems.length, 2);
  assert.match(problems[0], /Telegram bot token/);
  assert.match(problems[1], /Google API key/);
});

test('ordinary code passes', () => {
  assert.deepEqual(findProblems({ files: [{ path: 'src/app.js', content: 'const token = config.telegram.botToken;' }], secrets: { X: 'something-else' } }), []);
});
