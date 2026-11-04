const test = require('node:test');
const assert = require('node:assert/strict');
const {
  DRAFT_SCHEMA, IMAGE_TEXT_LIMITS, normalizeDraft, normalizeInfographic, infographicProblems, validateDraft, countEmojis,
} = require('../src/generation/draftSchema');
const { ICON_NAMES } = require('../src/image/icons');
const { renderTemplate } = require('../src/generation/prompts');

const validRaw = () => ({
  hook: 'Stop concatenating strings in ABAP: use string templates instead.',
  text: `Stop concatenating strings in ABAP: use string templates instead.\n\n${'Readable code matters. '.repeat(45)}`,
  hashtags: ['#SAP', '#ABAP', '#CleanCode'],
  imagePrompt: 'Abstract flowing ribbons joining into a single smooth line, calm blue palette, clean modern style, landscape, no text, no logos.',
});

test('a well-formed draft passes', () => {
  const { errors } = validateDraft(normalizeDraft(validRaw()));
  assert.deepEqual(errors, []);
});

test('normalize adds missing # and drops duplicates and spaces', () => {
  const draft = normalizeDraft({ ...validRaw(), hashtags: ['SAP', '#SAP', 'Clean Code', '#ABAP'] });
  assert.deepEqual(draft.hashtags, ['#SAP', '#CleanCode', '#ABAP']);
});

test('a multi-line hook is rejected (it must be the single line shown before "see more")', () => {
  const { errors } = validateDraft(normalizeDraft({ ...validRaw(), hook: 'line one\nline two' }));
  assert.ok(errors.some((e) => e.includes('one line')));
});

test('too few hashtags and a missing image prompt are rejected', () => {
  const { errors } = validateDraft(normalizeDraft({ ...validRaw(), hashtags: ['#SAP'], imagePrompt: '' }));
  assert.ok(errors.some((e) => e.includes('hashtags')));
  assert.ok(errors.some((e) => e.includes('imagePrompt')));
});

test('Markdown in the text produces a warning, not an error', () => {
  const raw = validRaw();
  const { errors, warnings } = validateDraft(normalizeDraft({ ...raw, text: `${raw.text}\n**bold**` }));
  assert.deepEqual(errors, []);
  assert.ok(warnings.some((w) => w.includes('Markdown')));
});

test('a post with too few emojis gets a style warning, not an error', () => {
  const { errors, warnings } = validateDraft(normalizeDraft(validRaw()));
  assert.deepEqual(errors, []);
  assert.ok(warnings.some((w) => w.includes('only 0 emojis')));
});

test('an emoji-marked creator post has no emoji warning; keycaps count once', () => {
  const raw = validRaw();
  const text = `🚀 ${raw.text}\n\n1️⃣ Templates\n2️⃣ Embedded expressions\n✅ Fewer bugs\n🎯 Use them.\n💬 Which do you use?`;
  assert.equal(countEmojis(text), 6);
  const { warnings } = validateDraft(normalizeDraft({ ...raw, text }));
  assert.ok(!warnings.some((w) => w.includes('emoji')));
});

test('a percentage in the post or the image text is flagged for checking', () => {
  const raw = validRaw();
  const inText = validateDraft(normalizeDraft({ ...raw, text: `${raw.text} Use it for 80% of apps.` }));
  const inImage = validateDraft(normalizeDraft({ ...raw, imagePrompt: `${raw.imagePrompt} Takeaway: "80 % use Elements".` }));
  for (const { errors, warnings } of [inText, inImage]) {
    assert.deepEqual(errors, []);
    assert.ok(warnings.some((w) => w.includes('percentage')));
  }
});

test('a long infographic image prompt with quoted on-image text is accepted', () => {
  const imagePrompt = `Portrait infographic, aspect ratio 4:5, 1080 x 1350 pixels. Headline "String Templates in ABAP". ${'Glossy 3D card labeled "Embedded expressions" connected by glowing arrows. '.repeat(18)}`;
  assert.ok(imagePrompt.length > 1200 && imagePrompt.length < 2000);
  const { errors } = validateDraft(normalizeDraft({ ...validRaw(), imagePrompt }));
  assert.deepEqual(errors, []);
});

const imageText = () => ({
  label: 'ABAP · Clean code',
  headline: '🚀 String templates  beat CONCATENATE',
  subtitle: 'Cleaner ABAP in three habits',
  layout: 'list',
  points: [
    { icon: 'braces', title: 'Embed expressions', note: 'Variables go straight into the text' },
    { icon: 'no-such-icon', title: 'Format inline ✅', note: 'Options sit inside the braces' },
    { icon: 'circle-check', title: 'Fewer helpers', note: 'One readable line' },
  ],
  question: '💬 Do you still use CONCATENATE?',
});

test('image text is cleaned: no emojis or double spaces, unknown icons replaced', () => {
  const info = normalizeInfographic(imageText());
  assert.equal(info.headline, 'String templates beat CONCATENATE');
  assert.equal(info.points[1].title, 'Format inline');
  assert.equal(info.points[1].icon, 'circle-check');
  assert.equal(info.question, 'Do you still use CONCATENATE?');
  assert.equal(info.points[0].code, false);
  assert.deepEqual(infographicProblems(info), []);
});

test('code lines keep their indentation; blank edge lines and tabs are tidied', () => {
  const info = normalizeInfographic({ ...imageText(), layout: 'code', code: { file: 'db/schema.cds', lines: ['', 'entity Books {\n\ttitle : String;  ', '}', ''] } });
  assert.deepEqual(info.code.lines, ['entity Books {', '  title : String;', '}']);
  assert.deepEqual(infographicProblems(info), []);
});

test('image text that would not fit, or a missing section, is reported', () => {
  const tooLong = normalizeInfographic({ ...imageText(), headline: 'x'.repeat(IMAGE_TEXT_LIMITS.HEADLINE_MAX + 1) });
  assert.match(infographicProblems(tooLong).join(), /headline is 49 characters/);
  const noCompare = normalizeInfographic({ ...imageText(), layout: 'compare' });
  assert.match(infographicProblems(noCompare).join(), /left title is empty/);
  const longCode = normalizeInfographic({ ...imageText(), layout: 'code', code: { file: 'a.js', lines: Array(9).fill('x();') } });
  assert.match(infographicProblems(longCode).join(), /9 lines/);
  const twoPoints = normalizeInfographic({ ...imageText(), points: imageText().points.slice(0, 2) });
  assert.match(infographicProblems(twoPoints).join(), /3-4 takeaways, got 2/);
  assert.deepEqual(infographicProblems(null), ['no image text came back']);
});

test('a percentage in the image text is flagged too', () => {
  const info = { ...imageText(), subtitle: 'Saves 30% of effort' };
  const { warnings } = validateDraft(normalizeDraft({ ...validRaw(), infographic: info }));
  assert.ok(warnings.some((w) => w.includes('percentage')));
});

test('the schema asks for the image text, with icons limited to the bundled set', () => {
  assert.ok(DRAFT_SCHEMA.required.includes('infographic'));
  assert.deepEqual(DRAFT_SCHEMA.properties.infographic.properties.points.items.properties.icon.enum, ICON_NAMES);
});

test('renderTemplate fails on a placeholder without a value', () => {
  assert.equal(renderTemplate({ template: 'Topic: {{a}}', values: { a: 'CDS' } }), 'Topic: CDS');
  assert.throws(() => renderTemplate({ template: '{{missing}}', values: {} }), /missing/);
});
