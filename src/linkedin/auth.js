// LinkedIn connection: the OAuth link, the redirect it comes back with, and the stored token.
// The token goes from LinkedIn straight into state.json on this device and nowhere else.
const crypto = require('node:crypto');

const DAY_MS = 24 * 60 * 60 * 1000;
// A token this close to expiry could run out between the check and the post.
const EXPIRY_MARGIN_MS = 5 * 60 * 1000;
const POSTING_SCOPE = 'w_member_social';

function createLinkedInAuth({ linkedinApi, store, clock = () => new Date() }) {
  // Each link carries a fresh random state, so a redirect is accepted only if it answers a link this
  // bot sent (stops a stranger's page from connecting a different LinkedIn account through localhost).
  function connectUrl() {
    const state = store.load();
    state.linkedinAuthState = crypto.randomBytes(16).toString('hex');
    store.save(state);
    return linkedinApi.authorizationUrl({ state: state.linkedinAuthState });
  }

  async function completeAuth({ code, state: returnedState, error, errorDescription }) {
    const expected = store.load().linkedinAuthState;
    if (!expected || returnedState !== expected) {
      throw new Error('This LinkedIn link is outdated or was not sent by this bot. Send /linkedin for a fresh one.');
    }
    if (error) throw new Error(`LinkedIn did not connect: ${errorDescription || error}. Send /linkedin to try again.`);
    if (!code) throw new Error('The LinkedIn address has no code in it. Copy the whole address after tapping Allow.');

    const token = await linkedinApi.exchangeCode({ code });
    if (!token?.access_token || !token?.expires_in) throw new Error('LinkedIn returned no access token. Send /linkedin to try again.');
    // LinkedIn has been seen to separate scopes with commas as well as spaces.
    const scopes = String(token.scope ?? '').split(/[\s,]+/).filter(Boolean);
    if (scopes.length && !scopes.includes(POSTING_SCOPE)) {
      throw new Error(`LinkedIn granted "${scopes.join(' ')}" without ${POSTING_SCOPE}. Add the "Share on LinkedIn" product to the app, then send /linkedin.`);
    }
    const profile = await linkedinApi.getUserInfo({ accessToken: token.access_token });
    if (!profile?.sub) throw new Error('LinkedIn returned no member id. Check that the app has "Sign In with LinkedIn using OpenID Connect".');

    const now = clock();
    const state = store.load();
    state.linkedin = {
      accessToken: token.access_token,
      expiresAt: new Date(now.getTime() + token.expires_in * 1000).toISOString(),
      memberUrn: `urn:li:person:${profile.sub}`,
      name: profile.name ?? null,
      scope: token.scope ?? null,
      connectedAt: now.toISOString(),
    };
    delete state.linkedinAuthState;
    store.save(state);
    return { name: state.linkedin.name, expiresAt: state.linkedin.expiresAt };
  }

  // Safe to show or log: never includes the token.
  function getConnection() {
    const li = store.load().linkedin;
    if (!li?.accessToken) return { connected: false, expired: false };
    const msLeft = Date.parse(li.expiresAt) - clock().getTime();
    return {
      connected: msLeft > EXPIRY_MARGIN_MS,
      expired: msLeft <= EXPIRY_MARGIN_MS,
      name: li.name,
      expiresAt: li.expiresAt,
      daysLeft: Math.max(0, Math.floor(msLeft / DAY_MS)),
    };
  }

  function requireToken() {
    const li = store.load().linkedin;
    const connection = getConnection();
    if (!connection.connected) {
      throw new Error(connection.expired
        ? 'LinkedIn access has expired. Send /linkedin to reconnect, then tap Post again.'
        : 'LinkedIn is not connected yet. Send /linkedin to connect, then tap Post again.');
    }
    return { accessToken: li.accessToken, memberUrn: li.memberUrn };
  }

  return { connectUrl, completeAuth, getConnection, requireToken };
}

// Reads code/state/error from a pasted redirect address, or from the callback request's query.
function redirectParams(searchParams) {
  return {
    code: searchParams.get('code') ?? undefined,
    state: searchParams.get('state') ?? undefined,
    error: searchParams.get('error') ?? undefined,
    errorDescription: searchParams.get('error_description') ?? undefined,
  };
}

// The owner may paste the address the browser landed on when the localhost redirect could not load.
function parsePastedRedirect(text) {
  const match = String(text ?? '').match(/\S*[?&]state=\S*/);
  if (!match) return null;
  const query = match[0].slice(match[0].indexOf('?') + 1);
  const params = redirectParams(new URLSearchParams(query));
  return params.code || params.error ? params : null;
}

module.exports = { createLinkedInAuth, redirectParams, parsePastedRedirect };
