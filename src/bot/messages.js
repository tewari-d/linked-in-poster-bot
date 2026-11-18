// Telegram message texts and buttons. Messages use parse_mode HTML, so every dynamic value is escaped.

const ACTION = {
  POST: 'post',
  POST_TEXT_ONLY: 'posttext',
  WAIT: 'wait',
  SKIP: 'skip',
  REGENERATE: 'regen',
  DRAFT: 'draft',
  CONFIRM_POSTED: 'seen',
  NOT_POSTED: 'notposted',
};

const STATUS_LABEL = {
  GENERATED: 'not sent yet',
  SENT: 'waiting for you',
  POSTING: 'being posted',
  POSTED: 'posted',
  SKIPPED: 'skipped',
  EXPIRED: 'expired',
  FAILED: 'failed',
  UNKNOWN: 'maybe posted (check LinkedIn)',
};

const escapeHtml = (value) => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function formatDay(isoDate) {
  return new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })
    .format(new Date(`${isoDate}T00:00:00Z`));
}

// callback_data is limited to 64 bytes; "regen:" plus a draft id stays well under it.
const button = (text, action, arg) => ({ text, callback_data: `${action}:${arg}` });
const keyboard = (rows) => ({ inline_keyboard: rows });

const controlKeyboard = (draftId) => keyboard([[
  button('✅ Post', ACTION.POST, draftId),
  button('⏭ Skip', ACTION.SKIP, draftId),
  button('🔄 Regenerate', ACTION.REGENERATE, draftId),
]]);

const textOnlyKeyboard = (draftId) => keyboard([[
  button('📝 Post text only', ACTION.POST_TEXT_ONLY, draftId),
  button('⏳ Wait', ACTION.WAIT, draftId),
]]);

const retryKeyboard = ({ action, arg }) => keyboard([[button('🔄 Try again', action, arg)]]);

const uncertainKeyboard = (draftId) => keyboard([[
  button("✅ It's on LinkedIn", ACTION.CONFIRM_POSTED, draftId),
  button('↩️ Not there', ACTION.NOT_POSTED, draftId),
]]);

const connectKeyboard = (url) => keyboard([[{ text: '🔗 Connect LinkedIn', url }]]);

function parseCallback(data = '') {
  const i = data.indexOf(':');
  return i < 0 ? { action: data, arg: '' } : { action: data.slice(0, i), arg: data.slice(i + 1) };
}

// Laid out exactly as it will appear on LinkedIn: text, disclaimer, hashtags.
function postMessage({ draft, disclaimer = '' }) {
  return [
    `📝 <b>Draft for ${formatDay(draft.date)}</b>`,
    `${escapeHtml(draft.category)} · ${escapeHtml(draft.subtopic)} · <i>${escapeHtml(draft.format)}</i>`,
    '',
    escapeHtml(draft.text),
    ...(disclaimer ? ['', escapeHtml(disclaimer)] : []),
    '',
    escapeHtml(draft.hashtags.join(' ')),
  ].join('\n');
}

function imagePromptMessage({ draft, warnings = [] }) {
  const lines = [
    '🖼 <b>Image idea</b>, portrait 4:5 (tap the text to copy it):',
    `<code>${escapeHtml(draft.imagePrompt)}</code>`,
    '',
    'Send me the image here, ideally as a <b>File</b> so Telegram keeps full quality. Then tap ✅ Post.',
  ];
  for (const warning of warnings) lines.push(`⚠️ ${escapeHtml(warning)}`);
  return lines.join('\n');
}

// Telegram allows at most 1024 characters under an image.
const CAPTION_MAX = 1024;

// The caption of the drawn image, which also carries the buttons. Plain text (no parse_mode), so
// cutting it to the caption limit can never break an HTML entity.
function drawnImageCaption({ warnings = [] }) {
  const lines = [
    '🖼 The image for the post above.',
    'Prefer your own? Send it here as a File and it replaces this one.',
    ...warnings.map((warning) => `⚠️ ${warning}`),
  ];
  const caption = lines.join('\n');
  return caption.length <= CAPTION_MAX ? caption : `${caption.slice(0, CAPTION_MAX - 1)}…`;
}

function publishedMessage({ result, draft }) {
  if (result.dryRun) {
    const image = result.imageBytes
      ? `with the image (${Math.round(result.imageBytes / 1024)} KB, downloaded from Telegram OK)`
      : 'without an image';
    return `🧪 <b>Dry run</b>: nothing was posted to LinkedIn.\nIt would post ${draft.text.length} characters + ${draft.hashtags.length} hashtags ${image}.`;
  }
  const image = result.imageBytes ? ' with the image' : '';
  return `✅ Posted to LinkedIn${image}${result.url ? `: ${escapeHtml(result.url)}` : '.'}`;
}

function uncertainMessage({ error }) {
  return [
    `⚠️ <b>Not sure the post went out.</b> ${escapeHtml(error)}`,
    '',
    'Please check your LinkedIn profile, then tell me:',
    "✅ It's on LinkedIn: I mark it posted.",
    "↩️ Not there: the draft goes back to waiting and you can tap Post again.",
  ].join('\n');
}

// One line for /status and /linkedin. `configured` is false when the app's LinkedIn keys are missing.
function linkedinLine({ configured, connection }) {
  if (!configured) return 'LinkedIn: not set up (LINKEDIN_CLIENT_ID / LINKEDIN_CLIENT_SECRET missing in .env).';
  if (connection.connected) {
    const who = connection.name ? ` as ${escapeHtml(connection.name)}` : '';
    return `LinkedIn: connected${who}, access valid until ${formatDay(connection.expiresAt.slice(0, 10))} (${connection.daysLeft} days).`;
  }
  return connection.expired ? 'LinkedIn: access <b>expired</b>. Send /linkedin to reconnect.' : 'LinkedIn: not connected. Send /linkedin to connect.';
}

function connectMessage({ connection }) {
  const intro = connection.connected
    ? 'Renew LinkedIn access (it lasts 60 days and cannot be renewed automatically):'
    : 'Connect your LinkedIn profile so I can post for you:';
  return [
    intro,
    '1. Tap the button and sign in to LinkedIn if asked.',
    '2. Tap <b>Allow</b>.',
    '3. If the page after that does not load (for example on your phone), copy the whole address from the browser and send it to me here.',
    '',
    'The link is single-use; send /linkedin again for a fresh one.',
  ].join('\n');
}

function helpMessage({ sendTime, timezone, dryRun, drawsImages = false }) {
  return [
    `👋 I write one SAP post draft for you every day at <b>${sendTime}</b> (${escapeHtml(timezone)}).`,
    '',
    drawsImages ? '1. Read the draft and check the image I drew for it.' : '1. Read the draft and make an image with the image idea.',
    drawsImages ? '2. Prefer your own image? Send it here (as a File for best quality) and it replaces mine.' : '2. Send the image here (as a File for best quality).',
    '3. ✅ Post publishes it, ⏭ Skip drops it, 🔄 Regenerate writes a new version.',
    '',
    '/draft: create today\'s draft now (or /draft YYYY-MM-DD to preview another day\'s topic)',
    '/status: show the latest draft',
    '/linkedin: connect or renew LinkedIn access',
    '/help: this message',
    dryRun ? '\n🧪 Dry-run mode: nothing is posted to LinkedIn yet.' : '',
  ].join('\n').trim();
}

module.exports = {
  ACTION,
  STATUS_LABEL,
  escapeHtml,
  formatDay,
  keyboard,
  controlKeyboard,
  textOnlyKeyboard,
  retryKeyboard,
  uncertainKeyboard,
  connectKeyboard,
  parseCallback,
  postMessage,
  imagePromptMessage,
  drawnImageCaption,
  publishedMessage,
  uncertainMessage,
  linkedinLine,
  connectMessage,
  helpMessage,
};
