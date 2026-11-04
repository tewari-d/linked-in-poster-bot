const test = require('node:test');
const assert = require('node:assert/strict');
const { createTelegramApi, privateChatsFrom, TelegramError } = require('../src/messaging/telegramApi');

const fakeFetch = (body, status = 200) => async () => ({ status, statusText: 'x', json: async () => body });

test('call returns result on ok', async () => {
  const api = createTelegramApi({ token: 'T', fetchFn: fakeFetch({ ok: true, result: { username: 'b' } }) });
  assert.deepEqual(await api.getMe(), { username: 'b' });
});

test('API errors become TelegramError without leaking the token', async () => {
  const api = createTelegramApi({ token: 'SECRET123', fetchFn: fakeFetch({ ok: false, error_code: 401, description: 'Unauthorized' }, 401) });
  await assert.rejects(api.getMe(), (err) => err instanceof TelegramError && err.code === 401 && !err.message.includes('SECRET123'));
});

test('network errors do not leak the token', async () => {
  const api = createTelegramApi({ token: 'SECRET123', fetchFn: async () => { throw new TypeError('fetch failed'); } });
  await assert.rejects(api.getMe(), (err) => !err.message.includes('SECRET123'));
});

test('sendDocument uploads the bytes as a named file, with other fields as form fields', async () => {
  let seen;
  const api = createTelegramApi({
    token: 'T',
    fetchFn: async (url, init) => {
      seen = { url, init };
      return { status: 200, json: async () => ({ ok: true, result: { message_id: 9, document: { file_id: 'F' } } }) };
    },
  });
  const result = await api.sendDocument({
    chat_id: '111',
    caption: 'Image',
    reply_markup: { inline_keyboard: [] },
    document: { bytes: Buffer.from('png-bytes'), fileName: 'd.png', mimeType: 'image/png' },
  });
  assert.equal(result.document.file_id, 'F');
  assert.match(seen.url, /\/sendDocument$/);
  const form = seen.init.body;
  assert.equal(form.get('chat_id'), '111');
  assert.equal(form.get('reply_markup'), '{"inline_keyboard":[]}');
  const file = form.get('document');
  assert.equal(file.name, 'd.png');
  assert.equal(file.type, 'image/png');
  assert.equal(Buffer.from(await file.arrayBuffer()).toString(), 'png-bytes');
});

test('a failed upload does not leak the token either', async () => {
  const api = createTelegramApi({ token: 'SECRET123', fetchFn: fakeFetch({ ok: false, error_code: 413, description: 'Request Entity Too Large' }, 413) });
  const document = { bytes: Buffer.alloc(1), fileName: 'd.png', mimeType: 'image/png' };
  await assert.rejects(api.sendDocument({ chat_id: '1', document }), (err) => err.code === 413 && !err.message.includes('SECRET123'));
});

test('privateChatsFrom keeps private chats only, latest message per chat', () => {
  const chats = privateChatsFrom([
    { message: { chat: { id: 1, type: 'private', first_name: 'A' }, text: '/start' } },
    { message: { chat: { id: -5, type: 'group' }, text: 'hi' } },
    { message: { chat: { id: 1, type: 'private', first_name: 'A' }, text: 'hello' } },
    { callback_query: {} },
  ]);
  assert.deepEqual(chats, [{ id: 1, name: 'A', username: undefined, lastText: 'hello' }]);
});
