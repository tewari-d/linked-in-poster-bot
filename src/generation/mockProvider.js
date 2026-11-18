// Offline stand-in for the LLM: lets the pipeline run without an API key or quota.
// Its output follows the same style rules as a real draft, so --mock runs show no style warnings.
function createMockProvider() {
  async function generateDraft({ pick }) {
    const hook = `🚀 [MOCK] ${pick.subtopic}: one thing worth knowing`.slice(0, 150);
    const paragraphs = [
      hook,
      'Most teams only notice this when something breaks 👇',
      `This is a mock draft for the ${pick.category} topic "${pick.subtopic}". It lets the pipeline run end to end without calling Gemini.`,
      `Format requested: ${pick.format.instruction}`,
      [
        '✅ A real draft opens with a hook that stops the scroll',
        '🔹 It keeps every technical detail accurate',
        '⚡ It puts the core idea in a short list like this one',
        '💡 It says why the idea matters for your project',
      ].join('\n'),
      '🎯 Takeaway: short lines, one idea, accurate details.',
      '💬 What would you add to this?',
    ];
    return {
      hook,
      text: paragraphs.join('\n\n'),
      hashtags: ['#SAP', '#MockDraft', '#Testing'],
      imagePrompt: 'Portrait infographic, aspect ratio 4:5, 1080 x 1350 pixels. Bold headline at the top: "Mock Draft". Subtitle: "Pipeline test without Gemini". Central diagram: three glossy 3D cards labeled "Topic", "Draft" and "Post", connected by glowing arrows. Side panel with three takeaways and simple icons: "Clear hook", "Accurate details", "One idea". Modern vibrant tech style, soft glow, large clean sans-serif text, deep blue circuit-like gradient background. No logos, brand marks or trademarked artwork.',
      infographic: {
        label: 'Mock draft · pipeline test',
        headline: 'Mock draft, real pipeline',
        subtitle: 'Written offline, without Gemini',
        layout: 'list',
        points: [
          { icon: 'target', title: 'A hook that stops the scroll', note: 'The first line works on its own' },
          { icon: 'shield-check', title: 'Accurate technical details', note: 'No invented features, numbers or dates' },
          { icon: 'list-checks', title: 'One idea, short lines', note: 'The core points in a scannable list' },
        ],
        question: 'What would you add to this?',
      },
    };
  }

  return { name: 'mock', generateDraft };
}

module.exports = { createMockProvider };
