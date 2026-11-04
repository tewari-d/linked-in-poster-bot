const crypto = require('node:crypto');
const { pickForDate } = require('../topics/rotation');
const { buildRequest } = require('../generation/prompts');
const { normalizeDraft, validateDraft, infographicProblems } = require('../generation/draftSchema');

const PENDING = new Set(['GENERATED', 'SENT']);
const MAX_DRAFTS_KEPT = 60;

async function createDraft({ date, epochDate, bank, prompts, provider, store, extra = '' }) {
  const pick = pickForDate({ date, epochDate, bank });
  const userPrompt = buildRequest({ template: prompts.request, pick, extra });

  const raw = await provider.generateDraft({ systemPrompt: prompts.system, userPrompt, pick });
  const content = normalizeDraft(raw);
  const { errors, warnings } = validateDraft(content);
  if (errors.length) {
    throw new Error(`Generated draft failed validation: ${errors.join('; ')}`);
  }
  // Unusable image text doesn't cost the post: the draft goes out with the manual image idea instead.
  const imageProblems = infographicProblems(content.infographic);
  if (imageProblems.length) content.infographic = null;

  const draft = {
    id: `${date}-${crypto.randomUUID().slice(0, 8)}`,
    date,
    category: pick.category,
    subtopic: pick.subtopic,
    format: pick.format.id,
    ...content,
    status: 'GENERATED',
    provider: provider.name,
    createdAt: new Date().toISOString(),
  };

  const state = store.load();
  // Only one live draft at a time: older pending drafts expire so a stale Post button can't publish them.
  for (const old of state.drafts) {
    if (PENDING.has(old.status)) old.status = 'EXPIRED';
  }
  state.drafts.push(draft);
  state.drafts = state.drafts.slice(-MAX_DRAFTS_KEPT);
  store.save(state);

  return { draft, warnings, imageProblems };
}

module.exports = { createDraft };
