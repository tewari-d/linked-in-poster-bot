// Generates today's draft and prints it. Sends nothing.
// Usage: npm run draft -- [--mock | --local] [--date YYYY-MM-DD] [--image preview.png]
//        --local uses the phone's own model (llama-server at LOCAL_LLM_URL) instead of Gemini.
const fs = require('node:fs');
const path = require('node:path');
const { parseArgs } = require('node:util');
const { getConfig, assertEnv } = require('../config');
const { dateInZone, assertIsoDate } = require('../time');
const { loadTopicBank } = require('../topics/rotation');
const { loadPrompts } = require('../generation/prompts');
const { createGeminiProvider } = require('../generation/geminiProvider');
const { createMockProvider } = require('../generation/mockProvider');
const { createLocalLlmProvider } = require('../generation/localLlmProvider');
const { createFileStore } = require('../store/fileStore');
const { createDraft } = require('../jobs/createDraft');
const { createInfographicRenderer } = require('../image/renderer');

function printDraft({ draft, warnings, imageProblems, filePath }) {
  const rule = '-'.repeat(60);
  console.log(`\nDraft ${draft.id} (${draft.provider})`);
  console.log(`Category: ${draft.category}\nTopic:    ${draft.subtopic}\nFormat:   ${draft.format}`);
  console.log(`${rule}\nHOOK (${draft.hook.length} chars)\n${draft.hook}`);
  console.log(`${rule}\nPOST (${draft.text.length} chars)\n${draft.text}\n\n${draft.hashtags.join(' ')}`);
  console.log(`${rule}\nIMAGE PROMPT\n${draft.imagePrompt}`);
  console.log(`${rule}\nIMAGE TEXT\n${draft.infographic ? JSON.stringify(draft.infographic, null, 2) : `(not usable: ${imageProblems.join('; ')})`}\n${rule}`);
  for (const warning of warnings) console.log(`Warning: ${warning}`);
  console.log(`Saved to ${filePath}`);
}

async function main() {
  const { values } = parseArgs({
    options: {
      mock: { type: 'boolean', default: false },
      local: { type: 'boolean', default: false },
      date: { type: 'string' },
      image: { type: 'string' },
    },
  });

  const config = getConfig();
  const date = values.date ?? dateInZone({ timeZone: config.timezone });
  assertIsoDate(date, '--date');

  let provider;
  if (values.mock) {
    provider = createMockProvider();
  } else if (values.local) {
    provider = createLocalLlmProvider({ url: config.localLlmUrl });
  } else {
    assertEnv(['GEMINI_API_KEY', 'GEMINI_MODEL']);
    provider = createGeminiProvider(config.gemini);
  }

  const store = createFileStore({ dataDir: config.dataDir });
  const started = Date.now();
  const { draft, warnings, imageProblems } = await createDraft({
    date,
    epochDate: config.topicEpochDate,
    bank: loadTopicBank({ filePath: config.topicsFile }),
    prompts: loadPrompts({ dir: config.promptsDir }),
    provider,
    store,
  });
  printDraft({ draft, warnings, imageProblems, filePath: store.filePath });
  const t = provider.lastTimings;
  const speed = t ? `: prompt ${t.prompt_n} tokens at ${t.prompt_per_second?.toFixed(1)}/s, reply ${t.predicted_n} tokens at ${t.predicted_per_second?.toFixed(1)}/s` : '';
  console.log(`Written in ${Math.round((Date.now() - started) / 1000)} s${speed}`);

  if (values.image && draft.infographic) {
    const png = await createInfographicRenderer().draw({ spec: draft.infographic, date: draft.date, seed: draft.id });
    const file = path.resolve(values.image);
    fs.writeFileSync(file, png);
    console.log(`Image written to ${file}`);
  }
}

main().catch((err) => {
  console.error(`Error: ${err.message}`);
  process.exitCode = 1;
});
