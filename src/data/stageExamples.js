// Per-stage "see how this looks" content. Each entry is the canonical
// example artifact a participant needs to visualise before they can build
// their own — addresses the 04-23 visualization gap where participants
// understood the primitive in the abstract but not what a finished one
// looked like in this product.
//
// Generic baseline only — every cohort sees the same examples regardless
// of org. The shape leaves room for an admin-authored override per
// workshop later (e.g. examples_override JSON on rooms.code), at which
// point lookupStageExample() can prefer the override.

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
  },

  '4': {
    title: 'How a Skill file looks',
    intro:
      'A skill file is a reusable instruction. Save it once, attach it to any coworker or chat, and the AI follows that shape every time. The trick: write it like a checklist, not a paragraph.',
    artifact: {
      kind: 'markdown',
      label: 'credit_review.md',
      body:
        '# Credit Review\n\n' +
        'When given a loan application, return a structured assessment with the sections below. Use bullet points within each section.\n\n' +
        '## Borrower\n' +
        '- Name, registration, and years in operation\n' +
        '- Sector and revenue band\n\n' +
        '## Exposure\n' +
        '- Requested amount and tenor\n' +
        '- Total exposure including any existing facilities\n\n' +
        '## Risks\n' +
        '- Top three concrete risks (financial, operational, market)\n' +
        '- For each: severity (low/med/high) and mitigant if any\n\n' +
        '## Recommendation\n' +
        '- Approve / Approve with conditions / Decline\n' +
        '- One-sentence rationale citing the policy section that drove the call',
    },
  },

  '5': {
    title: 'How a finished Coworker looks',
    intro:
      'A coworker is three things in one: a persona (who they are), one or more skill files (how they work), and knowledge files (what they know). Once built, you DM them like a teammate.',
    artifact: {
      kind: 'card',
      label: 'Ravi — Credit Risk Analyst',
      fields: [
        {
          name: 'Role',
          value:
            "Credit Risk Analyst on the retail-lending desk. Reviews incoming loan applications and produces a structured first-cut assessment for the human credit committee.",
        },
        {
          name: 'Skills',
          value: 'credit_review.md',
        },
        {
          name: 'Knowledge',
          value: 'retail_lending_policy.pdf',
        },
        {
          name: 'Persona',
          value:
            'Methodical, conservative, never speculates beyond evidence. Calls out missing data instead of guessing.',
        },
      ],
    },
  },
};

export function lookupStageExample(stage) {
  return STAGE_EXAMPLES[stage] || null;
}

export default STAGE_EXAMPLES;
