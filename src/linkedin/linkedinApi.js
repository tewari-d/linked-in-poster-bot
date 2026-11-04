// LinkedIn's official API via fetch. Access tokens, the client secret and upload URLs (which are
// signed) are never put into errors or logs.
const AUTH_BASE = 'https://www.linkedin.com/oauth/v2';
const API_BASE = 'https://api.linkedin.com';
// openid + profile are needed only to learn the member id (`sub`) that becomes the post author.
const SCOPES = ['openid', 'profile', 'w_member_social'];
const TIMEOUT_MS = 30_000;
const UPLOAD_TIMEOUT_MS = 120_000;
// These fail before a connection exists, so the request provably never reached LinkedIn.
const NEVER_SENT_CODES = new Set(['ENOTFOUND', 'EAI_AGAIN', 'ECONNREFUSED']);

class LinkedInError extends Error {
  constructor(message, { status, ambiguous = false, cause } = {}) {
    super(message, { cause });
    this.name = 'LinkedInError';
    this.status = status;
    // True when no success answer arrived but the request may still have taken effect.
    this.ambiguous = ambiguous;
  }
}

function createLinkedInApi({ clientId, clientSecret, redirectUri, apiVersion, fetchFn = fetch }) {
  async function request({ what, url, init = {}, timeoutMs = TIMEOUT_MS }) {
    let res;
    try {
      res = await fetchFn(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
    } catch (err) {
      const code = err.cause?.code ?? err.name;
      throw new LinkedInError(`${what}: no answer from LinkedIn (${code})`, { ambiguous: !NEVER_SENT_CODES.has(code), cause: err });
    }
    if (res.ok) return res;
    const body = await res.json().catch(() => null);
    const detail = body?.message ?? body?.error_description ?? body?.error ?? res.statusText;
    // A server error can come after the work was done; a client error means LinkedIn rejected it.
    throw new LinkedInError(`${what} failed (${res.status}): ${detail}`, { status: res.status, ambiguous: res.status >= 500 });
  }

  const restHeaders = (accessToken) => ({
    authorization: `Bearer ${accessToken}`,
    'linkedin-version': apiVersion,
    'x-restli-protocol-version': '2.0.0',
    'content-type': 'application/json',
  });

  function authorizationUrl({ state }) {
    const params = new URLSearchParams({ response_type: 'code', client_id: clientId, redirect_uri: redirectUri, state, scope: SCOPES.join(' ') });
    return `${AUTH_BASE}/authorization?${params}`;
  }

  async function exchangeCode({ code }) {
    const res = await request({
      what: 'Getting the LinkedIn access token',
      url: `${AUTH_BASE}/accessToken`,
      init: {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ grant_type: 'authorization_code', code, client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri }),
      },
    });
    return res.json();
  }

  async function getUserInfo({ accessToken }) {
    const res = await request({
      what: 'Reading your LinkedIn member id',
      url: `${API_BASE}/v2/userinfo`,
      init: { headers: { authorization: `Bearer ${accessToken}` } },
    });
    return res.json();
  }

  async function uploadImage({ accessToken, owner, bytes }) {
    const res = await request({
      what: 'Preparing the image upload',
      url: `${API_BASE}/rest/images?action=initializeUpload`,
      init: { method: 'POST', headers: restHeaders(accessToken), body: JSON.stringify({ initializeUploadRequest: { owner } }) },
    });
    const value = (await res.json().catch(() => null))?.value;
    if (!value?.uploadUrl || !value?.image) throw new LinkedInError('Preparing the image upload: LinkedIn returned no upload address');
    await request({
      what: 'Uploading the image',
      url: value.uploadUrl,
      // Image uploads need the token (unlike video uploads, per LinkedIn's docs).
      init: { method: 'PUT', headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/octet-stream' }, body: bytes },
      timeoutMs: UPLOAD_TIMEOUT_MS,
    });
    return value.image;
  }

  // Returns the post URN from the x-restli-id header (null if LinkedIn leaves it out).
  async function createPost({ accessToken, author, commentary, imageUrn }) {
    const body = {
      author,
      commentary,
      visibility: 'PUBLIC',
      distribution: { feedDistribution: 'MAIN_FEED', targetEntities: [], thirdPartyDistributionChannels: [] },
      lifecycleState: 'PUBLISHED',
      isReshareDisabledByAuthor: false,
    };
    if (imageUrn) body.content = { media: { id: imageUrn } };
    const res = await request({
      what: 'Creating the LinkedIn post',
      url: `${API_BASE}/rest/posts`,
      init: { method: 'POST', headers: restHeaders(accessToken), body: JSON.stringify(body) },
    });
    return res.headers.get('x-restli-id');
  }

  return { authorizationUrl, exchangeCode, getUserInfo, uploadImage, createPost };
}

const postUrl = (postUrn) => (postUrn ? `https://www.linkedin.com/feed/update/${postUrn}/` : null);

module.exports = { createLinkedInApi, LinkedInError, postUrl, SCOPES };
