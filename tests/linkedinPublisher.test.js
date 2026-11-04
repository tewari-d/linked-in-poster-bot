const test = require('node:test');
const assert = require('node:assert/strict');
const { createLinkedInPublisher } = require('../src/publish/linkedinPublisher');
const { LinkedInError } = require('../src/linkedin/linkedinApi');

const draft = (extra = {}) => ({ id: 'd1', text: 'Hook (short)\n\nBody.', hashtags: ['#SAP', '#ABAP'], ...extra });

function setup({ createPost, uploadImage, connected = true } = {}) {
  const calls = [];
  const linkedinApi = {
    uploadImage: uploadImage ?? (async (args) => { calls.push(['upload', args]); return 'urn:li:image:IMG'; }),
    createPost: createPost ?? (async (args) => { calls.push(['post', args]); return 'urn:li:share:9'; }),
  };
  const telegramApi = { downloadFile: async (fileId) => { calls.push(['download', fileId]); return Buffer.from('jpeg-bytes'); } };
  const auth = {
    requireToken: () => {
      if (!connected) throw new Error('LinkedIn is not connected yet. Send /linkedin to connect, then tap Post again.');
      return { accessToken: 'T1', memberUrn: 'urn:li:person:abc' };
    },
  };
  return { publisher: createLinkedInPublisher({ linkedinApi, telegramApi, auth }), calls };
}

test('an image draft is downloaded, uploaded for the member and posted with escaped text', async () => {
  const { publisher, calls } = setup();
  const result = await publisher.publish({ draft: draft({ image: { fileId: 'F1' } }) });

  assert.deepEqual(calls.map((c) => c[0]), ['download', 'upload', 'post']);
  assert.equal(calls[1][1].owner, 'urn:li:person:abc');
  const post = calls[2][1];
  assert.equal(post.author, 'urn:li:person:abc');
  assert.equal(post.imageUrn, 'urn:li:image:IMG');
  assert.equal(post.commentary, 'Hook \\(short\\)\n\nBody.\n\n{hashtag|\\#|SAP} {hashtag|\\#|ABAP}');
  assert.deepEqual(result, { dryRun: false, postUrn: 'urn:li:share:9', url: 'https://www.linkedin.com/feed/update/urn:li:share:9/', imageBytes: 10 });
});

test('the configured AI disclaimer goes into the LinkedIn post before the hashtags', async () => {
  const calls = [];
  const publisher = createLinkedInPublisher({
    linkedinApi: { createPost: async (args) => { calls.push(args); return 'urn:li:share:1'; } },
    telegramApi: {},
    auth: { requireToken: () => ({ accessToken: 'T1', memberUrn: 'urn:li:person:abc' }) },
    disclaimer: '🤖 AI Generated Content, curated by a human.',
  });
  await publisher.publish({ draft: draft() });
  assert.match(calls[0].commentary, /Body\.\n\n🤖 AI Generated Content, curated by a human\.\n\n\{hashtag/);
});

test('a text-only draft skips the image steps', async () => {
  const { publisher, calls } = setup();
  await publisher.publish({ draft: draft() });
  assert.deepEqual(calls.map((c) => c[0]), ['post']);
  assert.equal(calls[0][1].imageUrn, null);
});

test('an ambiguous create-post failure is reported as uncertain', async () => {
  const { publisher } = setup({ createPost: async () => { throw new LinkedInError('Creating the LinkedIn post: no answer from LinkedIn (TimeoutError)', { ambiguous: true }); } });
  const err = await publisher.publish({ draft: draft() }).then(() => null, (e) => e);
  assert.equal(err.uncertain, true);
});

test('a server error during the image upload is a clean failure: nothing was posted yet', async () => {
  const { publisher } = setup({ uploadImage: async () => { throw new LinkedInError('Uploading the image failed (503): busy', { status: 503, ambiguous: true }); } });
  const err = await publisher.publish({ draft: draft({ image: { fileId: 'F1' } }) }).then(() => null, (e) => e);
  assert.notEqual(err.uncertain, true);
  assert.match(err.message, /503/);
});

test('a rejected token points the owner to /linkedin', async () => {
  const { publisher } = setup({ createPost: async () => { throw new LinkedInError('Creating the LinkedIn post failed (401): Invalid access token', { status: 401 }); } });
  await assert.rejects(publisher.publish({ draft: draft() }), (err) => /send \/linkedin to reconnect/.test(err.message) && !err.uncertain);
});

test('nothing is called when LinkedIn is not connected or the post is too long', async () => {
  const notConnected = setup({ connected: false });
  await assert.rejects(notConnected.publisher.publish({ draft: draft({ image: { fileId: 'F1' } }) }), /not connected/);
  assert.equal(notConnected.calls.length, 0);

  const tooLong = setup();
  await assert.rejects(tooLong.publisher.publish({ draft: draft({ text: '(x) '.repeat(800) }) }), /max 3000/);
  assert.equal(tooLong.calls.length, 0);
});
