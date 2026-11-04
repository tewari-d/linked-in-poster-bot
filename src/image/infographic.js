// Builds the post's infographic as SVG from the exact text Gemini wrote. The bot types every word
// instead of an AI image model painting it, so the image is always spelled right (the free image
// models misspelled words in every test on 2026-11-04). Pure: text measuring is passed in, so tests
// need no fonts; renderer.js supplies real font metrics and turns the SVG into a PNG.
const { ICON_SVG } = require('./icons');

const WIDTH = 1080;
const HEIGHT = 1350;
const PAD = 80;
const CONTENT_W = WIDTH - 2 * PAD;
const FONT = { sans: 'Inter', mono: 'JetBrains Mono' };
const LAYOUTS = ['compare', 'code', 'list'];

// The question line sits at the bottom; everything else has to end above its rule.
const FOOTER_BASELINE = HEIGHT - 62;
const FOOTER_RULE = FOOTER_BASELINE - 52;
const CONTENT_BOTTOM = FOOTER_RULE - 34;
const SECTION_GAP = 44;
const POINTS_GAP = 36;
const ROW_GAP = 14;
// Below this a takeaway row can't hold its title and note legibly on a phone screen.
const ROW_MIN = 76;
// Under 20 px, code is unreadable in the LinkedIn feed; such a snippet is too long for the image.
const CODE_MIN_SIZE = 20;
const FALLBACK_ICON = 'circle-check';

// Dark backgrounds with two accents each. The date picks one, so consecutive posts look different.
const THEMES = [
  { name: 'indigo', bg: ['#060A1E', '#15114B', '#2B0E57'], a: '#5EEAD4', b: '#A78BFA', muted: '#C5CCF6' },
  { name: 'ocean', bg: ['#02101A', '#042C47', '#0B1F45'], a: '#38BDF8', b: '#4ADE80', muted: '#BEE3F7' },
  { name: 'ember', bg: ['#130708', '#3A0F1F', '#4A1A08'], a: '#FB923C', b: '#F472B6', muted: '#F5D3C6' },
  { name: 'forest', bg: ['#03140F', '#063B2D', '#0B2A3B'], a: '#34D399', b: '#FACC15', muted: '#C6EBDC' },
  { name: 'violet', bg: ['#0A0718', '#26104F', '#0B2550'], a: '#C084FC', b: '#22D3EE', muted: '#DCCFF7' },
];

const CODE_COLORS = { text: '#E6EDF7', string: '#FCD34D', comment: '#7F8EA8', punctuation: '#8B9BB4' };
// Keywords of the languages SAP posts show most (CDS, JavaScript, ABAP). Colour only, so a miss is harmless.
const CODE_KEYWORDS = new Set([
  'using', 'from', 'entity', 'key', 'Association', 'Composition', 'to', 'of', 'many', 'one', 'type', 'aspect',
  'service', 'projection', 'on', 'as', 'define', 'view', 'select', 'where', 'annotate', 'with', 'extend', 'action', 'function',
  'const', 'let', 'var', 'async', 'await', 'return', 'if', 'else', 'new', 'class', 'require', 'module', 'exports', 'this',
  'for', 'in', 'try', 'catch', 'throw', 'srv', 'req',
  'DATA', 'TYPES', 'TYPE', 'SELECT', 'FROM', 'INTO', 'TABLE', 'WHERE', 'LOOP', 'AT', 'ENDLOOP', 'IF', 'ENDIF', 'ELSE',
  'METHOD', 'ENDMETHOD', 'METHODS', 'CLASS', 'ENDCLASS', 'DEFINITION', 'IMPLEMENTATION', 'PUBLIC', 'FINAL', 'CREATE',
  'VALUE', 'NEW', 'READ', 'INSERT', 'MODIFY', 'DELETE', 'APPEND', 'RETURN', 'RETURNING', 'IMPORTING', 'EXPORTING',
  'REF', 'TO', 'FIELD-SYMBOL', 'ASSIGN', 'CASE', 'WHEN', 'ENDCASE', 'DEFINE', 'VIEW', 'ENTITY', 'AS', 'ROOT',
]);

const esc = (value) => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const r1 = (n) => Math.round(n * 10) / 10;

function themeForDate(date) {
  const day = Math.floor(Date.parse(`${date}T00:00:00Z`) / 86_400_000);
  if (!Number.isFinite(day)) return THEMES[0];
  return THEMES[((day % THEMES.length) + THEMES.length) % THEMES.length];
}

// Seeded (FNV-1a hash into mulberry32), so a draft's background is the same every time it is drawn.
function seededRandom(seedText) {
  let h = 2166136261;
  for (const ch of String(seedText)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return () => {
    h = (h + 0x6D2B79F5) | 0;
    let t = Math.imul(h ^ (h >>> 15), 1 | h);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function wrap({ measure, kind, weight, size, text, width }) {
  const lines = [];
  let current = '';
  for (const word of text.split(/\s+/)) {
    const next = current ? `${current} ${word}` : word;
    if (current && measure({ kind, weight, size, text: next }) > width) {
      lines.push(current);
      current = word;
    } else {
      current = next;
    }
  }
  if (current) lines.push(current);
  return { lines, fits: lines.every((line) => measure({ kind, weight, size, text: line }) <= width) };
}

// Largest font size, from `size` down to `minSize`, at which the text fits in `maxLines` lines.
function fit({ measure, kind = 'sans', weight, size, minSize, text, width, maxLines }) {
  for (let s = size; s >= minSize; s -= 1) {
    const { lines, fits } = wrap({ measure, kind, weight, size: s, text, width });
    if (fits && lines.length <= maxLines) return { size: s, lines };
  }
  throw new Error(`"${text}" is too long for the image`);
}

function textLine({ text, x, base, kind = 'sans', weight, size, fill, anchor = 'start', spacing = 0, opacity = 1 }) {
  return `<text x="${r1(x)}" y="${r1(base)}" font-family="${FONT[kind]}" font-weight="${weight}" font-size="${size}"`
    + ` letter-spacing="${spacing}" text-anchor="${anchor}" fill="${fill}" fill-opacity="${opacity}" xml:space="preserve">${esc(text)}</text>`;
}

// Wrapped lines laid out from the top of the block; returns the markup and where the block ends.
function textBlock({ block, x, top, lineHeight, fill, ...style }) {
  const first = top + block.size * 0.76;
  const svg = block.lines.map((text, i) => textLine({
    ...style,
    text,
    x,
    base: first + i * block.size * lineHeight,
    size: block.size,
    fill: typeof fill === 'function' ? fill(i, block.lines.length) : fill,
  })).join('');
  return { svg, bottom: first + (block.lines.length - 1) * block.size * lineHeight + block.size * 0.24 };
}

function icon({ name, x, y, size, color }) {
  const shape = ICON_SVG[name] ?? ICON_SVG[FALLBACK_ICON];
  return `<g transform="translate(${r1(x)} ${r1(y)}) scale(${r1(size / 24 * 100) / 100})" fill="none" stroke="${color}"`
    + ` stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${shape}</g>`;
}

function background({ theme, random }) {
  let svg = `<defs>
<linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${theme.bg[0]}"/><stop offset=".55" stop-color="${theme.bg[1]}"/><stop offset="1" stop-color="${theme.bg[2]}"/></linearGradient>
<radialGradient id="glowA"><stop offset="0" stop-color="${theme.a}" stop-opacity=".30"/><stop offset="1" stop-color="${theme.a}" stop-opacity="0"/></radialGradient>
<radialGradient id="glowB"><stop offset="0" stop-color="${theme.b}" stop-opacity=".26"/><stop offset="1" stop-color="${theme.b}" stop-opacity="0"/></radialGradient>
<filter id="blur" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="26"/></filter>
<linearGradient id="headline" gradientUnits="userSpaceOnUse" x1="${PAD}" y1="0" x2="${WIDTH - PAD}" y2="0"><stop offset="0" stop-color="${theme.a}"/><stop offset="1" stop-color="${theme.b}"/></linearGradient>
<linearGradient id="edgeA" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${theme.a}" stop-opacity=".95"/><stop offset="1" stop-color="${theme.a}" stop-opacity=".15"/></linearGradient>
<linearGradient id="edgeB" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${theme.b}" stop-opacity=".95"/><stop offset="1" stop-color="${theme.b}" stop-opacity=".15"/></linearGradient>
<linearGradient id="badge" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${theme.a}"/><stop offset="1" stop-color="${theme.b}"/></linearGradient>
<linearGradient id="sheen" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FFFFFF" stop-opacity=".10"/><stop offset="1" stop-color="#FFFFFF" stop-opacity="0"/></linearGradient>
</defs>
<rect width="${WIDTH}" height="${HEIGHT}" fill="url(#bg)"/>
<circle cx="140" cy="230" r="560" fill="url(#glowA)"/>
<circle cx="980" cy="1180" r="620" fill="url(#glowB)"/>
<g stroke="${theme.a}" stroke-opacity=".13" stroke-width="2" fill="none">`;
  // Circuit-board traces entering from both edges.
  for (let i = 0; i < 28; i += 1) {
    const dir = random() < 0.5 ? 1 : -1;
    const y = r1(random() * HEIGHT);
    const x0 = dir === 1 ? -10 : WIDTH + 10;
    const x1 = r1(x0 + dir * (60 + random() * 260));
    const bend = (random() < 0.5 ? -1 : 1) * (30 + random() * 60);
    const x2 = r1(x1 + dir * Math.abs(bend));
    const y2 = r1(y + bend);
    const x3 = r1(x2 + dir * (40 + random() * 200));
    svg += `<path d="M${x0} ${y} H${x1} L${x2} ${y2} H${x3}"/><circle cx="${x3}" cy="${y2}" r="6"/>`;
  }
  return `${svg}</g>`;
}

// A glowing glass card. The dark base keeps background traces from running through its text.
function glass({ theme, x, y, w, h, radius = 32, edge, glow, glowOpacity = 0.35, fill = '#FFFFFF', fillOpacity = 0.08 }) {
  return `<rect x="${r1(x + 14)}" y="${r1(y + 20)}" width="${r1(w - 28)}" height="${r1(h - 14)}" rx="${radius}" fill="${glow}" fill-opacity="${glowOpacity}" filter="url(#blur)"/>`
    + `<rect x="${r1(x)}" y="${r1(y)}" width="${r1(w)}" height="${r1(h)}" rx="${radius}" fill="${theme.bg[0]}" fill-opacity=".78"/>`
    + `<rect x="${r1(x)}" y="${r1(y)}" width="${r1(w)}" height="${r1(h)}" rx="${radius}" fill="${fill}" fill-opacity="${fillOpacity}" stroke="url(#${edge})" stroke-width="2.5"/>`
    + `<rect x="${r1(x + 2)}" y="${r1(y + 2)}" width="${r1(w - 4)}" height="${r1((h - 4) * 0.45)}" rx="${radius - 2}" fill="url(#sheen)"/>`;
}

function iconTile({ name, x, y, size, color }) {
  return `<rect x="${r1(x)}" y="${r1(y)}" width="${r1(size)}" height="${r1(size)}" rx="${r1(size * 0.28)}" fill="${color}" fill-opacity=".16" stroke="${color}" stroke-opacity=".5" stroke-width="2"/>`
    + icon({ name, x: x + size * 0.2, y: y + size * 0.2, size: size * 0.6, color });
}

function header({ spec, theme, measure }) {
  const label = spec.label.toUpperCase();
  const spacing = 3;
  let labelSize = 24;
  const labelWidth = (size) => measure({ weight: 700, size, text: label }) + spacing * (label.length - 1);
  while (labelSize > 18 && labelWidth(labelSize) > CONTENT_W - 48) labelSize -= 1;
  if (labelWidth(labelSize) > CONTENT_W - 48) throw new Error(`"${spec.label}" is too long for the image`);
  const pill = `<rect x="${PAD}" y="72" width="${r1(labelWidth(labelSize) + 48)}" height="50" rx="25" fill="${theme.a}" fill-opacity=".10" stroke="${theme.a}" stroke-opacity=".55" stroke-width="2"/>`
    + textLine({ text: label, x: PAD + 24, base: 97 + labelSize * 0.36, weight: 700, size: labelSize, fill: theme.a, spacing });

  const headline = textBlock({
    block: fit({ measure, weight: 800, size: 92, minSize: 60, text: spec.headline, width: CONTENT_W, maxLines: 2 }),
    x: PAD,
    top: 162,
    lineHeight: 1.08,
    weight: 800,
    spacing: -1.5,
    // A two-line headline ends in the accent gradient, so the eye lands on the payoff word.
    fill: (i, n) => (n > 1 && i === n - 1 ? 'url(#headline)' : '#FFFFFF'),
  });
  const subtitle = textBlock({
    block: fit({ measure, weight: 500, size: 36, minSize: 28, text: spec.subtitle, width: CONTENT_W, maxLines: 2 }),
    x: PAD,
    top: headline.bottom + 26,
    lineHeight: 1.25,
    weight: 500,
    fill: theme.muted,
  });
  return { svg: pill + headline.svg + subtitle.svg, bottom: subtitle.bottom };
}

function compareSection({ spec, theme, measure, top }) {
  const gap = 110;
  const cardW = (CONTENT_W - gap) / 2;
  const inner = cardW - 64;
  const sides = [
    { side: spec.compare.left, x: PAD, color: theme.a, edge: 'edgeA' },
    { side: spec.compare.right, x: PAD + cardW + gap, color: theme.b, edge: 'edgeB' },
  ].map((card) => ({
    ...card,
    title: fit({ measure, weight: 800, size: 40, minSize: 30, text: card.side.title, width: inner, maxLines: 2 }),
    note: fit({ measure, weight: 500, size: 25, minSize: 21, text: card.side.note, width: inner, maxLines: 2 }),
  }));
  const blockHeight = (block, lineHeight) => block.size + (block.lines.length - 1) * block.size * lineHeight;
  // Both cards take the taller card's height, so they line up.
  const cardH = Math.max(...sides.map((c) => 30 + 64 + 24 + blockHeight(c.title, 1.1) + 14 + blockHeight(c.note, 1.3) + 32));

  let svg = '';
  for (const card of sides) {
    svg += glass({ theme, x: card.x, y: top, w: cardW, h: cardH, edge: card.edge, glow: card.color });
    svg += iconTile({ name: card.side.icon, x: card.x + 32, y: top + 30, size: 64, color: card.color });
    const title = textBlock({ block: card.title, x: card.x + 32, top: top + 30 + 64 + 24, lineHeight: 1.1, weight: 800, fill: '#FFFFFF' });
    const note = textBlock({ block: card.note, x: card.x + 32, top: title.bottom + 14, lineHeight: 1.3, weight: 500, fill: theme.muted });
    svg += title.svg + note.svg;
  }
  const cx = PAD + cardW + gap / 2;
  const cy = top + cardH / 2;
  svg += `<circle cx="${r1(cx)}" cy="${r1(cy)}" r="64" fill="${theme.a}" fill-opacity=".30" filter="url(#blur)"/>`
    + `<circle cx="${r1(cx)}" cy="${r1(cy)}" r="44" fill="url(#badge)"/>`
    + textLine({ text: 'VS', x: cx, base: cy + 11, weight: 800, size: 31, fill: theme.bg[0], anchor: 'middle' });
  return { svg, bottom: top + cardH };
}

function codeTokens({ line, theme, highlight }) {
  const tokens = line.match(/\/\/.*$|'(?:[^'\\]|\\.)*'?|"(?:[^"\\]|\\.)*"?|`[^`]*`?|@[\w.]+|\s+|[A-Za-z_$][\w$-]*|\d[\w.]*|./g) ?? [];
  return tokens.map((token) => {
    let fill = CODE_COLORS.text;
    let weight = 500;
    if (token.startsWith('//')) fill = CODE_COLORS.comment;
    else if (/^['"`]/.test(token)) fill = CODE_COLORS.string;
    else if (token.startsWith('@')) fill = theme.a;
    else if (highlight.has(token)) { fill = theme.a; weight = 700; } else if (CODE_KEYWORDS.has(token)) { fill = theme.b; weight = 700; } else if (/^[{}()[\];:,.=<>]$/.test(token)) fill = CODE_COLORS.punctuation;
    return `<tspan fill="${fill}" font-weight="${weight}">${esc(token)}</tspan>`;
  }).join('');
}

function codeSection({ spec, theme, measure, top, maxBottom }) {
  const { file, lines } = spec.code;
  // Identifiers the takeaways explain (e.g. cuid) light up in the snippet too.
  const highlight = new Set(spec.points.filter((p) => p.code).map((p) => p.title));
  const bar = 60;
  const chrome = bar + 26 + 22;
  const widest = (size) => Math.max(...lines.map((text) => measure({ kind: 'mono', weight: 700, size, text })));
  const lineHeight = (size) => Math.round(size * 1.55);
  let size = 28;
  while (size > CODE_MIN_SIZE && (widest(size) > CONTENT_W - 72 || top + chrome + lines.length * lineHeight(size) > maxBottom)) size -= 1;
  if (widest(size) > CONTENT_W - 72) throw new Error('the code snippet is too wide for the image');

  const height = chrome + lines.length * lineHeight(size);
  let svg = glass({ theme, x: PAD, y: top, w: CONTENT_W, h: height, radius: 28, edge: 'edgeA', glow: theme.a, glowOpacity: 0.28, fill: '#030712', fillOpacity: 0.72 });
  svg += [0, 1, 2].map((i) => `<circle cx="${PAD + 34 + i * 26}" cy="${top + bar / 2}" r="8" fill="#FFFFFF" fill-opacity="${r1(0.35 - i * 0.08)}"/>`).join('');
  svg += textLine({ text: file, x: PAD + 128, base: top + bar / 2 + 8, kind: 'mono', weight: 500, size: 22, fill: theme.muted, opacity: 0.85 });
  svg += `<line x1="${PAD + 2}" y1="${top + bar}" x2="${PAD + CONTENT_W - 2}" y2="${top + bar}" stroke="#FFFFFF" stroke-opacity=".10" stroke-width="2"/>`;
  lines.forEach((line, i) => {
    const base = top + bar + 26 + size * 0.8 + i * lineHeight(size);
    svg += `<text x="${PAD + 36}" y="${r1(base)}" font-family="${FONT.mono}" font-size="${size}" xml:space="preserve">${codeTokens({ line, theme, highlight })}</text>`;
  });
  return { svg, bottom: top + height };
}

function pointsSection({ spec, theme, measure, top, bottom, maxRow }) {
  const n = spec.points.length;
  const rowH = Math.min(maxRow, (bottom - top - ROW_GAP * (n - 1)) / n);
  if (rowH < ROW_MIN) throw new Error('the image has too much text to fit');
  // With room to spare (the list layout), the rows sit centred in it rather than under the header.
  const start = top + (bottom - top - (n * rowH + (n - 1) * ROW_GAP)) / 2;
  const roomy = rowH >= 130;

  return spec.points.map((point, i) => {
    const y = start + i * (rowH + ROW_GAP);
    const color = i % 2 === 0 ? theme.a : theme.b;
    const tile = roomy ? 84 : Math.min(66, rowH - 22);
    const textX = PAD + 22 + tile + 26;
    const width = CONTENT_W - (textX - PAD) - 24;
    const kind = point.code ? 'mono' : 'sans';
    const title = fit({ measure, kind, weight: 700, size: roomy ? 36 : 31, minSize: 22, text: point.title, width, maxLines: 1 });
    const note = fit({ measure, weight: 500, size: roomy ? 27 : 24, minSize: 18, text: point.note, width, maxLines: roomy ? 2 : 1 });
    // Centred on what the eye sees: from the title's cap height to the last note baseline.
    const span = 0.73 * title.size + note.size * 1.5 + (note.lines.length - 1) * note.size * 1.3;
    const titleBase = y + (rowH - span) / 2 + 0.73 * title.size;
    return `<rect x="${PAD}" y="${r1(y)}" width="${CONTENT_W}" height="${r1(rowH)}" rx="26" fill="${theme.bg[0]}" fill-opacity=".7"/>`
      + `<rect x="${PAD}" y="${r1(y)}" width="${CONTENT_W}" height="${r1(rowH)}" rx="26" fill="#FFFFFF" fill-opacity=".06" stroke="#FFFFFF" stroke-opacity=".12" stroke-width="2"/>`
      + iconTile({ name: point.icon, x: PAD + 22, y: y + (rowH - tile) / 2, size: tile, color })
      + textLine({ text: title.lines[0], x: textX, base: titleBase, kind, weight: 700, size: title.size, fill: point.code ? color : '#FFFFFF' })
      + note.lines.map((text, j) => textLine({ text, x: textX, base: titleBase + note.size * 1.5 + j * note.size * 1.3, weight: 500, size: note.size, fill: theme.muted })).join('');
  }).join('');
}

function footer({ spec, theme, measure }) {
  const question = fit({ measure, weight: 700, size: 29, minSize: 22, text: spec.question, width: CONTENT_W - 52, maxLines: 1 });
  return `<line x1="${PAD}" y1="${FOOTER_RULE}" x2="${WIDTH - PAD}" y2="${FOOTER_RULE}" stroke="${theme.a}" stroke-opacity=".28" stroke-width="2"/>`
    + icon({ name: 'message-circle', x: PAD, y: FOOTER_BASELINE - question.size * 0.95, size: 34, color: theme.a })
    + textLine({ text: question.lines[0], x: PAD + 50, base: FOOTER_BASELINE, weight: 700, size: question.size, fill: '#FFFFFF', opacity: 0.92 });
}

// `spec` is a draft's infographic (see draftSchema.js); `measure({ kind, weight, size, text })` returns pixels.
// Throws when the text can't fit, so the caller can fall back to the manual image idea.
function buildInfographicSvg({ spec, date, seed = date, measure }) {
  if (!LAYOUTS.includes(spec?.layout)) throw new Error(`unknown image layout "${spec?.layout}"`);
  const theme = themeForDate(date);
  const ctx = { spec, theme, measure };
  const head = header(ctx);
  const n = spec.points.length;
  const mainTop = head.bottom + SECTION_GAP;
  // The middle section may only grow as far as still leaves every takeaway row its minimum height.
  const mainLimit = CONTENT_BOTTOM - POINTS_GAP - (n * ROW_MIN + (n - 1) * ROW_GAP);
  let main = null;
  if (spec.layout === 'compare') main = compareSection({ ...ctx, top: mainTop });
  if (spec.layout === 'code') main = codeSection({ ...ctx, top: mainTop, maxBottom: mainLimit });
  if (main && main.bottom > mainLimit) throw new Error('the image has too much text to fit');
  const points = pointsSection({
    ...ctx,
    top: main ? main.bottom + POINTS_GAP : mainTop,
    bottom: CONTENT_BOTTOM,
    maxRow: main ? 118 : 170,
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">`
    + background({ theme, random: seededRandom(seed) }) + head.svg + (main?.svg ?? '') + points + footer(ctx) + '</svg>';
}

module.exports = { buildInfographicSvg, themeForDate, THEMES, FONT, LAYOUTS, WIDTH, HEIGHT };
