// Drafts with a model running on the phone itself (llama.cpp's llama-server, OpenAI-style API) instead of Gemini.
// llama-server turns the JSON schema into a grammar, so the reply always has the draft's shape. Unlike Gemini,
// the model never sees the schema's descriptions; the system prompt's "Output fields" section explains each field.
const path = require('node:path');
const { DRAFT_SCHEMA } = require('./draftSchema');

// A 1.7B model on the M30 writes about 5 tokens a second and a draft is about 1,100 tokens after a
// 1,700-token prompt: several minutes, far beyond fetch's usual patience.
const DEFAULT_TIMEOUT_MS = 30 * 60 * 1000;

function createLocalLlmProvider({ url, maxTokens = 2000, timeoutMs = DEFAULT_TIMEOUT_MS, fetchFn = fetch }) {
  if (!url) throw new Error('No local model address. Set LOCAL_LLM_URL, e.g. http://127.0.0.1:8081');
  const base = url.replace(/\/+$/, '');
  const provider = { name: 'local', lastTimings: null, generateDraft };

  async function generateDraft({ systemPrompt, userPrompt }) {
    let res;
    try {
      res = await fetchFn(`${base}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt }],
          max_tokens: maxTokens,
          temperature: 0.7,
          // Qwen3 otherwise "thinks" before answering, which costs minutes and context on a phone.
          chat_template_kwargs: { enable_thinking: false },
          response_format: { type: 'json_schema', json_schema: { name: 'draft', schema: DRAFT_SCHEMA } },
        }),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      throw new Error(`Could not reach the local model at ${base} (${err.cause?.code ?? err.name}). Is llama-server running?`, { cause: err });
    }

    const body = await res.json().catch(() => null);
    if (!res.ok) throw new Error(`The local model answered ${res.status}: ${body?.error?.message ?? 'no details'}`);
    provider.lastTimings = body?.timings ?? null;
    if (body?.model) provider.name = `local:${path.basename(String(body.model))}`;

    const choice = body?.choices?.[0];
    const text = choice?.message?.content;
    if (!text) throw new Error('The local model returned no text');
    // A cut-off reply is invalid JSON anyway; saying why points at the real fix (more tokens or context).
    if (choice.finish_reason === 'length') throw new Error(`The local model hit the ${maxTokens}-token limit before finishing the draft`);
    try {
      return JSON.parse(text);
    } catch (err) {
      throw new Error(`The local model returned text that is not valid JSON: ${text.slice(0, 200)}`, { cause: err });
    }
  }

  return provider;
}

module.exports = { createLocalLlmProvider };
