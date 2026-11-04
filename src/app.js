// The bot process: Telegram long polling + the daily draft timer.
// Usage: npm start            (Gemini drafts)
//        npm start -- --mock  (offline drafts, no Gemini quota used)
const { parseArgs } = require('node:util');
const { getConfig, assertEnv, assertLinkedInConfig } = require('./config');
const { assertHhMm } = require('./time');
const { loadTopicBank } = require('./topics/rotation');
const { loadPrompts } = require('./generation/prompts');
const { createGeminiProvider } = require('./generation/geminiProvider');
const { createMockProvider } = require('./generation/mockProvider');
const { createFileStore } = require('./store/fileStore');
const { createQueue } = require('./store/queue');
const { createDraft } = require('./jobs/createDraft');
const { createTelegramApi } = require('./messaging/telegramApi');
const { createDryRunPublisher } = require('./publish/dryRunPublisher');
const { createLinkedInPublisher } = require('./publish/linkedinPublisher');
const { createLinkedInApi } = require('./linkedin/linkedinApi');
const { createLinkedInAuth } = require('./linkedin/auth');
const { startCallbackServer } = require('./linkedin/callbackServer');
const { createInfographicRenderer } = require('./image/renderer');
const { createBot } = require('./bot/bot');
const { runPolling } = require('./bot/polling');
const { startScheduler } = require('./bot/schedule');

const SCHEDULER_INTERVAL_MS = 30_000;
const BOT_COMMANDS = [
  { command: 'draft', description: "Create today's draft now" },
  { command: 'status', description: 'Show the latest draft' },
  { command: 'linkedin', description: 'Connect or renew LinkedIn access' },
  { command: 'help', description: 'How this bot works' },
];

const log = (...args) => console.log(new Date().toISOString(), ...args);

// The bot still works without image drawing (the owner gets the image idea and sends an image),
// so a broken renderer is logged, not fatal.
async function createImageDrawer({ enabled }) {
  if (!enabled) return null;
  try {
    const renderer = createInfographicRenderer();
    await renderer.ready();
    return ({ draft }) => renderer.draw({ spec: draft.infographic, date: draft.date, seed: draft.id });
  } catch (err) {
    log(`Image drawing is off: ${err.message}`);
    return null;
  }
}

function linkedinStatus(linkedin) {
  if (!linkedin) return 'LinkedIn: not set up (LINKEDIN_CLIENT_ID / LINKEDIN_CLIENT_SECRET not in .env).';
  const c = linkedin.getConnection();
  if (c.connected) return `LinkedIn: connected${c.name ? ` as ${c.name}` : ''}, access valid until ${c.expiresAt}.`;
  return `LinkedIn: ${c.expired ? 'access expired' : 'not connected'}. Send /linkedin in Telegram.`;
}

async function main() {
  const { values } = parseArgs({ options: { mock: { type: 'boolean', default: false } } });
  const config = getConfig();

  assertEnv([
    'TELEGRAM_BOT_TOKEN',
    'TELEGRAM_OWNER_CHAT_ID',
    ...(values.mock ? [] : ['GEMINI_API_KEY', 'GEMINI_MODEL']),
    ...(config.dryRun ? [] : ['LINKEDIN_CLIENT_ID', 'LINKEDIN_CLIENT_SECRET']),
  ]);
  assertHhMm(config.sendTime, 'SEND_TIME');
  assertHhMm(config.catchupCutoff, 'CATCHUP_CUTOFF');
  // LinkedIn can be connected while still in dry run, so going live is only a DRY_RUN switch.
  const linkedinConfigured = Boolean(config.linkedin.clientId && config.linkedin.clientSecret);
  if (linkedinConfigured) assertLinkedInConfig(config.linkedin);

  const store = createFileStore({ dataDir: config.dataDir });
  const queue = createQueue();
  const api = createTelegramApi({ token: config.telegram.botToken });
  const provider = values.mock ? createMockProvider() : createGeminiProvider(config.gemini);
  const bank = loadTopicBank({ filePath: config.topicsFile });
  const prompts = loadPrompts({ dir: config.promptsDir });

  const makeDraft = ({ date, extra }) => createDraft({ date, extra, epochDate: config.topicEpochDate, bank, prompts, provider, store });
  const linkedinApi = linkedinConfigured ? createLinkedInApi(config.linkedin) : null;
  const linkedin = linkedinApi ? createLinkedInAuth({ linkedinApi, store }) : null;
  const publisher = config.dryRun
    ? createDryRunPublisher({ api })
    : createLinkedInPublisher({ linkedinApi, telegramApi: api, auth: linkedin, disclaimer: config.postDisclaimer });
  const drawImage = await createImageDrawer({ enabled: config.autoImage });
  const bot = createBot({ api, store, makeDraft, publisher, linkedin, drawImage, config, log });

  const me = await api.getMe();
  await api.setMyCommands({ commands: BOT_COMMANDS }).catch((err) => log(`setMyCommands: ${err.message}`));
  log(`Bot @${me.username} running with ${provider.name}. Daily draft at ${config.sendTime} ${config.timezone} (catch-up until ${config.catchupCutoff}). Mode: ${config.dryRun ? 'dry run' : 'LIVE (posts to LinkedIn)'}. State: ${store.filePath}`);
  log(linkedinStatus(linkedin));
  log(`Images: ${drawImage ? 'drawn by the bot' : 'made by hand from the image idea'}.`);
  if (linkedin) {
    // Through the queue like every other state change, since it writes the token to state.json.
    await startCallbackServer({ redirectUri: config.linkedin.redirectUri, onRedirect: (params) => queue.run(() => bot.onLinkedInRedirect(params)), log });
  }
  await queue.run(bot.recoverInterrupted).catch((err) => log(`Recovering interrupted posts: ${err.message}`));
  log('Press Ctrl+C to stop.');

  startScheduler({ intervalMs: SCHEDULER_INTERVAL_MS, tick: () => queue.run(bot.runDailyIfDue), log });
  await runPolling({ api, store, queue, onUpdate: bot.handleUpdate, onError: bot.notifyError, log });
}

process.on('SIGINT', () => {
  log('Stopping.');
  process.exit(0);
});

main().catch((err) => {
  log(`Fatal: ${err.message}`);
  process.exit(1);
});
