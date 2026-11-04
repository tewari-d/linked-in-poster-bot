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

test('privateChatsFrom keeps private chats only, latest message per chat', () => {
  const chats = privateChatsFrom([
    { message: { chat: { id: 1, type: 'private', first_name: 'A' }, text: '/start' } },
    { message: { chat: { id: -5, type: 'group' }, text: 'hi' } },
    { message: { chat: { id: 1, type: 'private', first_name: 'A' }, text: 'hello' } },
    { callback_query: {} },
  ]);
  assert.deepEqual(chats, [{ id: 1, name: 'A', username: undefined, lastText: 'hello' }]);
});
