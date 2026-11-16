const test = require('node:test');
const assert = require('node:assert/strict');
const { createLocalLlmProvider } = require('../src/generation/localLlmProvider');
const { DRAFT_SCHEMA } = require('../src/generation/draftSchema');

const MODEL = '/data/data/com.termux/files/home/models/Qwen3-1.7B-Q4_K_M.gguf';
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

// llama-server's streamed reply: one "data:" event per piece, timings on the last one, then [DONE].
function sseText(pieces, { finishReason = 'stop', extraEvents = [] } = {}) {
  const events = [
    ...pieces.map((content) => ({ model: MODEL, choices: [{ delta: { content }, finish_reason: null }] })),
    ...extraEvents,
    { model: MODEL, choices: [{ delta: {}, finish_reason: finishReason }], timings: { prompt_n: 1700, predicted_n: 1100, predicted_per_second: 5.5 } },
  ];
  return `${events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join('')}data: [DONE]\n\n`;
}

// Delivers the text in small chunks that cut through lines, as the network may.
function streamResponse(text, chunkSize = 7) {
  const bytes = new TextEncoder().encode(text);
  const body = new ReadableStream({
    start(controller) {
      for (let i = 0; i < bytes.length; i += chunkSize) controller.enqueue(bytes.slice(i, i + chunkSize));
      controller.close();
    },
  });
  return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
}

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

const ask = (provider) => provider.generateDraft({ systemPrompt: 'SYSTEM', userPrompt: 'USER' });

test('streams the draft with the schema and thinking off, and joins the pieces across chunk boundaries', async () => {
  const fetchFn = fakeFetch(streamResponse(sseText(['{"hook":"h', 'é","te', 'xt":"t"}'])));
  const progress = [];
  const provider = createLocalLlmProvider({ url: 'http://127.0.0.1:8081/', fetchFn, onProgress: (p) => progress.push(p.pieces) });

  const draft = await ask(provider);

  assert.deepEqual(draft, { hook: 'hé', text: 't' });
  assert.deepEqual(progress, [1, 2, 3]);
  assert.equal(fetchFn.calls[0].url, 'http://127.0.0.1:8081/v1/chat/completions');
  const body = JSON.parse(fetchFn.calls[0].init.body);
  assert.deepEqual(body.messages, [{ role: 'system', content: 'SYSTEM' }, { role: 'user', content: 'USER' }]);
  assert.equal(body.stream, true);
  assert.deepEqual(body.response_format.json_schema.schema, DRAFT_SCHEMA);
  assert.equal(body.chat_template_kwargs.enable_thinking, false);
  assert.equal(provider.name, 'local:Qwen3-1.7B-Q4_K_M.gguf');
  assert.equal(provider.lastTimings.predicted_n, 1100);
});

test('a reply cut off at the token limit says so instead of failing on broken JSON', async () => {
  const fetchFn = fakeFetch(streamResponse(sseText(['{"hook":"h","te'], { finishReason: 'length' })));
  const provider = createLocalLlmProvider({ url: 'http://127.0.0.1:8081', maxTokens: 50, fetchFn });
  await assert.rejects(ask(provider), /50-token limit/);
});

test('an error event in the middle of the stream is reported', async () => {
  const fetchFn = fakeFetch(streamResponse(sseText(['{"hook"'], { extraEvents: [{ error: { message: 'out of memory' } }] })));
  const provider = createLocalLlmProvider({ url: 'http://127.0.0.1:8081', fetchFn });
  await assert.rejects(ask(provider), /failed while writing: out of memory/);
});

test('a refused request passes on llama-server\'s own message', async () => {
  const fetchFn = fakeFetch(json(400, { error: { code: 400, message: 'the request exceeds the available context size' } }));
  const provider = createLocalLlmProvider({ url: 'http://127.0.0.1:8081', fetchFn });
  await assert.rejects(ask(provider), /400: the request exceeds the available context size/);
});

test('an unreachable server asks whether llama-server is running', async () => {
  const fetchFn = fakeFetch(new TypeError('fetch failed', { cause: { code: 'ECONNREFUSED' } }));
  const provider = createLocalLlmProvider({ url: 'http://127.0.0.1:8081', fetchFn });
  await assert.rejects(ask(provider), /ECONNREFUSED\)\. Is llama-server running\?/);
});
