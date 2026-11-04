const path = require('node:path');

const ROOT_DIR = path.resolve(__dirname, '..');

const REMEDIES = {
  GEMINI_API_KEY: 'create one at https://aistudio.google.com/apikey',
  GEMINI_MODEL: 'run `npm run models` and pick a model that supports generateContent',
  TELEGRAM_BOT_TOKEN: 'create a bot with @BotFather in Telegram and copy its API token',
  TELEGRAM_OWNER_CHAT_ID: 'tap Start in your bot, then run `npm run telegram:setup` to see your chat id',
  LINKEDIN_CLIENT_ID: 'LinkedIn developer portal → your app → Auth tab → Client ID',
  LINKEDIN_CLIENT_SECRET: 'LinkedIn developer portal → your app → Auth tab → Primary Client Secret',
};

// Must match the redirect URL registered in the LinkedIn app exactly (scheme, host, port and path).
const DEFAULT_LINKEDIN_REDIRECT_URI = 'http://localhost:8765/auth/linkedin/callback';
// LinkedIn supports each monthly version for at least a year; 202610 was the newest on 2026-11-04.
const DEFAULT_LINKEDIN_API_VERSION = '202610';
// Wording chosen by the owner on 2026-11-04. Added by the bot, not the model, so it is identical on every post.
const DEFAULT_POST_DISCLAIMER = '🤖 AI Generated Content, curated by a human. Spot something off? Tell me in the comments 👇';

function loadEnvFile() {
  try {
    process.loadEnvFile(path.join(ROOT_DIR, '.env'));
  } catch (err) {
    // A missing .env is fine: tests and the phone service may set variables directly.
    if (err.code !== 'ENOENT') throw err;
  }
}

function getConfig() {
  loadEnvFile();
  const env = process.env;
  return {
    rootDir: ROOT_DIR,
    timezone: env.TIMEZONE || 'Asia/Kolkata',
    sendTime: env.SEND_TIME || '09:00',
    catchupCutoff: env.CATCHUP_CUTOFF || '12:00',
    // Anything except an explicit "false" keeps posting simulated, so a typo can't publish for real.
    dryRun: env.DRY_RUN !== 'false',
    topicEpochDate: env.TOPIC_EPOCH_DATE || '2026-11-01',
    // Unset uses the default; set but empty turns the line off.
    postDisclaimer: (env.POST_DISCLAIMER ?? DEFAULT_POST_DISCLAIMER).trim(),
    dataDir: path.resolve(ROOT_DIR, env.DATA_DIR || 'data'),
    topicsFile: path.join(ROOT_DIR, 'data', 'topics.json'),
    promptsDir: path.join(ROOT_DIR, 'prompts'),
    gemini: {
      apiKey: env.GEMINI_API_KEY,
      model: env.GEMINI_MODEL,
    },
    telegram: {
      botToken: env.TELEGRAM_BOT_TOKEN,
      ownerChatId: env.TELEGRAM_OWNER_CHAT_ID,
    },
    linkedin: {
      clientId: env.LINKEDIN_CLIENT_ID,
      clientSecret: env.LINKEDIN_CLIENT_SECRET,
      redirectUri: env.LINKEDIN_REDIRECT_URI || DEFAULT_LINKEDIN_REDIRECT_URI,
      apiVersion: env.LINKEDIN_API_VERSION || DEFAULT_LINKEDIN_API_VERSION,
    },
  };
}

function assertLinkedInConfig({ redirectUri, apiVersion }) {
  if (!/^\d{6}$/.test(apiVersion)) {
    throw new Error(`LINKEDIN_API_VERSION "${apiVersion}" must be YYYYMM, e.g. ${DEFAULT_LINKEDIN_API_VERSION}. Leave it out to use the default.`);
  }
  let url;
  try {
    url = new URL(redirectUri);
  } catch {
    throw new Error(`LINKEDIN_REDIRECT_URI "${redirectUri}" is not a valid address. Use ${DEFAULT_LINKEDIN_REDIRECT_URI}.`);
  }
  // LinkedIn would deliver the code to any other host, which defeats keeping it on this device.
  if (!['localhost', '127.0.0.1'].includes(url.hostname)) {
    throw new Error(`LINKEDIN_REDIRECT_URI must point to localhost so the code stays on this device. Use ${DEFAULT_LINKEDIN_REDIRECT_URI}.`);
  }
}

function assertEnv(names) {
  const missing = names.filter((name) => !process.env[name]);
  if (missing.length === 0) return;
  const details = missing.map((name) => `${name} (${REMEDIES[name] ?? 'see .env.example'})`);
  throw new Error(`Missing in .env: ${details.join('; ')}`);
}

module.exports = { getConfig, assertEnv, assertLinkedInConfig };
