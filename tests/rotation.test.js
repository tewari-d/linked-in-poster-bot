const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { loadTopicBank, interleave, pickForDate } = require('../src/topics/rotation');
const { dateInZone, daysBetween } = require('../src/time');

const bank = loadTopicBank({ filePath: path.join(__dirname, '..', 'data', 'topics.json') });

test('real topic bank has enough subtopics to avoid repeats for 60 days', () => {
  assert.ok(interleave(bank.categories).length >= 60);
});

test('interleave alternates categories', () => {
  const topics = interleave([
    { name: 'A', subtopics: ['a1', 'a2'] },
    { name: 'B', subtopics: ['b1'] },
  ]);
  assert.deepEqual(topics.map((t) => t.subtopic), ['a1', 'b1', 'a2']);
});

test('pickForDate is deterministic and consecutive days differ in category', () => {
  const a = pickForDate({ date: '2026-11-05', epochDate: '2026-11-01', bank });
  const b = pickForDate({ date: '2026-11-05', epochDate: '2026-11-01', bank });
  const next = pickForDate({ date: '2026-11-06', epochDate: '2026-11-01', bank });
  assert.deepEqual(a, b);
  assert.notEqual(a.category, next.category);
});

test('one full cycle covers every subtopic exactly once', () => {
  const total = interleave(bank.categories).length;
  const seen = new Set();
  for (let day = 0; day < total; day++) {
    const date = new Date(Date.UTC(2026, 10, 1) + day * 86_400_000).toISOString().slice(0, 10);
    seen.add(pickForDate({ date, epochDate: '2026-11-01', bank }).subtopic);
  }
  assert.equal(seen.size, total);
});

test('dates before the epoch still pick a valid topic', () => {
  const pick = pickForDate({ date: '2026-10-01', epochDate: '2026-11-01', bank });
  assert.ok(pick.subtopic);
  assert.ok(pick.format.id);
});

test('dateInZone uses the owner timezone, not the server clock', () => {
  // 20:00 UTC on 4 Nov is 01:30 IST on 5 Nov.
  assert.equal(dateInZone({ date: new Date('2026-11-04T20:00:00Z'), timeZone: 'Asia/Kolkata' }), '2026-11-05');
  assert.equal(daysBetween({ from: '2026-11-01', to: '2026-11-05' }), 4);
  assert.throws(() => daysBetween({ from: '2026-11-01', to: '05-11-2026' }), /YYYY-MM-DD/);
});
