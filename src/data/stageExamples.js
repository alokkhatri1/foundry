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

  '3': {
    title: 'How attaching a file to chat looks',
    intro:
      'Once a file is in your folder, you can attach it to a question. The AI grounds its answer in that file instead of guessing — and quotes it back so you can verify.',
    artifact: {
      kind: 'text',
      label: 'Sample chat exchange',
      body:
        'You · attached: retail_lending_policy.pdf\n' +
        '   Should we approve a $250,000 facility for a 3-year-old consulting firm?\n\n' +
        'Analyst:\n' +
        '  Per Section 3.2 of the attached policy, retail facilities above $200k\n' +
        '  require either two years of audited financials or a personal guarantee\n' +
        '  from the principal. The application has only one year of statements,\n' +
        '  so the call hinges on whether a guarantee is on file.\n' +
        '  Recommend: Approve with guarantee, decline without.',
    },
  },

  '6': {
    title: 'How a wired Workflow looks',
    intro:
      'A workflow chains coworker steps and human review steps end-to-end. Each AI step produces output; each human step pauses the run until that person approves or rejects with feedback.',
    artifact: {
      kind: 'card',
      label: 'Loan approval — sample DAG',
      fields: [
        { name: 'Trigger', value: 'A new loan application is pasted in' },
        { name: 'Step 1 — Coworker', value: 'Ravi drafts the credit memo from the application' },
        { name: 'Step 2 — Review', value: 'Priya (human) reviews the memo · approves or rejects with comments' },
        { name: 'Step 3 — Coworker', value: 'Legal AI checks the memo against policy exceptions' },
        { name: 'Step 4 — Review', value: 'Anisha (human) signs off — final approver' },
        { name: 'Save output', value: 'Final memo lands in Risk/knowledge for the next run to learn from' },
      ],
    },
  },

  '7': {
    title: 'How a finished Run looks',
    intro:
      'Every workflow leaves a trail: who started it, every step, every approval, every comment. The Decision Log on a Review step shows exactly what was said and by whom.',
    artifact: {
      kind: 'text',
      label: 'Sample run · "Loan approval" · started by Anisha',
      body:
        '10:42  Started by Anisha\n' +
        '10:42  Ravi · drafted credit memo (1.4 KB)\n' +
        '10:43  Review (Priya) · APPROVED\n' +
        '       "Looks good. Rationale on tenor is clear. Proceed."\n' +
        '10:44  Legal AI · flagged 2 policy exceptions\n' +
        '10:46  Review (Anisha) · APPROVED\n' +
        '       "Exceptions noted; both within delegated authority."\n' +
        '10:46  Saved final memo → Risk/knowledge/loan_LM-2041.md',
    },
  },

  '8': {
    title: 'How to read your spend',
    intro:
      'Tokens are the unit of work your AI did on your behalf. High token use is the platform working as intended — it means a lot of work happened without you having to do it. Think of it as token-maxing, not cost-minimising.',
    artifact: {
      kind: 'card',
      label: 'What the numbers mean',
      fields: [
        { name: 'Chat', value: 'Tokens you spent talking to AI directly — questions and answers' },
        { name: 'Coworker chats', value: 'Tokens your coworkers used producing artifacts on your behalf' },
        { name: 'Workflow runs', value: 'Tokens spent inside multi-step orchestrations — the highest-leverage line' },
        { name: 'Headline', value: 'A workshop spend of $0.30 means roughly an hour of AI-assisted work for ~30¢. That ratio is the point.' },
      ],
    },
  },
};

export function lookupStageExample(stage) {
  return STAGE_EXAMPLES[stage] || null;
}

export default STAGE_EXAMPLES;
