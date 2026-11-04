const test = require('node:test');
const assert = require('node:assert/strict');
const { createLinkedInApi, postUrl } = require('../src/linkedin/linkedinApi');

const TOKEN = 'SECRET-ACCESS-TOKEN';
const UPLOAD_URL = 'https://www.linkedin.com/dms-uploads/ABC/uploaded-image/0?signed=SIGNATURE';

const json = (status, body, headers = {}) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

function fakeFetch(responses) {
  const calls = [];
  const fn = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    const next = responses.shift();
    if (next instanceof Error) throw next;
    return next;
  };
  fn.calls = calls;
  return fn;
}

function client(responses) {
  const fetchFn = fakeFetch(responses);
  const api = createLinkedInApi({ clientId: 'CID', clientSecret: 'CSECRET', redirectUri: 'http://localhost:8765/auth/linkedin/callback', apiVersion: '202610', fetchFn });
  return { api, calls: fetchFn.calls };
}

const networkError = (code) => Object.assign(new TypeError('fetch failed'), { cause: { code } });

test('the authorization link asks for posting plus the member id, with the given state', () => {
  const { api } = client([]);
  const url = new URL(api.authorizationUrl({ state: 'S1' }));
  assert.equal(url.origin + url.pathname, 'https://www.linkedin.com/oauth/v2/authorization');
  assert.equal(url.searchParams.get('response_type'), 'code');
  assert.equal(url.searchParams.get('client_id'), 'CID');
  assert.equal(url.searchParams.get('redirect_uri'), 'http://localhost:8765/auth/linkedin/callback');
  assert.equal(url.searchParams.get('state'), 'S1');
  assert.equal(url.searchParams.get('scope'), 'openid profile w_member_social');
  assert.ok(!url.toString().includes('CSECRET'), 'the client secret never goes into a link');
});

test('the code exchange posts a form with the secret in the body', async () => {
  const { api, calls } = client([json(200, { access_token: TOKEN, expires_in: 5184000, scope: 'openid,profile,w_member_social' })]);
  const token = await api.exchangeCode({ code: 'CODE1' });
  assert.equal(token.access_token, TOKEN);
  assert.equal(calls[0].url, 'https://www.linkedin.com/oauth/v2/accessToken');
  const form = new URLSearchParams(calls[0].init.body);
  assert.equal(form.get('grant_type'), 'authorization_code');
  assert.equal(form.get('code'), 'CODE1');
  assert.equal(form.get('client_secret'), 'CSECRET');
  assert.equal(form.get('redirect_uri'), 'http://localhost:8765/auth/linkedin/callback');
});

test('createPost sends the versioned headers and body, and returns the post URN', async () => {
  const { api, calls } = client([new Response(null, { status: 201, headers: { 'x-restli-id': 'urn:li:share:123' } })]);
  const urn = await api.createPost({ accessToken: TOKEN, author: 'urn:li:person:abc', commentary: 'Hi', imageUrn: 'urn:li:image:IMG' });

  assert.equal(urn, 'urn:li:share:123');
  assert.equal(calls[0].url, 'https://api.linkedin.com/rest/posts');
  const headers = calls[0].init.headers;
  assert.equal(headers.authorization, `Bearer ${TOKEN}`);
  assert.equal(headers['linkedin-version'], '202610');
  assert.equal(headers['x-restli-protocol-version'], '2.0.0');
  const body = JSON.parse(calls[0].init.body);
  assert.equal(body.author, 'urn:li:person:abc');
  assert.equal(body.visibility, 'PUBLIC');
  assert.equal(body.lifecycleState, 'PUBLISHED');
  assert.equal(body.distribution.feedDistribution, 'MAIN_FEED');
  assert.deepEqual(body.content, { media: { id: 'urn:li:image:IMG' } });
  assert.equal(postUrl(urn), 'https://www.linkedin.com/feed/update/urn:li:share:123/');
});

test('a text-only post has no content block', async () => {
  const { api, calls } = client([new Response(null, { status: 201, headers: { 'x-restli-id': 'urn:li:share:1' } })]);
  await api.createPost({ accessToken: TOKEN, author: 'urn:li:person:abc', commentary: 'Hi' });
  assert.equal(JSON.parse(calls[0].init.body).content, undefined);
});

test('uploadImage initializes for the member, then PUTs the bytes with the token', async () => {
  const { api, calls } = client([
    json(200, { value: { uploadUrl: UPLOAD_URL, image: 'urn:li:image:IMG', uploadUrlExpiresAt: 1 } }),
    new Response(null, { status: 201 }),
  ]);
  const bytes = Buffer.from('png-bytes');
  const urn = await api.uploadImage({ accessToken: TOKEN, owner: 'urn:li:person:abc', bytes });

  assert.equal(urn, 'urn:li:image:IMG');
  assert.equal(calls[0].url, 'https://api.linkedin.com/rest/images?action=initializeUpload');
  assert.deepEqual(JSON.parse(calls[0].init.body), { initializeUploadRequest: { owner: 'urn:li:person:abc' } });
  assert.equal(calls[1].url, UPLOAD_URL);
  assert.equal(calls[1].init.method, 'PUT');
  assert.equal(calls[1].init.headers.authorization, `Bearer ${TOKEN}`);
  assert.equal(calls[1].init.body, bytes);
});

test('client errors are definite, server errors and timeouts are ambiguous', async () => {
  const cases = [
    { response: json(422, { message: 'commentary too long', status: 422 }), ambiguous: false, text: /422.*commentary too long/ },
    { response: json(401, { message: 'Invalid access token', status: 401 }), ambiguous: false, text: /401/ },
    { response: json(503, { message: 'unavailable' }), ambiguous: true, text: /503/ },
    { response: new DOMException('The operation was aborted due to timeout', 'TimeoutError'), ambiguous: true, text: /TimeoutError/ },
    { response: networkError('ECONNRESET'), ambiguous: true, text: /ECONNRESET/ },
    { response: networkError('ENOTFOUND'), ambiguous: false, text: /ENOTFOUND/ },
  ];
  for (const { response, ambiguous, text } of cases) {
    const { api } = client([response]);
    const err = await api.createPost({ accessToken: TOKEN, author: 'urn:li:person:abc', commentary: 'Hi' }).then(() => null, (e) => e);
    assert.ok(err, 'expected a failure');
    assert.equal(err.ambiguous, ambiguous, `${err.message}`);
    assert.match(err.message, text);
    assert.ok(!err.message.includes(TOKEN), 'the token never appears in errors');
  }
});

test('a failed image upload does not reveal the signed upload address', async () => {
  const { api } = client([
    json(200, { value: { uploadUrl: UPLOAD_URL, image: 'urn:li:image:IMG' } }),
    json(400, { message: 'bad image' }),
  ]);
  const err = await api.uploadImage({ accessToken: TOKEN, owner: 'urn:li:person:abc', bytes: Buffer.from('x') }).then(() => null, (e) => e);
  assert.match(err.message, /Uploading the image failed \(400\): bad image/);
  assert.ok(!err.message.includes('SIGNATURE') && !err.message.includes(TOKEN));
});
