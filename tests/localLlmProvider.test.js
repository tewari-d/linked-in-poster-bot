const test = require('node:test');
const assert = require('node:assert/strict');
const { createLocalLlmProvider } = require('../src/generation/localLlmProvider');
const { DRAFT_SCHEMA } = require('../src/generation/draftSchema');

const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function fakeFetch(response) {
  const calls = [];
  const fn = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    if (response instanceof Error) throw response;
    return response;
  };
  fn.calls = calls;
  return fn;
}

const reply = (content, extra = {}) => json(200, {
  model: '/data/data/com.termux/files/home/models/Qwen3-1.7B-Q4_K_M.gguf',
  choices: [{ message: { content }, finish_reason: 'stop' }],
  timings: { prompt_n: 1700, predicted_n: 1100, predicted_per_second: 5.5 },
  ...extra,
});

test('sends both prompts with the draft schema and thinking off, and returns the parsed draft', async () => {
  const fetchFn = fakeFetch(reply('{"hook":"h","text":"t"}'));
  const provider = createLocalLlmProvider({ url: 'http://127.0.0.1:8081/', fetchFn });

  const draft = await provider.generateDraft({ systemPrompt: 'SYSTEM', userPrompt: 'USER' });

  assert.deepEqual(draft, { hook: 'h', text: 't' });
  assert.equal(fetchFn.calls[0].url, 'http://127.0.0.1:8081/v1/chat/completions');
  const body = JSON.parse(fetchFn.calls[0].init.body);
  assert.deepEqual(body.messages, [{ role: 'system', content: 'SYSTEM' }, { role: 'user', content: 'USER' }]);
  assert.deepEqual(body.response_format.json_schema.schema, DRAFT_SCHEMA);
  assert.equal(body.chat_template_kwargs.enable_thinking, false);
  assert.equal(provider.name, 'local:Qwen3-1.7B-Q4_K_M.gguf');
  assert.equal(provider.lastTimings.predicted_n, 1100);
});

test('a reply cut off at the token limit says so instead of failing on broken JSON', async () => {
  const fetchFn = fakeFetch(json(200, { choices: [{ message: { content: '{"hook":"h","te' }, finish_reason: 'length' }] }));
  const provider = createLocalLlmProvider({ url: 'http://127.0.0.1:8081', maxTokens: 50, fetchFn });
  await assert.rejects(provider.generateDraft({ systemPrompt: 's', userPrompt: 'u' }), /50-token limit/);
});

test('a server error passes on llama-server\'s own message', async () => {
  const fetchFn = fakeFetch(json(400, { error: { code: 400, message: 'the request exceeds the available context size' } }));
  const provider = createLocalLlmProvider({ url: 'http://127.0.0.1:8081', fetchFn });
  await assert.rejects(provider.generateDraft({ systemPrompt: 's', userPrompt: 'u' }), /400: the request exceeds the available context size/);
});

test('an unreachable server asks whether llama-server is running', async () => {
  const fetchFn = fakeFetch(new TypeError('fetch failed', { cause: { code: 'ECONNREFUSED' } }));
  const provider = createLocalLlmProvider({ url: 'http://127.0.0.1:8081', fetchFn });
  await assert.rejects(provider.generateDraft({ systemPrompt: 's', userPrompt: 'u' }), /ECONNREFUSED\)\. Is llama-server running\?/);
});
