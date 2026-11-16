// Drafts with a model running on the phone itself (llama.cpp's llama-server, OpenAI-style API) instead of Gemini.
// llama-server turns the JSON schema into a grammar, so the reply always has the draft's shape. Unlike Gemini,
// the model never sees the schema's descriptions; the system prompt's "Output fields" section explains each field.
const path = require('node:path');
const { DRAFT_SCHEMA } = require('./draftSchema');

// A 1.7B model on the M30 writes about 5 tokens a second and a draft is about 1,100 tokens after a
// 1,700-token prompt: more than 5 minutes, so this is only a last-resort cap.
const DEFAULT_TIMEOUT_MS = 30 * 60 * 1000;

// Reads llama-server's stream ("data: {...}" lines) and joins the pieces of the reply.
async function readStream({ body, onProgress }) {
  const decoder = new TextDecoder();
  const result = { text: '', pieces: 0, finishReason: null, timings: null, model: null };
  const handle = (line) => {
    if (!line.startsWith('data:')) return;
    const data = line.slice(5).trim();
    if (!data || data === '[DONE]') return;
    const event = JSON.parse(data);
    if (event.error) throw new Error(`The local model failed while writing: ${event.error.message ?? 'no details'}`);
    result.model ??= event.model ?? null;
    const choice = event.choices?.[0];
    if (choice?.delta?.content) {
      result.text += choice.delta.content;
      result.pieces += 1;
      onProgress?.({ pieces: result.pieces });
    }
    if (choice?.finish_reason) result.finishReason = choice.finish_reason;
    if (event.timings) result.timings = event.timings;
  };

  let buffer = '';
  for await (const chunk of body) {
    buffer += decoder.decode(chunk, { stream: true });
    let end;
    while ((end = buffer.indexOf('\n')) >= 0) {
      handle(buffer.slice(0, end).trim());
      buffer = buffer.slice(end + 1);
    }
  }
  handle((buffer + decoder.decode()).trim());
  return result;
}

function createLocalLlmProvider({ url, maxTokens = 2000, timeoutMs = DEFAULT_TIMEOUT_MS, onProgress, fetchFn = fetch }) {
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
          // Streamed: Node's fetch gives up when no response headers arrive within 5 minutes, and
          // llama-server sends none until a non-streamed reply is complete.
          stream: true,
          // Qwen3 otherwise "thinks" before answering, which costs minutes and context on a phone.
          chat_template_kwargs: { enable_thinking: false },
          response_format: { type: 'json_schema', json_schema: { name: 'draft', schema: DRAFT_SCHEMA } },
        }),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      throw new Error(`Could not reach the local model at ${base} (${err.cause?.code ?? err.name}). Is llama-server running?`, { cause: err });
    }

    if (!res.ok) {
      const body = await res.json().catch(() => null);
      throw new Error(`The local model answered ${res.status}: ${body?.error?.message ?? 'no details'}`);
    }
    const reply = await readStream({ body: res.body, onProgress });
    provider.lastTimings = reply.timings;
    if (reply.model) provider.name = `local:${path.basename(String(reply.model))}`;

    if (!reply.text) throw new Error('The local model returned no text');
    // A cut-off reply is invalid JSON anyway; saying why points at the real fix (more tokens or context).
    if (reply.finishReason === 'length') throw new Error(`The local model hit the ${maxTokens}-token limit before finishing the draft`);
    try {
      return JSON.parse(reply.text);
    } catch (err) {
      throw new Error(`The local model returned text that is not valid JSON: ${reply.text.slice(0, 200)}`, { cause: err });
    }
  }

  return provider;
}

module.exports = { createLocalLlmProvider };
