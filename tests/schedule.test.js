const test = require('node:test');
const assert = require('node:assert/strict');
const { isDailyRunDue } = require('../src/bot/schedule');
const { timeInZone } = require('../src/time');

const base = { timezone: 'Asia/Kolkata', sendTime: '09:00', cutoff: '12:00' };
const empty = { drafts: [] };
// India is UTC+05:30: 03:30Z is 09:00 IST.
const due = (iso, state = empty) => isDailyRunDue({ ...base, now: new Date(iso), state }).due;

test('not due before the send time', () => {
  assert.equal(due('2026-11-05T03:29:00Z'), false);
});

test('due from the send time until the catch-up cutoff', () => {
  assert.equal(due('2026-11-05T03:30:00Z'), true);
  assert.equal(due('2026-11-05T06:29:00Z'), true);
  assert.equal(due('2026-11-05T06:30:00Z'), false);
});

test('not due again once it ran today, or when a draft for today was already delivered', () => {
  assert.equal(due('2026-11-05T04:00:00Z', { drafts: [], lastAutoRunDate: '2026-11-05' }), false);
  assert.equal(due('2026-11-05T04:00:00Z', { drafts: [{ date: '2026-11-05', sentAt: '2026-11-05T02:00:00Z' }] }), false);
  assert.equal(due('2026-11-06T04:00:00Z', { drafts: [{ date: '2026-11-05', sentAt: 'x' }], lastAutoRunDate: '2026-11-05' }), true);
});

test('a draft made with `npm run draft` (never sent) does not block the daily run', () => {
  assert.equal(due('2026-11-05T04:00:00Z', { drafts: [{ date: '2026-11-05', status: 'GENERATED' }] }), true);
});

test('timeInZone renders midnight as 00, not 24', () => {
  assert.equal(timeInZone({ date: new Date('2026-11-04T18:30:00Z'), timeZone: 'Asia/Kolkata' }), '00:00');
});
