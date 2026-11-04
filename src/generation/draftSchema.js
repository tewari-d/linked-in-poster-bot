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
  },
  required: ['hook', 'text', 'hashtags', 'imagePrompt'],
  additionalProperties: false,
  propertyOrdering: ['hook', 'text', 'hashtags', 'imagePrompt'],
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

// Deterministic clean-up first, then checks. Failures are reported, never sent back to the
// model for repair: the free tier allows only a few calls per minute.
function normalizeDraft(raw) {
  const str = (v) => (typeof v === 'string' ? v.trim() : '');
  const hashtags = Array.isArray(raw?.hashtags) ? raw.hashtags : [];
  return {
    hook: str(raw?.hook),
    text: str(raw?.text).replace(/\r\n/g, '\n'),
    hashtags: [...new Set(hashtags.map((t) => str(t).replace(/\s+/g, '')).filter(Boolean)
      .map((t) => (t.startsWith('#') ? t : `#${t}`)))],
    imagePrompt: str(raw?.imagePrompt),
  };
}

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
  if (/\d\s?%/.test(text) || /\d\s?%/.test(imagePrompt)) warnings.push('the post or image states a percentage: check it is a documented fact, not a guess');
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

module.exports = { DRAFT_SCHEMA, LIMITS, normalizeDraft, validateDraft, countEmojis };
