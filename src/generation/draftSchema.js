const { ICON_NAMES } = require('../image/icons');
const { LAYOUTS } = require('../image/infographic');

// Hard caps for the text the bot draws onto the image. The schema descriptions ask for less, so a
// model that overshoots a little still fits; beyond these, the draft goes out with the image idea only.
const IMAGE_TEXT_LIMITS = {
  LABEL_MAX: 34,
  HEADLINE_MAX: 48,
  SUBTITLE_MAX: 70,
  SIDE_TITLE_MAX: 26,
  SIDE_NOTE_MAX: 54,
  FILE_MAX: 34,
  CODE_LINES_MAX: 8,
  CODE_LINE_MAX: 56,
  POINTS_MIN: 3,
  POINTS_MAX: 4,
  POINT_TITLE_MAX: 40,
  POINT_NOTE_MAX: 62,
  QUESTION_MAX: 66,
};

const ICON = { type: 'string', enum: ICON_NAMES, description: 'The icon whose name best fits the meaning.' };
const SIDE = {
  type: 'object',
  properties: {
    icon: ICON,
    title: { type: 'string', description: "The option's name, at most 22 characters." },
    note: { type: 'string', description: 'What defines it, at most 50 characters.' },
  },
  required: ['icon', 'title', 'note'],
  propertyOrdering: ['icon', 'title', 'note'],
};
const INFOGRAPHIC = {
  type: 'object',
  description: 'Exact text for the portrait image the bot draws for this post. Shown word for word; no emojis.',
  properties: {
    label: { type: 'string', description: 'Topic label for the pill at the top, at most 30 characters, e.g. "SAP CAP · CDS modeling".' },
    headline: { type: 'string', description: "The post's main idea as a title, at most 6 words and 40 characters." },
    subtitle: { type: 'string', description: 'One supporting line, at most 8 words and 60 characters.' },
    layout: { type: 'string', enum: LAYOUTS, description: '"compare" for two contrasted options, "code" when a snippet is the heart of the post, otherwise "list".' },
    compare: {
      type: 'object',
      description: 'Only with layout "compare".',
      properties: { left: SIDE, right: SIDE },
      required: ['left', 'right'],
      propertyOrdering: ['left', 'right'],
    },
    code: {
      type: 'object',
      description: 'Only with layout "code".',
      properties: {
        file: { type: 'string', description: 'A plausible file path for the snippet, at most 30 characters, e.g. "db/schema.cds".' },
        lines: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 7, description: 'The snippet line by line with its indentation, at most 52 characters per line.' },
      },
      required: ['file', 'lines'],
      propertyOrdering: ['file', 'lines'],
    },
    points: {
      type: 'array',
      minItems: 3,
      maxItems: 4,
      description: 'Takeaways from the post: exactly 3 with "compare" or "code", 3 or 4 with "list".',
      items: {
        type: 'object',
        properties: {
          icon: ICON,
          title: { type: 'string', description: 'At most 36 characters.' },
          note: { type: 'string', description: 'One explaining line, at most 55 characters.' },
          code: { type: 'boolean', description: 'true when the title is only a code identifier, such as cuid.' },
        },
        required: ['icon', 'title', 'note'],
        propertyOrdering: ['icon', 'title', 'note', 'code'],
      },
    },
    question: { type: 'string', description: "The post's closing question, shortened to at most 60 characters." },
  },
  required: ['label', 'headline', 'subtitle', 'layout', 'points', 'question'],
  propertyOrdering: ['label', 'headline', 'subtitle', 'layout', 'compare', 'code', 'points', 'question'],
};

// JSON Schema sent to the model as the required response shape.
const DRAFT_SCHEMA = {
  type: 'object',
  properties: {
    hook: { type: 'string', description: 'First line of the post, starting with one emoji, one line, at most 150 characters.' },
    text: { type: 'string', description: 'Complete post starting with the hook, 800-1500 characters, 5-10 emojis, an emoji-marked list, no hashtags.' },
    hashtags: {
      type: 'array',
      items: { type: 'string' },
      minItems: 3,
      maxItems: 5,
      description: 'Hashtags starting with #, no spaces.',
    },
    imagePrompt: { type: 'string', description: 'Prompt for a portrait 4:5 infographic of this post, with its exact on-image text in double quotes, no logos.' },
    infographic: INFOGRAPHIC,
  },
  required: ['hook', 'text', 'hashtags', 'imagePrompt', 'infographic'],
  additionalProperties: false,
  propertyOrdering: ['hook', 'text', 'hashtags', 'imagePrompt', 'infographic'],
};

const LIMITS = {
  // The hook is the single line LinkedIn shows before "…see more" (about 210 characters fit), so it must be one short line.
  HOOK_MAX: 150,
  // LinkedIn allows 3000 characters, including the disclaimer line and hashtags appended at post time.
  TEXT_MAX: 2700,
  TEXT_MIN: 400,
  TEXT_TARGET_MIN: 800,
  TEXT_TARGET_MAX: 1500,
  HASHTAGS_MIN: 3,
  HASHTAGS_MAX: 5,
  IMAGE_PROMPT_MIN: 20,
  // An infographic prompt carries its exact on-image text, so it is longer than a mood description.
  IMAGE_PROMPT_MAX: 2000,
  // The style asks for 5-10; a warning (not an error) keeps a good draft usable when the model drifts a little.
  EMOJIS_MIN: 4,
  EMOJIS_MAX: 12,
};

const HASHTAG = /^#[\p{L}\p{N}_]+$/u;
// Keycaps like 1️⃣ are digit + U+FE0F + U+20E3; counting the U+20E3 makes each count once.
const EMOJI = /\p{Extended_Pictographic}|⃣/gu;
const countEmojis = (text) => text.match(EMOJI)?.length ?? 0;
// The bundled fonts have no emoji glyphs, so emojis (with their joiners and selectors) would draw as boxes.
const EMOJI_PARTS = /[\p{Extended_Pictographic}\u{FE0F}\u{20E3}\u{200D}]/gu;
const FALLBACK_ICON = 'circle-check';

const str = (v) => (typeof v === 'string' ? v.trim() : '');
const imageText = (v) => str(v).replace(EMOJI_PARTS, '').replace(/\s+/g, ' ').trim();
const iconName = (v) => (ICON_NAMES.includes(v) ? v : FALLBACK_ICON);

function normalizeInfographic(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const side = (s) => ({ icon: iconName(s?.icon), title: imageText(s?.title), note: imageText(s?.note) });
  const info = {
    label: imageText(raw.label),
    headline: imageText(raw.headline),
    subtitle: imageText(raw.subtitle),
    layout: str(raw.layout),
    points: (Array.isArray(raw.points) ? raw.points : []).map((p) => ({
      icon: iconName(p?.icon),
      title: imageText(p?.title),
      note: imageText(p?.note),
      code: p?.code === true,
    })),
    question: imageText(raw.question),
  };
  if (info.layout === 'compare') info.compare = { left: side(raw.compare?.left), right: side(raw.compare?.right) };
  if (info.layout === 'code') {
    // Indentation is part of the code, so only tabs and trailing spaces are touched.
    const lines = (Array.isArray(raw.code?.lines) ? raw.code.lines : [])
      .flatMap((l) => (typeof l === 'string' ? l.split(/\r?\n/) : []))
      .map((l) => l.replace(/\t/g, '  ').replace(/\s+$/, ''));
    while (lines.length && !lines[0]) lines.shift();
    while (lines.length && !lines.at(-1)) lines.pop();
    info.code = { file: imageText(raw.code?.file), lines };
  }
  return info;
}

// Reasons the bot can't draw this image text; empty when it can.
function infographicProblems(info) {
  if (!info) return ['no image text came back'];
  const L = IMAGE_TEXT_LIMITS;
  const problems = [];
  const check = (value, max, what) => {
    if (!value) problems.push(`${what} is empty`);
    else if (value.length > max) problems.push(`${what} is ${value.length} characters (max ${max})`);
  };
  check(info.label, L.LABEL_MAX, 'the label');
  check(info.headline, L.HEADLINE_MAX, 'the headline');
  check(info.subtitle, L.SUBTITLE_MAX, 'the subtitle');
  check(info.question, L.QUESTION_MAX, 'the question');
  if (!LAYOUTS.includes(info.layout)) problems.push(`unknown layout "${info.layout}"`);
  if (info.layout === 'compare') {
    for (const [name, side] of Object.entries(info.compare)) {
      check(side.title, L.SIDE_TITLE_MAX, `the ${name} title`);
      check(side.note, L.SIDE_NOTE_MAX, `the ${name} note`);
    }
  }
  if (info.layout === 'code') {
    check(info.code.file, L.FILE_MAX, 'the file name');
    if (!info.code.lines.length) problems.push('the code snippet is empty');
    if (info.code.lines.length > L.CODE_LINES_MAX) problems.push(`the code has ${info.code.lines.length} lines (max ${L.CODE_LINES_MAX})`);
    info.code.lines.forEach((line, i) => {
      if (line.length > L.CODE_LINE_MAX) problems.push(`code line ${i + 1} is ${line.length} characters (max ${L.CODE_LINE_MAX})`);
    });
  }
  if (info.points.length < L.POINTS_MIN || info.points.length > L.POINTS_MAX) {
    problems.push(`expected ${L.POINTS_MIN}-${L.POINTS_MAX} takeaways, got ${info.points.length}`);
  }
  info.points.forEach((p, i) => {
    check(p.title, L.POINT_TITLE_MAX, `takeaway ${i + 1}'s title`);
    check(p.note, L.POINT_NOTE_MAX, `takeaway ${i + 1}'s note`);
  });
  return problems;
}

// Deterministic clean-up first, then checks. Failures are reported, never sent back to the
// model for repair: the free tier allows only a few calls per minute.
function normalizeDraft(raw) {
  const hashtags = Array.isArray(raw?.hashtags) ? raw.hashtags : [];
  return {
    hook: str(raw?.hook),
    text: str(raw?.text).replace(/\r\n/g, '\n'),
    hashtags: [...new Set(hashtags.map((t) => str(t).replace(/\s+/g, '')).filter(Boolean)
      .map((t) => (t.startsWith('#') ? t : `#${t}`)))],
    imagePrompt: str(raw?.imagePrompt),
    infographic: normalizeInfographic(raw?.infographic),
  };
}

// The image text is checked separately (infographicProblems): a draft with unusable image text
// is still a good post, sent with the manual image idea instead.
function validateDraft(draft) {
  const errors = [];
  const warnings = [];
  const { hook, text, hashtags, imagePrompt } = draft;

  if (!hook) errors.push('hook is empty');
  if (/[\n\t]/.test(hook) || / {4,}/.test(hook)) errors.push('hook must be one line without tabs or long space runs');
  if (hook.length > LIMITS.HOOK_MAX) errors.push(`hook is ${hook.length} chars (max ${LIMITS.HOOK_MAX})`);

  if (text.length < LIMITS.TEXT_MIN) errors.push(`text is ${text.length} chars (min ${LIMITS.TEXT_MIN})`);
  if (text.length > LIMITS.TEXT_MAX) errors.push(`text is ${text.length} chars (max ${LIMITS.TEXT_MAX})`);
  if (text.length >= LIMITS.TEXT_MIN && text.length < LIMITS.TEXT_TARGET_MIN) warnings.push(`text is short (${text.length} chars, target ${LIMITS.TEXT_TARGET_MIN}-${LIMITS.TEXT_TARGET_MAX})`);
  if (text.length > LIMITS.TEXT_TARGET_MAX && text.length <= LIMITS.TEXT_MAX) warnings.push(`text is long (${text.length} chars, target ${LIMITS.TEXT_TARGET_MIN}-${LIMITS.TEXT_TARGET_MAX})`);
  if (/\*\*|```|^#{1,6}\s/m.test(text)) warnings.push('text contains Markdown, which LinkedIn shows literally');
  // Models like to invent statistics; a number with % is the most common form, so the owner checks it before posting.
  const imageWords = JSON.stringify(draft.infographic ?? '');
  if ([text, imagePrompt, imageWords].some((t) => /\d\s?%/.test(t))) warnings.push('the post or image states a percentage: check it is a documented fact, not a guess');
  const emojis = countEmojis(text);
  if (emojis < LIMITS.EMOJIS_MIN) warnings.push(`text has only ${emojis} emoji${emojis === 1 ? '' : 's'} (target 5-10)`);
  if (emojis > LIMITS.EMOJIS_MAX) warnings.push(`text has ${emojis} emojis (target 5-10)`);

  if (hashtags.length < LIMITS.HASHTAGS_MIN || hashtags.length > LIMITS.HASHTAGS_MAX) {
    errors.push(`expected ${LIMITS.HASHTAGS_MIN}-${LIMITS.HASHTAGS_MAX} hashtags, got ${hashtags.length}`);
  }
  const badTags = hashtags.filter((t) => !HASHTAG.test(t));
  if (badTags.length) errors.push(`invalid hashtags: ${badTags.join(', ')}`);

  if (imagePrompt.length < LIMITS.IMAGE_PROMPT_MIN) errors.push('imagePrompt is missing or too short');
  if (imagePrompt.length > LIMITS.IMAGE_PROMPT_MAX) errors.push(`imagePrompt is ${imagePrompt.length} chars (max ${LIMITS.IMAGE_PROMPT_MAX})`);

  return { errors, warnings };
}

module.exports = {
  DRAFT_SCHEMA,
  LIMITS,
  IMAGE_TEXT_LIMITS,
  normalizeDraft,
  normalizeInfographic,
  infographicProblems,
  validateDraft,
  countEmojis,
};
