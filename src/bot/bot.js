const { dateInZone, assertIsoDate } = require('../time');
const { isDailyRunDue } = require('./schedule');
const { parsePastedRedirect } = require('../linkedin/auth');
const msg = require('./messages');

const { ACTION } = msg;
// Bots cannot download files larger than this through the Bot API.
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const IMAGE_MIME_TYPES = new Set(['image/jpeg', 'image/png']);
// LinkedIn tokens last 60 days and cannot be refreshed by self-serve apps, so the owner is reminded early.
const RENEW_REMINDER_DAYS = 7;

function extractImage(message) {
  if (Array.isArray(message.photo) && message.photo.length > 0) {
    // Telegram lists photo sizes smallest first.
    const largest = message.photo[message.photo.length - 1];
    return { fileId: largest.file_id, kind: 'photo', mimeType: 'image/jpeg', width: largest.width, height: largest.height, fileSize: largest.file_size };
  }
  const doc = message.document;
  if (!IMAGE_MIME_TYPES.has(doc?.mime_type)) return { error: 'Please send a JPG or PNG image.' };
  return { fileId: doc.file_id, kind: 'document', mimeType: doc.mime_type, fileName: doc.file_name, fileSize: doc.file_size };
}

// `linkedin` (the connection from linkedin/auth.js) is null while the LinkedIn app keys are not in .env.
function createBot({ api, store, makeDraft, publisher, linkedin = null, config, log = console.log, clock = () => new Date() }) {
  const ownerId = String(config.telegram.ownerChatId);
  const { timezone, sendTime, catchupCutoff } = config;

  const isOwner = (id) => String(id) === ownerId;
  const today = () => dateInZone({ date: clock(), timeZone: timezone });
  const nowIso = () => clock().toISOString();
  const findDraft = (id) => store.load().drafts.find((d) => d.id === id);

  const send = (text, extra = {}) => api.sendMessage({
    chat_id: ownerId,
    text,
    parse_mode: 'HTML',
    link_preview_options: { is_disabled: true },
    ...extra,
  });

  function updateDraft(id, mutate) {
    const state = store.load();
    const draft = state.drafts.find((d) => d.id === id);
    mutate(draft);
    store.save(state);
    return draft;
  }

  // Old buttons are removed so they can't be tapped later; the status checks still guard if they are.
  async function clearButtons(...messageIds) {
    for (const messageId of new Set(messageIds.filter(Boolean))) {
      try {
        await api.editMessageReplyMarkup({ chat_id: ownerId, message_id: messageId, reply_markup: msg.keyboard([]) });
      } catch (err) {
        if (!/not modified/i.test(err.message)) log(`Could not clear buttons on message ${messageId}: ${err.message}`);
      }
    }
  }

  async function sendControls({ draftId, text }) {
    const sent = await send(text, { reply_markup: msg.controlKeyboard(draftId) });
    updateDraft(draftId, (d) => { d.telegram = { ...d.telegram, controlMessageId: sent.message_id }; });
  }

  async function deliverDraft({ date, extra = '', retry = { action: ACTION.DRAFT, arg: date } }) {
    const previous = store.load().drafts.filter((d) => d.status === 'SENT');
    let result;
    try {
      result = await makeDraft({ date, extra });
    } catch (err) {
      // Never retried automatically: the free Gemini tier allows only a few calls per minute.
      log(`Draft generation failed: ${err.message}`);
      await send(`⚠️ Could not create the draft for ${msg.formatDay(date)}:\n${msg.escapeHtml(err.message)}`, { reply_markup: msg.retryKeyboard(retry) });
      return;
    }
    // createDraft has expired the previous pending draft; take its buttons away too.
    await clearButtons(...previous.map((d) => d.telegram?.controlMessageId));

    const { draft, warnings } = result;
    const post = await send(msg.postMessage({ draft, disclaimer: config.postDisclaimer }));
    const controls = await send(msg.imagePromptMessage({ draft, warnings }), { reply_markup: msg.controlKeyboard(draft.id) });
    updateDraft(draft.id, (d) => {
      d.status = 'SENT';
      d.sentAt = nowIso();
      d.telegram = { postMessageId: post.message_id, controlMessageId: controls.message_id };
    });
    log(`Sent draft ${draft.id}`);
  }

  async function onDraftRequest(date) {
    const waiting = store.load().drafts.find((d) => d.date === date && d.status === 'SENT');
    if (waiting) {
      await send(`The draft for ${msg.formatDay(date)} is already waiting above. Tap 🔄 Regenerate on it for a new version.`);
      return;
    }
    await send('✍️ Writing the draft…');
    await deliverDraft({ date });
  }

  async function notPending({ draft, verb, messageId }) {
    await clearButtons(messageId);
    await send(`That draft is ${draft ? msg.STATUS_LABEL[draft.status] : 'gone'}, so there is nothing to ${verb}.`);
  }

  async function onPost({ draftId, allowNoImage, messageId }) {
    const draft = findDraft(draftId);
    if (draft?.status !== 'SENT') return notPending({ draft, verb: 'post', messageId });
    if (!draft.image && !allowNoImage) {
      await send('No image attached yet. Send one here first, or post the text only?', { reply_markup: msg.textOnlyKeyboard(draftId) });
      return;
    }

    // Marked before publishing, so a double tap or a redelivered update can't publish twice.
    updateDraft(draftId, (d) => { d.status = 'POSTING'; });
    await clearButtons(messageId, draft.telegram?.controlMessageId);
    try {
      const result = await publisher.publish({ draft });
      updateDraft(draftId, (d) => {
        d.status = 'POSTED';
        d.decidedAt = nowIso();
        d.dryRun = Boolean(result.dryRun);
        d.linkedinUrl = result.url ?? null;
        delete d.error;
      });
      await send(msg.publishedMessage({ result, draft }));
    } catch (err) {
      log(`Publishing ${draftId} failed: ${err.message}`);
      if (err.uncertain) {
        // The post may exist, so Post stays blocked until the owner has looked at LinkedIn.
        updateDraft(draftId, (d) => { d.status = 'UNKNOWN'; d.error = err.message; });
        await send(msg.uncertainMessage({ error: err.message }), { reply_markup: msg.uncertainKeyboard(draftId) });
        return;
      }
      updateDraft(draftId, (d) => { d.status = 'SENT'; d.error = err.message; });
      await sendControls({ draftId, text: `❌ Posting failed: ${msg.escapeHtml(err.message)}\nThe draft is still waiting, so you can try again.` });
    }
  }

  async function onConfirmPosted({ draftId, messageId }) {
    const draft = findDraft(draftId);
    if (draft?.status !== 'UNKNOWN') return notPending({ draft, verb: 'confirm', messageId });
    updateDraft(draftId, (d) => { d.status = 'POSTED'; d.decidedAt = nowIso(); d.dryRun = false; d.linkedinUrl = null; delete d.error; });
    await clearButtons(messageId);
    await send('✅ Marked as posted.');
  }

  async function onNotPosted({ draftId, messageId }) {
    const draft = findDraft(draftId);
    if (draft?.status !== 'UNKNOWN') return notPending({ draft, verb: 'reopen', messageId });
    // Only the owner's look at LinkedIn makes a second Post safe, so this needs their explicit tap.
    updateDraft(draftId, (d) => { d.status = 'SENT'; });
    await clearButtons(messageId);
    await sendControls({ draftId, text: '↩️ OK, the draft is waiting again. Tap ✅ Post to try once more.' });
  }

  // A crash or power cut during publishing leaves a draft in POSTING; whether it reached LinkedIn is unknown.
  async function recoverInterrupted() {
    const stuck = store.load().drafts.filter((d) => d.status === 'POSTING');
    for (const draft of stuck) {
      updateDraft(draft.id, (d) => { d.status = 'UNKNOWN'; d.error = 'The bot stopped while this draft was being posted.'; });
      await send(msg.uncertainMessage({ error: `The bot stopped while the draft for ${msg.formatDay(draft.date)} was being posted.` }), { reply_markup: msg.uncertainKeyboard(draft.id) });
    }
  }

  async function onLinkedInCommand() {
    if (!linkedin) return send(msg.linkedinLine({ configured: false }));
    const connection = linkedin.getConnection();
    await send(`${msg.linkedinLine({ configured: true, connection })}\n\n${msg.connectMessage({ connection })}`, { reply_markup: msg.connectKeyboard(linkedin.connectUrl()) });
  }

  // Shared by the localhost callback server and a pasted address. Reports instead of throwing,
  // so the browser always gets a page.
  async function onLinkedInRedirect(params) {
    if (!linkedin) return { ok: false, message: 'LinkedIn is not set up in this bot.' };
    try {
      const { name, expiresAt } = await linkedin.completeAuth(params);
      const who = name ? ` as ${name}` : '';
      log(`LinkedIn connected${who}, valid until ${expiresAt}`);
      await send(`✅ LinkedIn connected${msg.escapeHtml(who)}. Access is valid until ${msg.formatDay(expiresAt.slice(0, 10))}; I will remind you before it runs out.`);
      return { ok: true, message: `LinkedIn connected${who}. You can close this tab.` };
    } catch (err) {
      log(`LinkedIn connection failed: ${err.message}`);
      await send(`❌ ${msg.escapeHtml(err.message)}`).catch(() => {});
      return { ok: false, message: err.message };
    }
  }

  async function remindLinkedInIfExpiring() {
    // Before going live, an unconnected LinkedIn is expected and not worth a daily message.
    if (!linkedin || (config.dryRun && !store.load().linkedin)) return;
    const connection = linkedin.getConnection();
    if (connection.connected && connection.daysLeft > RENEW_REMINDER_DAYS) return;
    const headline = connection.connected
      ? `🔑 LinkedIn access runs out in ${connection.daysLeft} days (${msg.formatDay(connection.expiresAt.slice(0, 10))}).`
      : msg.linkedinLine({ configured: true, connection });
    await send(`${headline}\n\n${msg.connectMessage({ connection })}`, { reply_markup: msg.connectKeyboard(linkedin.connectUrl()) });
  }

  async function onSkip({ draftId, messageId }) {
    const draft = findDraft(draftId);
    if (draft?.status !== 'SENT') return notPending({ draft, verb: 'skip', messageId });
    updateDraft(draftId, (d) => { d.status = 'SKIPPED'; d.decidedAt = nowIso(); });
    await clearButtons(messageId, draft.telegram?.controlMessageId);
    await send(`⏭ Skipped. The next draft comes tomorrow at ${sendTime}.`);
  }

  async function onRegenerate({ draftId, messageId }) {
    const draft = findDraft(draftId);
    if (draft?.status !== 'SENT') return notPending({ draft, verb: 'regenerate', messageId });
    await send('🔄 Writing a new version…');
    // The old draft keeps its buttons until the new one exists, so a failed call loses nothing.
    await deliverDraft({
      date: draft.date,
      extra: `Take a clearly different angle from an earlier draft on the same topic, whose first line was: "${draft.hook}". Do not reuse that first line.`,
      retry: { action: ACTION.REGENERATE, arg: draftId },
    });
  }

  async function onImage(message) {
    const draft = store.load().drafts.findLast((d) => d.status === 'SENT');
    if (!draft) {
      await send('No draft is waiting for an image. Send /draft to create one.');
      return;
    }
    const image = extractImage(message);
    if (image.error) {
      await send(image.error);
      return;
    }
    if (image.fileSize > MAX_IMAGE_BYTES) {
      await send('That file is over 20 MB, which bots cannot download. Please send a smaller image.');
      return;
    }
    updateDraft(draft.id, (d) => { d.image = image; });
    await clearButtons(draft.telegram?.controlMessageId);
    const size = image.width ? ` (${image.width}×${image.height})` : '';
    const quality = image.kind === 'photo' ? '\nIt came as a photo, so Telegram compressed it. For full quality, send it as a File.' : '';
    await sendControls({ draftId: draft.id, text: `🖼 Image attached${size}.${quality}\nTap ✅ Post when ready.` });
  }

  async function onStatus() {
    const latest = store.load().drafts.at(-1);
    const lines = [];
    if (latest) {
      const extras = [latest.dryRun && 'dry run', latest.image && 'image attached'].filter(Boolean);
      lines.push(`Latest draft (${msg.formatDay(latest.date)}): ${msg.escapeHtml(latest.subtopic)}`);
      lines.push(`Status: <b>${msg.STATUS_LABEL[latest.status]}</b>${extras.length ? ` (${extras.join(', ')})` : ''}`);
    } else {
      lines.push('No drafts yet. Send /draft to create one.');
    }
    lines.push(`Daily draft at ${sendTime} (${msg.escapeHtml(timezone)}). Mode: ${config.dryRun ? '🧪 dry run' : '🔴 live'}.`);
    lines.push(msg.linkedinLine({ configured: Boolean(linkedin), connection: linkedin?.getConnection() }));
    await send(lines.join('\n'));
  }

  async function handleMessage(message) {
    if (message.chat?.type !== 'private' || !isOwner(message.chat.id)) {
      log(`Ignored a message from chat ${message.chat?.id}`);
      return;
    }
    if (message.photo || message.document) return onImage(message);

    const pasted = parsePastedRedirect(message.text);
    if (pasted) {
      await onLinkedInRedirect(pasted);
      // The code is single-use and useless without the app secret, but it need not stay in the chat.
      await api.deleteMessage({ chat_id: ownerId, message_id: message.message_id }).catch((err) => log(`Could not delete the pasted address: ${err.message}`));
      return;
    }

    const [rawCommand, arg] = (message.text ?? '').trim().split(/\s+/);
    const command = rawCommand?.split('@')[0].toLowerCase();
    switch (command) {
      case '/start':
      case '/help':
        return send(msg.helpMessage({ sendTime, timezone, dryRun: config.dryRun }));
      case '/draft': {
        const date = arg ?? today();
        try {
          assertIsoDate(date, 'Date');
        } catch (err) {
          return send(msg.escapeHtml(err.message));
        }
        return onDraftRequest(date);
      }
      case '/status':
        return onStatus();
      case '/linkedin':
        return onLinkedInCommand();
      default:
        return send('I understand /draft, /status, /linkedin and /help, or send me an image for the waiting draft.');
    }
  }

  async function handleCallback(query) {
    // Always answered, so the tapped button stops spinning, even when the tap is ignored.
    await api.answerCallbackQuery({ callback_query_id: query.id }).catch((err) => log(`answerCallbackQuery: ${err.message}`));
    if (!isOwner(query.from?.id)) {
      log(`Ignored a button tap from user ${query.from?.id}`);
      return;
    }
    const { action, arg } = msg.parseCallback(query.data);
    const messageId = query.message?.message_id;
    switch (action) {
      case ACTION.POST: return onPost({ draftId: arg, allowNoImage: false, messageId });
      case ACTION.POST_TEXT_ONLY: return onPost({ draftId: arg, allowNoImage: true, messageId });
      case ACTION.SKIP: return onSkip({ draftId: arg, messageId });
      case ACTION.REGENERATE: return onRegenerate({ draftId: arg, messageId });
      case ACTION.CONFIRM_POSTED: return onConfirmPosted({ draftId: arg, messageId });
      case ACTION.NOT_POSTED: return onNotPosted({ draftId: arg, messageId });
      case ACTION.WAIT:
        await clearButtons(messageId);
        return send('OK. Send the image whenever you are ready.');
      case ACTION.DRAFT:
        await clearButtons(messageId);
        return onDraftRequest(arg);
      default:
        log(`Unknown button "${query.data}"`);
    }
  }

  async function handleUpdate(update) {
    if (update.callback_query) return handleCallback(update.callback_query);
    if (update.message) return handleMessage(update.message);
  }

  async function runDailyIfDue() {
    const state = store.load();
    const check = isDailyRunDue({ now: clock(), timezone, sendTime, cutoff: catchupCutoff, state });
    if (!check.due) return false;
    // Recorded before generating, so a failing run is reported once instead of retried every tick.
    state.lastAutoRunDate = check.today;
    store.save(state);
    log(`Daily run for ${check.today}`);
    await deliverDraft({ date: check.today });
    // Sent with the daily draft, when the owner is looking at the chat anyway.
    await remindLinkedInIfExpiring();
    return true;
  }

  async function notifyError(err) {
    await send(`⚠️ Something went wrong: ${msg.escapeHtml(err.message)}`).catch(() => {});
  }

  return { handleUpdate, runDailyIfDue, notifyError, recoverInterrupted, onLinkedInRedirect };
}

module.exports = { createBot, extractImage };
