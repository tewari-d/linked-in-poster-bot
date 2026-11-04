const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const HH_MM = /^([01]\d|2[0-3]):[0-5]\d$/;
const MS_PER_DAY = 86_400_000;

function assertIsoDate(value, label) {
  if (!ISO_DATE.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) {
    throw new Error(`${label} must be a date in YYYY-MM-DD format, got "${value}"`);
  }
}

function assertHhMm(value, label) {
  if (!HH_MM.test(value)) throw new Error(`${label} must be a 24h time like 09:00, got "${value}"`);
}

// The server clock may run in UTC (or anything else); "today" must be the owner's calendar day.
function dateInZone({ date = new Date(), timeZone }) {
  // en-CA formats as YYYY-MM-DD, which avoids assembling the parts by hand.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

function timeInZone({ date = new Date(), timeZone }) {
  // h23 keeps midnight as 00:xx; some locales would render 24:xx.
  return new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(date);
}

function daysBetween({ from, to }) {
  assertIsoDate(from, 'from');
  assertIsoDate(to, 'to');
  const ms = Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`);
  return Math.round(ms / MS_PER_DAY);
}

module.exports = { dateInZone, timeInZone, daysBetween, assertIsoDate, assertHhMm };
