const { dateInZone, timeInZone } = require('../time');

// Polled every few seconds instead of a cron timer: a laptop that slept through 09:00, or a phone
// that rebooted, still sends the day's draft when it comes back, as long as it is before the cutoff.
function isDailyRunDue({ now, timezone, sendTime, cutoff, state }) {
  const today = dateInZone({ date: now, timeZone: timezone });
  const time = timeInZone({ date: now, timeZone: timezone });
  if (time < sendTime || time >= cutoff) return { due: false, today };
  if (state.lastAutoRunDate === today) return { due: false, today };
  // A draft delivered earlier today (e.g. via /draft) counts; one made with `npm run draft` was never
  // sent, so it does not.
  if (state.drafts.some((d) => d.date === today && d.sentAt)) return { due: false, today };
  return { due: true, today };
}

function startScheduler({ intervalMs, tick, log }) {
  const run = () => tick().catch((err) => log(`Scheduler error: ${err.message}`));
  run();
  return setInterval(run, intervalMs);
}

module.exports = { isDailyRunDue, startScheduler };
