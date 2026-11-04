const test = require('node:test');
const assert = require('node:assert/strict');
const { createLinkedInAuth, parsePastedRedirect } = require('../src/linkedin/auth');
const { startCallbackServer } = require('../src/linkedin/callbackServer');

const NOW = new Date('2026-11-05T04:00:00Z');
const DAY = 86400000;

function memoryStore(initial = { drafts: [] }) {
  let state = structuredClone(initial);
  return { load: () => structuredClone(state), save: (s) => { state = structuredClone(s); } };
}

function setup({ scope = 'openid,profile,w_member_social', now = NOW, initial } = {}) {
  const store = memoryStore(initial);
  const calls = [];
  const linkedinApi = {
    authorizationUrl: ({ state }) => `https://www.linkedin.com/oauth/v2/authorization?state=${state}`,
    exchangeCode: async (args) => { calls.push(['exchange', args]); return { access_token: 'T1', expires_in: 60 * 86400, scope }; },
    getUserInfo: async (args) => { calls.push(['userinfo', args]); return { sub: 'abc123', name: 'Test Owner' }; },
  };
  const auth = createLinkedInAuth({ linkedinApi, store, clock: () => now });
  return { auth, store, calls };
}

const stateOf = (url) => new URL(url).searchParams.get('state');

test('each connect link carries a fresh random state', () => {
  const { auth, store } = setup();
  const first = stateOf(auth.connectUrl());
  const second = stateOf(auth.connectUrl());
  assert.match(first, /^[0-9a-f]{32}$/);
  assert.notEqual(first, second);
  assert.equal(store.load().linkedinAuthState, second, 'only the latest link is valid');
});

test('a valid redirect stores the token, expiry and author URN, and uses up the state', async () => {
  const { auth, store, calls } = setup();
  const state = stateOf(auth.connectUrl());
  const result = await auth.completeAuth({ code: 'C1', state });

  assert.equal(result.name, 'Test Owner');
  assert.deepEqual(calls, [['exchange', { code: 'C1' }], ['userinfo', { accessToken: 'T1' }]]);
  const saved = store.load();
  assert.equal(saved.linkedin.accessToken, 'T1');
  assert.equal(saved.linkedin.memberUrn, 'urn:li:person:abc123');
  assert.equal(saved.linkedin.expiresAt, new Date(NOW.getTime() + 60 * DAY).toISOString());
  assert.equal(saved.linkedinAuthState, undefined);

  await assert.rejects(auth.completeAuth({ code: 'C2', state }), /outdated/, 'the same state cannot be used twice');
});

test('a wrong state, a cancelled login or a missing posting scope stores nothing', async () => {
  const wrong = setup();
  wrong.auth.connectUrl();
  await assert.rejects(wrong.auth.completeAuth({ code: 'C1', state: 'forged' }), /outdated or was not sent by this bot/);
  assert.equal(wrong.calls.length, 0, 'no token exchange for an unknown state');

  const cancelled = setup();
  const state = stateOf(cancelled.auth.connectUrl());
  await assert.rejects(cancelled.auth.completeAuth({ state, error: 'user_cancelled_authorize', errorDescription: 'The user cancelled' }), /did not connect: The user cancelled/);

  const noScope = setup({ scope: 'openid profile' });
  const s2 = stateOf(noScope.auth.connectUrl());
  await assert.rejects(noScope.auth.completeAuth({ code: 'C1', state: s2 }), /Share on LinkedIn/);
  assert.equal(noScope.store.load().linkedin, undefined);
});

test('requireToken refuses when not connected or expired, and getConnection never exposes the token', () => {
  assert.throws(() => setup().auth.requireToken(), /not connected yet/);

  const linkedin = { accessToken: 'SECRET-TOKEN', memberUrn: 'urn:li:person:x', name: 'X', expiresAt: new Date(NOW.getTime() - 1000).toISOString() };
  const expired = setup({ initial: { drafts: [], linkedin } });
  assert.throws(() => expired.auth.requireToken(), /expired/);

  const fresh = setup({ initial: { drafts: [], linkedin: { ...linkedin, expiresAt: new Date(NOW.getTime() + 10.5 * DAY).toISOString() } } });
  assert.deepEqual(fresh.auth.requireToken(), { accessToken: 'SECRET-TOKEN', memberUrn: 'urn:li:person:x' });
  const connection = fresh.auth.getConnection();
  assert.equal(connection.connected, true);
  assert.equal(connection.daysLeft, 10);
  assert.ok(!JSON.stringify(connection).includes('SECRET-TOKEN'));
});

test('a pasted redirect address is recognised; other text is not', () => {
  assert.deepEqual(
    parsePastedRedirect('http://localhost:8765/auth/linkedin/callback?code=AQT-x_1&state=abc'),
    { code: 'AQT-x_1', state: 'abc', error: undefined, errorDescription: undefined },
  );
  assert.equal(parsePastedRedirect('here: localhost:8765/auth/linkedin/callback?state=abc&error=user_cancelled_login').error, 'user_cancelled_login');
  assert.equal(parsePastedRedirect('/draft'), null);
  assert.equal(parsePastedRedirect('what is ?state=1 anyway'), null);
  assert.equal(parsePastedRedirect(undefined), null);
});

test('the callback server answers only the redirect path, on 127.0.0.1', async () => {
  const received = [];
  const server = await startCallbackServer({
    redirectUri: 'http://localhost:0/auth/linkedin/callback',
    onRedirect: async (params) => { received.push(params); return { ok: true, message: 'Connected <ok>' }; },
    log: () => {},
  });
  try {
    const { address, port } = server.address();
    assert.equal(address, '127.0.0.1');
    const other = await fetch(`http://127.0.0.1:${port}/other`);
    assert.equal(other.status, 404);
    const res = await fetch(`http://127.0.0.1:${port}/auth/linkedin/callback?code=C1&state=S1`);
    assert.equal(res.status, 200);
    assert.match(await res.text(), /Connected &lt;ok&gt;/);
    assert.deepEqual(received, [{ code: 'C1', state: 'S1', error: undefined, errorDescription: undefined }]);
  } finally {
    server.close();
  }
});

test('no callback server for a redirect that is not local http', async () => {
  const logs = [];
  const server = await startCallbackServer({ redirectUri: 'https://localhost:8765/auth/linkedin/callback', onRedirect: async () => ({}), log: (m) => logs.push(m) });
  assert.equal(server, null);
  assert.match(logs[0], /Paste the address/);
});
