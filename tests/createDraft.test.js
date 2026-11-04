const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { loadTopicBank } = require('../src/topics/rotation');
const { loadPrompts } = require('../src/generation/prompts');
const { createMockProvider } = require('../src/generation/mockProvider');
const { createFileStore } = require('../src/store/fileStore');
const { createDraft } = require('../src/jobs/createDraft');

const ROOT = path.join(__dirname, '..');

function setup() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'poster-test-'));
  return {
    dataDir,
    deps: {
      epochDate: '2026-11-01',
      bank: loadTopicBank({ filePath: path.join(ROOT, 'data', 'topics.json') }),
      prompts: loadPrompts({ dir: path.join(ROOT, 'prompts') }),
      provider: createMockProvider(),
      store: createFileStore({ dataDir }),
    },
  };
}

test('createDraft saves a validated draft to state.json', async () => {
  const { dataDir, deps } = setup();
  const { draft } = await createDraft({ ...deps, date: '2026-11-05' });

  const saved = JSON.parse(fs.readFileSync(path.join(dataDir, 'state.json'), 'utf8'));
  assert.equal(saved.drafts.length, 1);
  assert.equal(saved.drafts[0].id, draft.id);
  assert.equal(saved.drafts[0].status, 'GENERATED');
  assert.match(draft.id, /^2026-11-05-/);
});

test('a new draft expires the previous pending one', async () => {
  const { deps } = setup();
  const first = await createDraft({ ...deps, date: '2026-11-05' });
  const second = await createDraft({ ...deps, date: '2026-11-06' });

  const { drafts } = deps.store.load();
  assert.equal(drafts.find((d) => d.id === first.draft.id).status, 'EXPIRED');
  assert.equal(drafts.find((d) => d.id === second.draft.id).status, 'GENERATED');
});

test('the request prompt has no unfilled placeholders', async () => {
  const { deps } = setup();
  let seenPrompt;
  const spy = {
    name: 'spy',
    generateDraft: async (args) => {
      seenPrompt = args.userPrompt;
      return createMockProvider().generateDraft(args);
    },
  };
  await createDraft({ ...deps, provider: spy, date: '2026-11-05' });
  assert.doesNotMatch(seenPrompt, /\{\{|\}\}/);
  assert.match(seenPrompt, /Topic: /);
});
