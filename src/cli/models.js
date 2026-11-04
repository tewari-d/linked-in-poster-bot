// Lists the Gemini models this API key can use for text generation.
// Usage: npm run models
const { getConfig, assertEnv } = require('../config');
const { listGenerateModels } = require('../generation/geminiProvider');

async function main() {
  const config = getConfig();
  assertEnv(['GEMINI_API_KEY']);
  const models = await listGenerateModels({ apiKey: config.gemini.apiKey });
  if (models.length === 0) {
    console.log('No models with generateContent found for this key.');
    return;
  }
  for (const m of models) console.log(`${m.id.padEnd(40)} ${m.displayName ?? ''}`);
  console.log('\nPut one of these ids in GEMINI_MODEL. Check its free-tier limits in Google AI Studio.');
}

main().catch((err) => {
  console.error(`Error: ${err.message}`);
  process.exitCode = 1;
});
