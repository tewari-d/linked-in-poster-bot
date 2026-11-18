const test = require('node:test');
const assert = require('node:assert/strict');
const { escapeLittleText, buildCommentary } = require('../src/linkedin/littleText');

test('every reserved little-text character is backslash-escaped', () => {
  const reserved = '\\|{}@[]()<>#*_~';
  const escaped = escapeLittleText(reserved);
  assert.equal(escaped, [...reserved].map((c) => `\\${c}`).join(''));
});

test('ordinary text, line breaks and emojis are left alone', () => {
  const plain = "SAP's RAP model: fewer layers, clearer code.\n\nWhat do you think? 🚀 50% faster - \"really\"/maybe.";
  assert.equal(escapeLittleText(plain), plain);
});

test('typical SAP snippets survive escaping (would otherwise truncate the post)', () => {
  assert.equal(
    escapeLittleText('SELECT * FROM I_Product (released) WHERE x <> @lv_y.'),
    'SELECT \\* FROM I\\_Product \\(released\\) WHERE x \\<\\> \\@lv\\_y.',
  );
});

test('commentary is the escaped text, a blank line, then hashtag templates', () => {
  const commentary = buildCommentary({ text: 'Hook line\n\nBody (short).', hashtags: ['#SAP', '#ABAP', '#Clean_Core'] });
  assert.equal(
    commentary,
    'Hook line\n\nBody \\(short\\).\n\n{hashtag|\\#|SAP} {hashtag|\\#|ABAP} {hashtag|\\#|Clean\\_Core}',
  );
});

test('the AI disclaimer sits between the text and the hashtags, escaped like the text', () => {
  const commentary = buildCommentary({
    text: 'Body.',
    disclaimer: '🤖 AI Generated Content, curated by a human. Spot something off? Tell me in the comments 👇',
    hashtags: ['#SAP'],
  });
  assert.equal(commentary, 'Body.\n\n🤖 AI Generated Content, curated by a human. Spot something off? Tell me in the comments 👇\n\n{hashtag|\\#|SAP}');
  assert.equal(buildCommentary({ text: 'Body.', disclaimer: 'Made with (AI)', hashtags: [] }), 'Body.\n\nMade with \\(AI\\)');
});

test('commentary without hashtags has no trailing blank lines', () => {
  assert.equal(buildCommentary({ text: 'Just text' }), 'Just text');
});
