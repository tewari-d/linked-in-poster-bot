const fs = require('node:fs');
const path = require('node:path');

function loadPrompts({ dir }) {
  const read = (name) => fs.readFileSync(path.join(dir, name), 'utf8');
  return {
    system: read('post-system.md'),
    request: read('post-request.md'),
  };
}

// Fails loudly on a missing value, so a typo in a template can't silently ship "{{subtopc}}" to the model.
function renderTemplate({ template, values }) {
  return template.replace(/\{\{(\w+)\}\}/g, (match, key) => {
    if (!(key in values)) throw new Error(`Prompt template uses {{${key}}} but no value was provided`);
    return String(values[key]);
  });
}

function buildRequest({ template, pick, extra = '' }) {
  return renderTemplate({
    template,
    values: {
      category: pick.category,
      subtopic: pick.subtopic,
      formatInstruction: pick.format.instruction,
      extra,
    },
  }).trim();
}

module.exports = { loadPrompts, renderTemplate, buildRequest };
