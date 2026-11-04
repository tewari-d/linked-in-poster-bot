const POLL_TIMEOUT_SECONDS = 30;
const ERROR_BACKOFF_MS = 5000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Long polling: the bot asks Telegram for new updates, so nothing needs to be reachable from the internet.
async function runPolling({ api, store, queue, onUpdate, onError, log }) {
  for (;;) {
    let updates;
    try {
      updates = await api.getUpdates({
        offset: store.load().telegramOffset,
        timeout: POLL_TIMEOUT_SECONDS,
        allowed_updates: ['message', 'callback_query'],
      });
    } catch (err) {
      if (err.code === 409) {
        throw new Error('Another copy of this bot is already polling Telegram (laptop and phone at the same time?). Stop the other one first.', { cause: err });
      }
      log(`Polling error: ${err.message}. Retrying in ${ERROR_BACKOFF_MS / 1000}s`);
      await sleep(ERROR_BACKOFF_MS);
      continue;
    }

    for (const update of updates) {
      await queue.run(async () => {
        try {
          await onUpdate(update);
        } catch (err) {
          log(`Update ${update.update_id} failed: ${err.stack ?? err.message}`);
          await onError(err);
        }
        // Stored after handling, so a crash mid-update redelivers it; status checks make that harmless.
        const state = store.load();
        state.telegramOffset = update.update_id + 1;
        store.save(state);
      });
    }
  }
}

module.exports = { runPolling };
