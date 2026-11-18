// Checks the bot token and shows the chat id of whoever pressed Start in the bot.
// Usage: npm run telegram:setup
const { getConfig, assertEnv } = require('../config');
const { createTelegramApi, privateChatsFrom, TelegramError } = require('../messaging/telegramApi');

async function main() {
  const config = getConfig();
  assertEnv(['TELEGRAM_BOT_TOKEN']);
  const api = createTelegramApi({ token: config.telegram.botToken });

  let me;
  try {
    me = await api.getMe();
  } catch (err) {
    if (err instanceof TelegramError && err.code === 401) {
      throw new Error('Telegram rejected the token. Copy it again from @BotFather (/mybots → your bot → API Token) into TELEGRAM_BOT_TOKEN.', { cause: err });
    }
    throw err;
  }
  console.log(`Token OK: bot @${me.username} ("${me.first_name}")`);

  // No offset: just peek at pending updates without consuming them.
  const chats = privateChatsFrom(await api.getUpdates({ timeout: 0, allowed_updates: ['message'] }));
  if (chats.length === 0) {
    console.log(`\nNo messages yet. In Telegram, open @${me.username}, tap Start (or send /start), then run this again.`);
    return;
  }

  console.log('\nChats that messaged the bot:');
  for (const chat of chats) {
    const owner = String(chat.id) === config.telegram.ownerChatId ? '  <- current owner' : '';
    console.log(`  chat id ${chat.id}  ${chat.name}${chat.username ? ` (@${chat.username})` : ''}  last: "${chat.lastText}"${owner}`);
  }
  if (!config.telegram.ownerChatId) {
    console.log('\nIf that is you, add this line to .env:\n  TELEGRAM_OWNER_CHAT_ID=<your chat id>');
  }
}

main().catch((err) => {
  console.error(`Error: ${err.message}`);
  process.exitCode = 1;
});
