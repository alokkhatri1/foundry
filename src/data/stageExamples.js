// Per-stage "see how this looks" content for surfaces that don't have a
// natural file/coworker/workflow analog. As of 2026-04-26 this only
// covers Stage 2 (Preferences) — pure text, no workspace artifact.
//
// Stages 3, 4, 5, 6 used to have panels here but the visualisation gap
// is now closed by the example artifacts that get seeded into the room
// per-stage (see data/exampleArtifacts.js + seedStageExamples in
// useSupabase.js). Don't reintroduce panels for those stages unless the
// seeded artifacts go away.

const STAGE_EXAMPLES = {
  '2': {
    title: 'How a finished Preferences entry looks',
    intro:
      'Three short lines is plenty — who you are, the tone you want, the format you prefer. The AI will fold this into every reply.',
    artifact: {
      kind: 'text',
      label: 'Sample preferences',
      body:
        "I'm a credit-ops manager at a retail bank.\n" +
        'Be concise — bullet points, no preamble.\n' +
        'When assessing a loan, always cite the section of policy you relied on.',
    },
    applyLabel: 'Use as starting point',
  },
};

export function lookupStageExample(stage) {
  return STAGE_EXAMPLES[stage] || null;
}

export default STAGE_EXAMPLES;
