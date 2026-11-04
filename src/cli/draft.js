// Generates today's draft and prints it. Sends nothing.
// Usage: npm run draft -- [--mock] [--date YYYY-MM-DD]
const { parseArgs } = require('node:util');
const { getConfig, assertEnv } = require('../config');
const { dateInZone, assertIsoDate } = require('../time');
const { loadTopicBank } = require('../topics/rotation');
const { loadPrompts } = require('../generation/prompts');
const { createGeminiProvider } = require('../generation/geminiProvider');
const { createMockProvider } = require('../generation/mockProvider');
const { createFileStore } = require('../store/fileStore');
const { createDraft } = require('../jobs/createDraft');

function printDraft({ draft, warnings, filePath }) {
  const rule = '-'.repeat(60);
  console.log(`\nDraft ${draft.id} (${draft.provider})`);
  console.log(`Category: ${draft.category}\nTopic:    ${draft.subtopic}\nFormat:   ${draft.format}`);
  console.log(`${rule}\nHOOK (${draft.hook.length} chars)\n${draft.hook}`);
  console.log(`${rule}\nPOST (${draft.text.length} chars)\n${draft.text}\n\n${draft.hashtags.join(' ')}`);
  console.log(`${rule}\nIMAGE PROMPT\n${draft.imagePrompt}\n${rule}`);
  for (const warning of warnings) console.log(`Warning: ${warning}`);
  console.log(`Saved to ${filePath}`);
}

async function main() {
  const { values } = parseArgs({
    options: {
      mock: { type: 'boolean', default: false },
      date: { type: 'string' },
    },
  });

  const config = getConfig();
  const date = values.date ?? dateInZone({ timeZone: config.timezone });
  assertIsoDate(date, '--date');

  let provider;
  if (values.mock) {
    provider = createMockProvider();
  } else {
    assertEnv(['GEMINI_API_KEY', 'GEMINI_MODEL']);
    provider = createGeminiProvider(config.gemini);
  }

  const store = createFileStore({ dataDir: config.dataDir });
  const { draft, warnings } = await createDraft({
    date,
    epochDate: config.topicEpochDate,
    bank: loadTopicBank({ filePath: config.topicsFile }),
    prompts: loadPrompts({ dir: config.promptsDir }),
    provider,
    store,
  });
  printDraft({ draft, warnings, filePath: store.filePath });
}

main().catch((err) => {
  console.error(`Error: ${err.message}`);
  process.exitCode = 1;
});
