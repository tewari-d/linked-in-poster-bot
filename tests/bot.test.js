const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { createBot } = require('../src/bot/bot');
const msg = require('../src/bot/messages');
const { loadTopicBank } = require('../src/topics/rotation');
const { loadPrompts } = require('../src/generation/prompts');
const { createMockProvider } = require('../src/generation/mockProvider');
const { createDraft } = require('../src/jobs/createDraft');
const { createLinkedInAuth } = require('../src/linkedin/auth');
const { UncertainPublishError } = require('../src/publish/linkedinPublisher');

const ROOT = path.join(__dirname, '..');
const OWNER = 111;
const STRANGER = 999;
const bank = loadTopicBank({ filePath: path.join(ROOT, 'data', 'topics.json') });
const prompts = loadPrompts({ dir: path.join(ROOT, 'prompts') });

function memoryStore() {
  let state = { drafts: [] };
  return { load: () => structuredClone(state), save: (s) => { state = structuredClone(s); } };
}

function fakeApi() {
  const calls = [];
  let nextMessageId = 1;
  const record = (method, result) => async (params) => {
    calls.push({ method, params });
    return typeof result === 'function' ? result() : result;
  };
  return {
    calls,
    sent: () => calls.filter((c) => c.method === 'sendMessage').map((c) => c.params),
    sendMessage: record('sendMessage', () => ({ message_id: nextMessageId++ })),
    answerCallbackQuery: record('answerCallbackQuery', true),
    editMessageReplyMarkup: record('editMessageReplyMarkup', true),
    deleteMessage: record('deleteMessage', true),
  };
}

function fakeLinkedInApi() {
  return {
    authorizationUrl: ({ state }) => `https://www.linkedin.com/oauth/v2/authorization?state=${state}`,
    exchangeCode: async ({ code }) => ({ access_token: `token-for-${code}`, expires_in: 60 * 86400, scope: 'openid,profile,w_member_social' }),
    getUserInfo: async () => ({ sub: 'abc123', name: 'Test Owner' }),
  };
}

function setup({ publishImpl, failGeneration = false, now = '2026-11-05T04:00:00Z', withLinkedIn = false, dryRun = true } = {}) {
  const api = fakeApi();
  const store = memoryStore();
  const generateCalls = [];
  const published = [];
  const makeDraft = async (args) => {
    generateCalls.push(args);
    if (failGeneration) throw new Error('quota reached');
    return createDraft({ ...args, epochDate: '2026-11-01', bank, prompts, provider: createMockProvider(), store });
  };
  const publisher = {
    publish: publishImpl ?? (async ({ draft }) => {
      published.push(draft.id);
      return { dryRun: true, url: null, imageBytes: 2048 };
    }),
  };
  const config = { telegram: { ownerChatId: String(OWNER) }, timezone: 'Asia/Kolkata', sendTime: '09:00', catchupCutoff: '12:00', dryRun };
  const clock = () => new Date(now);
  const linkedin = withLinkedIn ? createLinkedInAuth({ linkedinApi: fakeLinkedInApi(), store, clock }) : null;
  // 04:00 UTC is 09:30 in India.
  const bot = createBot({ api, store, makeDraft, publisher, linkedin, config, log: () => {}, clock });
  return { api, store, bot, published, generateCalls };
}

const chat = (id) => ({ chat: { id, type: 'private' }, from: { id } });
const text = (value, from = OWNER) => ({ message: { ...chat(from), text: value } });
const tap = (data, from = OWNER, messageId = 500) => ({ callback_query: { id: 'cb', from: { id: from }, data, message: { message_id: messageId } } });
const file = (mimeType, from = OWNER) => ({ message: { ...chat(from), document: { file_id: 'F1', mime_type: mimeType, file_name: 'img', file_size: 2048 } } });
const latest = (store) => store.load().drafts.at(-1);
const lastText = (api) => api.sent().at(-1).text;

test('/draft sends the post and a control message with Post, Skip and Regenerate', async () => {
  const { api, store, bot } = setup();
  await bot.handleUpdate(text('/draft'));

  const draft = latest(store);
  assert.equal(draft.status, 'SENT');
  assert.equal(draft.date, '2026-11-05');
  const buttons = api.sent().at(-1).reply_markup.inline_keyboard[0].map((b) => b.callback_data);
  assert.deepEqual(buttons, [`post:${draft.id}`, `skip:${draft.id}`, `regen:${draft.id}`]);
  for (const data of buttons) assert.ok(Buffer.byteLength(data) <= 64, 'Telegram callback_data limit');
  assert.ok(draft.telegram.controlMessageId);
});

test('a second /draft does not create another draft while one is waiting', async () => {
  const { api, store, bot, generateCalls } = setup();
  await bot.handleUpdate(text('/draft'));
  await bot.handleUpdate(text('/draft'));
  assert.equal(store.load().drafts.length, 1);
  assert.equal(generateCalls.length, 1);
  assert.match(lastText(api), /already waiting/);
});

test('messages and taps from anyone but the owner are ignored', async () => {
  const { api, store, bot } = setup();
  await bot.handleUpdate(text('/draft', STRANGER));
  await bot.handleUpdate(tap('post:x', STRANGER));
  assert.equal(api.sent().length, 0);
  assert.equal(store.load().drafts.length, 0);
  assert.ok(api.calls.some((c) => c.method === 'answerCallbackQuery'), 'tap still answered so the spinner stops');
});

test('Post without an image asks first, then posts text only, exactly once', async () => {
  const { api, store, bot, published } = setup();
  await bot.handleUpdate(text('/draft'));
  const { id } = latest(store);

  await bot.handleUpdate(tap(`post:${id}`));
  assert.equal(latest(store).status, 'SENT');
  assert.match(lastText(api), /No image attached/);

  await bot.handleUpdate(tap(`posttext:${id}`));
  assert.equal(latest(store).status, 'POSTED');
  assert.equal(latest(store).dryRun, true);

  await bot.handleUpdate(tap(`post:${id}`));
  assert.deepEqual(published, [id]);
  assert.match(lastText(api), /posted, so there is nothing to post/);
});

test('an image attaches to the waiting draft and Post publishes it', async () => {
  const { api, store, bot, published } = setup();
  await bot.handleUpdate(text('/draft'));
  await bot.handleUpdate(file('image/png'));

  const draft = latest(store);
  assert.equal(draft.image.fileId, 'F1');
  assert.equal(draft.image.kind, 'document');
  assert.ok(api.sent().at(-1).reply_markup, 'fresh Post/Skip buttons after the image');

  await bot.handleUpdate(tap(`post:${draft.id}`));
  assert.equal(latest(store).status, 'POSTED');
  assert.deepEqual(published, [draft.id]);
  assert.match(lastText(api), /Dry run/);
});

test('images are refused when nothing is waiting or the file is not JPG/PNG', async () => {
  const { api, bot } = setup();
  await bot.handleUpdate(file('image/png'));
  assert.match(lastText(api), /No draft is waiting/);

  await bot.handleUpdate(text('/draft'));
  await bot.handleUpdate(file('application/pdf'));
  assert.match(lastText(api), /JPG or PNG/);
});

test('Skip marks the draft skipped and its stale buttons do nothing', async () => {
  const { api, store, bot, generateCalls } = setup();
  await bot.handleUpdate(text('/draft'));
  const { id } = latest(store);

  await bot.handleUpdate(tap(`skip:${id}`));
  assert.equal(latest(store).status, 'SKIPPED');

  await bot.handleUpdate(tap(`regen:${id}`));
  assert.equal(generateCalls.length, 1);
  assert.match(lastText(api), /skipped, so there is nothing to regenerate/);
});

test('Regenerate expires the old draft and asks for a new angle on the same topic', async () => {
  const { store, bot, generateCalls } = setup();
  await bot.handleUpdate(text('/draft'));
  const old = latest(store);

  await bot.handleUpdate(tap(`regen:${old.id}`));
  const drafts = store.load().drafts;
  assert.equal(drafts.length, 2);
  assert.equal(drafts[0].status, 'EXPIRED');
  assert.equal(drafts[1].status, 'SENT');
  assert.equal(drafts[1].subtopic, old.subtopic);
  assert.ok(generateCalls[1].extra.includes(old.hook));
});

test('a failed publish puts the draft back to waiting with fresh buttons', async () => {
  const { api, store, bot } = setup({ publishImpl: async () => { throw new Error('LinkedIn down'); } });
  await bot.handleUpdate(text('/draft'));
  await bot.handleUpdate(tap(`posttext:${latest(store).id}`));

  assert.equal(latest(store).status, 'SENT');
  assert.equal(latest(store).error, 'LinkedIn down');
  assert.match(lastText(api), /Posting failed/);
  assert.ok(api.sent().at(-1).reply_markup);
});

test('a failed generation offers Try again and makes no further calls on its own', async () => {
  const { api, bot, generateCalls } = setup({ failGeneration: true });
  await bot.handleUpdate(text('/draft'));
  assert.equal(generateCalls.length, 1);
  assert.match(lastText(api), /Could not create the draft/);
  assert.equal(api.sent().at(-1).reply_markup.inline_keyboard[0][0].callback_data, 'draft:2026-11-05');
});

test('the daily timer sends one draft per day', async () => {
  const { store, bot } = setup();
  assert.equal(await bot.runDailyIfDue(), true);
  assert.equal(latest(store).status, 'SENT');
  assert.equal(store.load().lastAutoRunDate, '2026-11-05');
  assert.equal(await bot.runDailyIfDue(), false);
});

const buttonsOf = (params) => params.reply_markup.inline_keyboard.flat();
const uncertainPublish = async () => { throw new UncertainPublishError('Creating the LinkedIn post: no answer from LinkedIn (TimeoutError)'); };

test('an uncertain publish blocks Post until the owner confirms it is on LinkedIn', async () => {
  const { api, store, bot } = setup({ publishImpl: uncertainPublish });
  await bot.handleUpdate(text('/draft'));
  const { id } = latest(store);

  await bot.handleUpdate(tap(`posttext:${id}`));
  assert.equal(latest(store).status, 'UNKNOWN');
  assert.match(lastText(api), /Not sure the post went out/);
  assert.deepEqual(buttonsOf(api.sent().at(-1)).map((b) => b.callback_data), [`seen:${id}`, `notposted:${id}`]);

  await bot.handleUpdate(tap(`post:${id}`));
  assert.equal(latest(store).status, 'UNKNOWN', 'an old Post button must not publish a maybe-posted draft');

  await bot.handleUpdate(tap(`seen:${id}`));
  assert.equal(latest(store).status, 'POSTED');
  assert.equal(latest(store).dryRun, false);
});

test('"Not there" puts an uncertain draft back to waiting, and Post then works', async () => {
  let attempts = 0;
  const { store, bot } = setup({
    publishImpl: async () => {
      attempts += 1;
      if (attempts === 1) return uncertainPublish();
      return { dryRun: false, url: 'https://www.linkedin.com/feed/update/urn:li:share:1/' };
    },
  });
  await bot.handleUpdate(text('/draft'));
  const { id } = latest(store);
  await bot.handleUpdate(tap(`posttext:${id}`));

  await bot.handleUpdate(tap(`notposted:${id}`));
  assert.equal(latest(store).status, 'SENT');

  await bot.handleUpdate(tap(`posttext:${id}`));
  assert.equal(latest(store).status, 'POSTED');
  assert.equal(latest(store).linkedinUrl, 'https://www.linkedin.com/feed/update/urn:li:share:1/');
  assert.equal(attempts, 2);
});

test('a draft left in POSTING by a crash is reported as uncertain at startup', async () => {
  const { api, store, bot } = setup();
  await bot.handleUpdate(text('/draft'));
  const state = store.load();
  state.drafts.at(-1).status = 'POSTING';
  store.save(state);

  await bot.recoverInterrupted();
  assert.equal(latest(store).status, 'UNKNOWN');
  assert.match(lastText(api), /stopped while the draft/);
  assert.ok(api.sent().at(-1).reply_markup);
});

test('/linkedin sends a connect link; the pasted redirect address connects and is deleted', async () => {
  const { api, store, bot } = setup({ withLinkedIn: true });
  await bot.handleUpdate(text('/linkedin'));
  const link = buttonsOf(api.sent().at(-1))[0].url;
  const state = new URL(link).searchParams.get('state');
  assert.equal(state, store.load().linkedinAuthState);

  const pasted = { message: { ...chat(OWNER), message_id: 77, text: `http://localhost:8765/auth/linkedin/callback?code=C1&state=${state}` } };
  await bot.handleUpdate(pasted);

  const saved = store.load();
  assert.equal(saved.linkedin.accessToken, 'token-for-C1');
  assert.equal(saved.linkedin.memberUrn, 'urn:li:person:abc123');
  assert.equal(saved.linkedinAuthState, undefined, 'the state is single-use');
  assert.match(lastText(api), /LinkedIn connected as Test Owner/);
  assert.ok(api.calls.some((c) => c.method === 'deleteMessage' && c.params.message_id === 77));
  assert.ok(!api.sent().some((m) => m.text.includes('token-for-C1')), 'the token never goes to Telegram');
});

test('a redirect whose state this bot did not issue is refused', async () => {
  const { store, bot } = setup({ withLinkedIn: true });
  await bot.handleUpdate(text('/linkedin'));
  const result = await bot.onLinkedInRedirect({ code: 'C1', state: 'forged' });
  assert.equal(result.ok, false);
  assert.equal(store.load().linkedin, undefined);
});

test('/linkedin and /status explain when LinkedIn is not set up or not connected', async () => {
  const unset = setup();
  await unset.bot.handleUpdate(text('/linkedin'));
  assert.match(lastText(unset.api), /not set up/);

  const { api, bot } = setup({ withLinkedIn: true });
  await bot.handleUpdate(text('/status'));
  assert.match(lastText(api), /LinkedIn: not connected/);
});

test('the daily run reminds about LinkedIn access in its last 7 days only', async () => {
  const withDaysLeft = async (days) => {
    const ctx = setup({ withLinkedIn: true });
    const state = ctx.store.load();
    state.linkedin = { accessToken: 't', memberUrn: 'urn:li:person:x', name: 'X', expiresAt: new Date(Date.parse('2026-11-05T04:00:00Z') + days * 86400000 + 3600000).toISOString() };
    ctx.store.save(state);
    await ctx.bot.runDailyIfDue();
    return ctx.api.sent().at(-1);
  };
  const soon = await withDaysLeft(3);
  assert.match(soon.text, /runs out in 3 days/);
  assert.ok(buttonsOf(soon)[0].url);

  const later = await withDaysLeft(30);
  assert.doesNotMatch(later.text, /runs out/);
});

test('no LinkedIn reminder in dry run before LinkedIn was ever connected', async () => {
  const { api, bot } = setup({ withLinkedIn: true });
  await bot.runDailyIfDue();
  assert.ok(!api.sent().some((m) => /LinkedIn/.test(m.text)));
});

test('the image idea is the model\'s prompt as written, with no name or signature added (owner request)', async () => {
  const { api, store, bot } = setup({ withLinkedIn: true });
  const state = store.load();
  state.linkedin = { accessToken: 't', memberUrn: 'urn:li:person:x', name: 'Test Owner', expiresAt: '2027-01-03T00:00:00.000Z' };
  store.save(state);

  await bot.handleUpdate(text('/draft'));
  const imageMessage = api.sent().at(-1).text;
  assert.match(imageMessage, /portrait 4:5/);
  assert.ok(imageMessage.includes(msg.escapeHtml(latest(store).imagePrompt)));
  assert.doesNotMatch(imageMessage, /Test Owner|signature/);
});

test('the Telegram preview shows the AI disclaimer between the text and the hashtags, as on LinkedIn', () => {
  const draft = { date: '2026-11-05', category: 'CAP', subtopic: 'CDS', format: 'tip', text: 'Post body', hashtags: ['#SAP', '#CAP'] };
  const html = msg.postMessage({ draft, disclaimer: '🤖 AI Generated Content, curated by a human.' });
  assert.match(html, /Post body\n\n🤖 AI Generated Content, curated by a human\.\n\n#SAP #CAP$/);
  assert.doesNotMatch(msg.postMessage({ draft }), /AI Generated/);
});

test('draft text is HTML-escaped for Telegram', () => {
  const html = msg.postMessage({ draft: { date: '2026-11-05', category: 'A&B', subtopic: '<x>', format: 'tip', text: 'if a < b && c > d', hashtags: ['#SAP'] } });
  assert.match(html, /A&amp;B · &lt;x&gt;/);
  assert.match(html, /if a &lt; b &amp;&amp; c &gt; d/);
});
