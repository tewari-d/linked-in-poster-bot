// Turns a draft's infographic text into a PNG: real font metrics for line breaking, then resvg
// (WebAssembly, so it runs the same on Windows and on the phone's arm64 Termux) to rasterise.
const fs = require('node:fs');
const path = require('node:path');
const opentype = require('opentype.js');
const { Resvg, initWasm } = require('@resvg/resvg-wasm');
const { buildInfographicSvg, FONT } = require('./infographic');

const FONTS_DIR = path.join(__dirname, 'fonts');
const FONT_FILES = [
  { kind: 'sans', weight: 500, file: 'Inter-Medium.ttf' },
  { kind: 'sans', weight: 700, file: 'Inter-Bold.ttf' },
  { kind: 'sans', weight: 800, file: 'Inter-ExtraBold.ttf' },
  { kind: 'mono', weight: 500, file: 'JetBrainsMono-Medium.ttf' },
  { kind: 'mono', weight: 700, file: 'JetBrainsMono-Bold.ttf' },
];

// The WASM module may be initialised only once per process.
let wasmReady = null;
const loadWasm = () => {
  wasmReady ??= initWasm(fs.readFileSync(require.resolve('@resvg/resvg-wasm/index_bg.wasm')));
  return wasmReady;
};

function createInfographicRenderer({ fontsDir = FONTS_DIR } = {}) {
  const fonts = new Map();
  const fontBuffers = [];
  for (const { kind, weight, file } of FONT_FILES) {
    const bytes = fs.readFileSync(path.join(fontsDir, file));
    fontBuffers.push(new Uint8Array(bytes));
    fonts.set(`${kind}:${weight}`, opentype.parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)));
  }

  // Glyph advances plus pair kerning. opentype.js's full text shaping fails on one of Inter's
  // substitution tables, and line breaking only needs widths.
  function measure({ kind = 'sans', weight, size, text }) {
    const font = fonts.get(`${kind}:${weight}`);
    if (!font) throw new Error(`No ${kind} font with weight ${weight} in ${fontsDir}`);
    let width = 0;
    let previous = null;
    for (const ch of text) {
      const glyph = font.charToGlyph(ch);
      if (previous) {
        try { width += font.getKerningValue(previous, glyph); } catch { /* no kerning for this pair */ }
      }
      width += glyph.advanceWidth;
      previous = glyph;
    }
    return (width * size) / font.unitsPerEm;
  }

  async function draw({ spec, date, seed }) {
    await loadWasm();
    const svg = buildInfographicSvg({ spec, date, seed, measure });
    // No system fonts: the bundled ones make the image identical on the laptop and the phone.
    const resvg = new Resvg(svg, { font: { fontBuffers, defaultFontFamily: FONT.sans, loadSystemFonts: false } });
    // WASM memory is not garbage-collected, and the bot runs for months, so both objects are freed.
    try {
      const image = resvg.render();
      try {
        return Buffer.from(image.asPng());
      } finally {
        image.free();
      }
    } finally {
      resvg.free();
    }
  }

  return { ready: loadWasm, draw, measure };
}

module.exports = { createInfographicRenderer };
