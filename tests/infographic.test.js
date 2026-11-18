const test = require('node:test');
const assert = require('node:assert/strict');
const { buildInfographicSvg, themeForDate, THEMES } = require('../src/image/infographic');
const { createInfographicRenderer } = require('../src/image/renderer');
const { IMAGE_TEXT_LIMITS: L, infographicProblems } = require('../src/generation/draftSchema');

// Rough widths, so layout logic is tested without fonts.
const fakeMeasure = ({ kind, size, text }) => text.length * size * (kind === 'mono' ? 0.6 : 0.55);

const base = {
  label: 'SAP CAP · CDS modeling',
  headline: 'Stop hand-writing IDs & timestamps',
  subtitle: 'Two built-in aspects do it for you',
  points: [
    { icon: 'key-round', title: 'cuid', code: true, note: 'Adds a UUID key named ID' },
    { icon: 'clock-3', title: 'managed', code: true, note: 'Fills createdAt, createdBy, modifiedAt, modifiedBy' },
    { icon: 'layers', title: 'Combine aspects', note: 'List them after the colon <in order>' },
  ],
  question: 'UUIDs or integer keys in your CAP entities?',
};
const SPECS = {
  list: { ...base, layout: 'list' },
  compare: {
    ...base,
    layout: 'compare',
    compare: {
      left: { icon: 'layout-template', title: 'Fiori elements', note: 'Built from your OData service' },
      right: { icon: 'code-xml', title: 'Freestyle SAPUI5', note: 'You code every view' },
    },
  },
  code: {
    ...base,
    layout: 'code',
    code: { file: 'db/schema.cds', lines: ["using { cuid, managed } from '@sap/cds/common';", '', 'entity Books : cuid, managed {', '  title : String;', '}'] },
  },
};

test('every layout builds a 1080x1350 SVG containing the exact, escaped text', () => {
  for (const [layout, spec] of Object.entries(SPECS)) {
    const svg = buildInfographicSvg({ spec, date: '2026-11-05', measure: fakeMeasure });
    assert.match(svg, /^<svg [^>]*width="1080" height="1350"/, layout);
    assert.ok(svg.includes('SAP CAP · CDS MODELING'), `${layout}: label`);
    assert.ok(svg.includes('&amp; timestamps') || svg.includes('IDs &amp;'), `${layout}: headline escaped`);
    assert.ok(svg.includes('List them after the colon &lt;in order&gt;'), `${layout}: note escaped`);
    assert.ok(svg.includes('UUIDs or integer keys in your CAP entities?'), `${layout}: question`);
    assert.doesNotMatch(svg, /undefined|NaN/, layout);
  }
  assert.ok(buildInfographicSvg({ spec: SPECS.compare, date: '2026-11-05', measure: fakeMeasure }).includes('>Fiori elements<'));
  const code = buildInfographicSvg({ spec: SPECS.code, date: '2026-11-05', measure: fakeMeasure });
  assert.ok(code.includes("'@sap/cds/common'"), 'code strings kept');
  assert.ok(code.includes('>db/schema.cds<'));
});

test('the colour theme changes from day to day, and a draft always draws the same way', () => {
  assert.notEqual(themeForDate('2026-11-05').name, themeForDate('2026-11-06').name);
  assert.equal(new Set(['2026-11-05', '2026-11-06', '2026-11-07', '2026-11-08', '2026-11-09'].map((d) => themeForDate(d).name)).size, THEMES.length);
  const draw = (seed) => buildInfographicSvg({ spec: SPECS.list, date: '2026-11-05', seed, measure: fakeMeasure });
  assert.equal(draw('a'), draw('a'));
  assert.notEqual(draw('a'), draw('b'), 'a regenerated draft gets a new background');
});

test('text that cannot fit throws, so the bot can fall back to the image idea', () => {
  const tooLong = { ...SPECS.list, headline: 'An extraordinarily overlong headline that keeps going far beyond two lines of space' };
  assert.throws(() => buildInfographicSvg({ spec: tooLong, date: '2026-11-05', measure: fakeMeasure }), /too long for the image/);
  assert.throws(() => buildInfographicSvg({ spec: { ...SPECS.list, layout: 'poster' }, date: '2026-11-05', measure: fakeMeasure }), /unknown image layout/);
});

// Realistic text cut to an exact length, ending on a letter.
const textOf = (n) => 'Fiori elements apps built from OData annotations need less rework after upgrades and keep teams fast'.repeat(3).slice(0, n).replace(/ $/, 'x');

test('image text at the validation limits still fits with the real fonts', () => {
  const { measure } = createInfographicRenderer();
  const point = (i) => ({ icon: 'zap', title: textOf(L.POINT_TITLE_MAX), note: textOf(L.POINT_NOTE_MAX), code: i === 0 });
  const header = { label: textOf(L.LABEL_MAX), headline: textOf(L.HEADLINE_MAX), subtitle: textOf(L.SUBTITLE_MAX), question: textOf(L.QUESTION_MAX) };
  const side = { icon: 'cloud', title: textOf(L.SIDE_TITLE_MAX), note: textOf(L.SIDE_NOTE_MAX) };
  const cases = [
    { ...header, layout: 'list', points: [0, 1, 2, 3].map(point) },
    { ...header, layout: 'compare', compare: { left: side, right: side }, points: [0, 1, 2, 3].map(point) },
    { ...header, layout: 'code', code: { file: textOf(L.FILE_MAX), lines: Array(L.CODE_LINES_MAX).fill('  x'.padEnd(L.CODE_LINE_MAX, 'a')) }, points: [0, 1, 2].map(point) },
  ];
  for (const spec of cases) {
    assert.deepEqual(infographicProblems(spec), [], `${spec.layout} is within the limits`);
    assert.doesNotThrow(() => buildInfographicSvg({ spec, date: '2026-11-05', measure }), spec.layout);
  }
});

test('the renderer draws a 1080x1350 PNG with the bundled fonts', async () => {
  const png = await createInfographicRenderer().draw({ spec: SPECS.code, date: '2026-11-05', seed: 'test' });
  assert.deepEqual([...png.subarray(0, 8)], [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
  assert.equal(png.readUInt32BE(16), 1080);
  assert.equal(png.readUInt32BE(20), 1350);
});
