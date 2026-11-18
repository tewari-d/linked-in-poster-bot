const fs = require('node:fs');
const { daysBetween } = require('../time');

function loadTopicBank({ filePath }) {
  let bank;
  try {
    bank = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (err) {
    throw new Error(`Cannot read topic bank ${filePath}: ${err.message}`, { cause: err });
  }

  if (!Array.isArray(bank.formats) || bank.formats.length === 0) {
    throw new Error(`${filePath}: "formats" must be a non-empty list of { id, instruction }`);
  }
  if (!Array.isArray(bank.categories) || bank.categories.length === 0) {
    throw new Error(`${filePath}: "categories" must be a non-empty list of { name, subtopics }`);
  }

  const seen = new Set();
  for (const category of bank.categories) {
    if (!category.name || !Array.isArray(category.subtopics) || category.subtopics.length === 0) {
      throw new Error(`${filePath}: every category needs a name and at least one subtopic`);
    }
    for (const subtopic of category.subtopics) {
      if (seen.has(subtopic)) throw new Error(`${filePath}: duplicate subtopic "${subtopic}"`);
      seen.add(subtopic);
    }
  }
  return bank;
}

// Round-robin across categories so consecutive days land in different areas.
function interleave(categories) {
  const longest = Math.max(...categories.map((c) => c.subtopics.length));
  const topics = [];
  for (let i = 0; i < longest; i++) {
    for (const category of categories) {
      if (i < category.subtopics.length) {
        topics.push({ category: category.name, subtopic: category.subtopics[i] });
      }
    }
  }
  return topics;
}

const mod = (n, m) => ((n % m) + m) % m;

// The topic is a pure function of the date, so no history needs storing.
// With N subtopics, nothing repeats within N days.
function pickForDate({ date, epochDate, bank }) {
  const dayIndex = daysBetween({ from: epochDate, to: date });
  const topics = interleave(bank.categories);
  const topic = topics[mod(dayIndex, topics.length)];
  const format = bank.formats[mod(dayIndex, bank.formats.length)];
  return { ...topic, format, dayIndex };
}

module.exports = { loadTopicBank, interleave, pickForDate };
