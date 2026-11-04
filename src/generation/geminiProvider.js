const { GoogleGenAI, ApiError } = require('@google/genai');
const { DRAFT_SCHEMA } = require('./draftSchema');

// The free tier allows only a few calls per minute: one attempt per run, and failures are
// reported to the owner instead of retried. Set explicitly so an SDK default change can't add retries.
const NO_RETRY = { retryOptions: { attempts: 1 } };

function createGeminiProvider({ apiKey, model }) {
  const ai = new GoogleGenAI({ apiKey });

  async function generateDraft({ systemPrompt, userPrompt }) {
    let response;
    try {
      response = await ai.models.generateContent({
        model,
        contents: userPrompt,
        config: {
          systemInstruction: systemPrompt,
          responseMimeType: 'application/json',
          responseJsonSchema: DRAFT_SCHEMA,
          httpOptions: NO_RETRY,
        },
      });
    } catch (err) {
      if (err instanceof ApiError && err.status === 429) {
        throw new Error(`Gemini rate limit or quota reached for ${model}. Wait a minute (or until the daily reset) and try again.`, { cause: err });
      }
      if (err instanceof ApiError && err.status === 404) {
        throw new Error(`Gemini model "${model}" not found. Run \`npm run models\` and update GEMINI_MODEL.`, { cause: err });
      }
      throw err;
    }

    const text = response.text;
    if (!text) {
      const reason = response.candidates?.[0]?.finishReason ?? 'unknown';
      throw new Error(`Gemini returned no text (finish reason: ${reason})`);
    }
    try {
      return JSON.parse(text);
    } catch (err) {
      throw new Error(`Gemini returned text that is not valid JSON: ${text.slice(0, 200)}`, { cause: err });
    }
  }

  return { name: `gemini:${model}`, generateDraft };
}

async function listGenerateModels({ apiKey }) {
  const ai = new GoogleGenAI({ apiKey });
  const pager = await ai.models.list({ config: { pageSize: 100 } });
  const models = [];
  for await (const model of pager) {
    if (model.supportedActions?.includes('generateContent')) {
      models.push({
        id: model.name?.replace(/^models\//, ''),
        displayName: model.displayName,
        outputTokenLimit: model.outputTokenLimit,
      });
    }
  }
  return models;
}

module.exports = { createGeminiProvider, listGenerateModels };
