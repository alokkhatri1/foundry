// Reverse-engineered from the canonical example workflow ("Credit Review
// Process") down to the coworkers and the files those coworkers depend on.
// Each layer references the layer below by stable id so the seeders can
// land them in stage order without breaking references.
//
// All ids are prefixed `example-` so they're cheap to recognise as System-
// authored content elsewhere in the codebase (de-dup checks, read-only
// enforcement, "Clone" affordance gating).

// ===== Layer 1 — files (stages 3 + 4) =====

export const EXAMPLE_FOLDER_ID = 'example-folder-root';
export const EXAMPLE_KNOWLEDGE_FOLDER_ID = 'example-folder-knowledge';
export const EXAMPLE_SKILLS_FOLDER_ID = 'example-folder-skills';
export const EXAMPLE_BLUEPRINTS_FOLDER_ID = 'example-folder-blueprints';
export const EXAMPLE_BLUEPRINT_FILE_ID = 'example-file-blueprint';

export const EXAMPLE_KNOWLEDGE_FILE_IDS = [
  'example-file-retail-policy',
  'example-file-compliance-exceptions',
];

export const EXAMPLE_SKILL_FILE_IDS = [
  'example-file-credit-review',
  'example-file-compliance-check',
];

const RETAIL_LENDING_POLICY = `# Retail Lending Policy v3.2

## Section 1 — Eligibility
- 1.1 Borrower must be a registered entity with at least 24 months of operations.
- 1.2 Adverse credit events in the last 12 months disqualify the borrower without exception.
- 1.3 Sole proprietorships are eligible only with a personal guarantee from the principal.

## Section 2 — Exposure Limits
- 2.1 Single-borrower limit: $500,000 unsecured, $2,000,000 secured.
- 2.2 Sector concentration: no more than 30% of the desk's exposure to a single sector.
- 2.3 Group exposure: aggregated across all related entities.

## Section 3 — Documentation Requirements
- 3.1 Loans up to $200,000: one year of audited financials.
- 3.2 Loans $200,000–$1,000,000: two years of audited financials, OR a personal guarantee from a principal director.
- 3.3 Loans above $1,000,000: three years of audited financials AND a collateral pledge.

## Section 4 — Risk Categories
- 4.1 High-risk sectors: early-stage technology, hospitality, real-estate development. Tier-2 review applies.
- 4.2 Restricted sectors: gambling, defence, regulated commodities. Escalate to Compliance before drafting.
- 4.3 Tenor: facilities above 36 months require an additional risk-pricing layer.
`;

const COMPLIANCE_EXCEPTIONS = `# Compliance Exceptions Register

The exceptions tolerated under the retail lending policy and the conditions under which they apply.
Reference this document when validating any credit memo.

## Exception 001 — Single year of financials
- **Applies to:** loans $200K–$1M (Section 3.2 of the policy)
- **Condition:** personal guarantee from a principal director on file
- **Approval level:** Credit Manager
- **Audit trail:** guarantee scan + director KYC

## Exception 002 — Sector concentration above 30%
- **Applies to:** any new facility that breaches Section 2.2
- **Condition:** desk-level mitigation plan signed by Senior Approver
- **Approval level:** Senior Approver
- **Audit trail:** mitigation plan stored in compliance archive

## Exception 003 — Tenor above 36 months without risk-pricing review
- **Applies to:** Section 4.3 violations
- **Condition:** none — escalate immediately, do not approve at desk level
- **Approval level:** Escalate to Risk Committee

## Exception 004 — Adverse credit event in last 12 months
- **Applies to:** any application that fails Section 1.2
- **Condition:** none — decline without exception
- **Approval level:** N/A
`;

const CREDIT_REVIEW_SKILL = `# Credit Review

When given a loan application, return a structured assessment with the sections below. Use bullet points within each section. Cite the section of the retail lending policy that drove every call.

## Borrower
- Name, registration, years in operation
- Sector and revenue band
- Existing facilities with this institution

## Exposure
- Requested amount and tenor
- Total group exposure including any related entities
- Whether secured / unsecured

## Risks
- Top three concrete risks (financial, operational, market)
- For each: severity (low / medium / high) and mitigant if any

## Recommendation
- Approve / Approve with conditions / Decline
- One-sentence rationale citing the policy section that drove the call
`;

const COMPLIANCE_CHECK_SKILL = `# Compliance Check

When given a credit memo, validate it against the Compliance Exceptions register. Return a structured compliance report.

## Coverage
- List every policy section the memo touched on
- Mark each: \`compliant\` / \`exception filed\` / \`exception missing\`

## Exceptions
- For each exception filed: state the exception number, the deviation, the approval level required
- For each exception missing: explain what is missing and what would resolve it

## Verdict
- Pass / Pass with conditions / Escalate
- One-line rationale citing the exception number(s) involved
`;

// Capstone reference. A generic loan-processing-style review workflow used
// as the take-away assignment in the Capstone tab (Stage 8). Same five-column
// shape participants will fill in: Step / Node / Data source / Knowledge &
// skills files / Remarks (Logic + DoD). Names deliberately kept generic so
// the room admin can rewrite for their cohort's domain without renaming
// roles. The file is editable in place via the standard FileEditor.
const CAPSTONE_BLUEPRINT = `# Credit Application Review — Workflow Blueprint

A reference blueprint for a credit application review process. Use it as
a shape. Each Capstone step is one of two kinds:

- **Coworker step** — the step description becomes an AI coworker's role.
  You attach knowledge files (reading material) and skills files
  (instructions that shape behaviour). When you hit Send, the system
  creates that coworker in your library, named for you, and drops it
  onto the workflow canvas.
- **Human step** — you assign a real human in the room as the reviewer
  and write remarks describing what they verify.

The clarity is the slow step. The build is fast.

| # | Step description | Type | Knowledge / Skills (Coworker) — or Reviewer (Human) |
|---|------------------|------|------|
| 1 | Capture borrower identity, registration, ownership, and guarantor details to start the application | Coworker | Knowledge: applicant intake checklist • Skills: borrower capture |
| 2 | Request and attach the credit bureau report to the case file | Coworker | Knowledge: credit history reading guide • Skills: bureau request |
| 3 | Enter facility type, amount, tenure, security details, and explanations | Coworker | Knowledge: proposal-fields checklist • Skills: proposal entry |
| 4 | Compile audited and projected financials; calculate financial ratios | Coworker | Skills: financial-ratios |
| 5 | Inspect collateral and produce a signed valuation report | Coworker | Skills: collateral valuation |
| 6 | Verify the supporting-documents pack is complete | Coworker | Knowledge: required-documents checklist |
| 7 | Review the proposal pack and approve, reject, or request revision | Human | Reviewer: a real reviewer in the room |
| 8 | Generate standard security documents; collect signatures; upload scans | Coworker | Skills: security-doc templates |
| 9 | Verify documents for completeness and legal compliance | Human | Reviewer: a real reviewer in the room |
| 10 | Set limits, activate accounts, create contracts and deals, apply charges | Coworker | Skills: booking checklist |

## How to use this in the Capstone

1. Open the Capstone tab. Each card is one step in your workflow.
2. For each card:
   - Toggle **Coworker** or **Human** at the top of the card.
   - **Coworker** cards: write what the coworker does — that text becomes
     the coworker's role. Then attach knowledge files and skills files.
     The card shows you the auto-generated coworker name as you type.
   - **Human** cards: write the action ("Risk memo reviewed and
     approved"), pick a reviewer from the room, and add remarks
     describing what they verify.
3. When every card is filled, hit **Send to copilot**. The system
   creates a fresh coworker for each Coworker card (named from your
   step text) and pre-fills the workflow copilot with a build prompt.
   The copilot reads the bindings and assembles the canvas — no
   clarifying questions, just a one-line preview and the build.

You don't need to pre-build coworkers in the Coworkers tab — the
Capstone creates them for you from the step descriptions.

The blueprint above is editable. Rewrite it to match your cohort's
domain if you're running this for something other than a credit review.
`;

export function createExampleFiles(roomId) {
  const now = new Date().toISOString();
  const base = { room_id: roomId, created_by: 'System', updated_at: now };
  // Folder hierarchy: Examples/ → knowledge/ + skills/ + blueprints/
  const folders = [
    { ...base, id: EXAMPLE_FOLDER_ID, parent_id: null, name: 'Examples', type: 'folder', sort_order: -1 },
    { ...base, id: EXAMPLE_KNOWLEDGE_FOLDER_ID, parent_id: EXAMPLE_FOLDER_ID, name: 'knowledge', type: 'folder', sort_order: 0 },
    { ...base, id: EXAMPLE_SKILLS_FOLDER_ID, parent_id: EXAMPLE_FOLDER_ID, name: 'skills', type: 'folder', sort_order: 1 },
    { ...base, id: EXAMPLE_BLUEPRINTS_FOLDER_ID, parent_id: EXAMPLE_FOLDER_ID, name: 'blueprints', type: 'folder', sort_order: 2 },
  ];
  const knowledge = [
    { ...base, id: 'example-file-retail-policy', parent_id: EXAMPLE_KNOWLEDGE_FOLDER_ID, name: 'retail_lending_policy.md', type: 'file', content: RETAIL_LENDING_POLICY, sort_order: 0 },
    { ...base, id: 'example-file-compliance-exceptions', parent_id: EXAMPLE_KNOWLEDGE_FOLDER_ID, name: 'compliance_exceptions.md', type: 'file', content: COMPLIANCE_EXCEPTIONS, sort_order: 1 },
  ];
  const skills = [
    { ...base, id: 'example-file-credit-review', parent_id: EXAMPLE_SKILLS_FOLDER_ID, name: 'credit_review.md', type: 'file', content: CREDIT_REVIEW_SKILL, sort_order: 0 },
    { ...base, id: 'example-file-compliance-check', parent_id: EXAMPLE_SKILLS_FOLDER_ID, name: 'compliance_check.md', type: 'file', content: COMPLIANCE_CHECK_SKILL, sort_order: 1 },
  ];
  const blueprints = [
    { ...base, id: EXAMPLE_BLUEPRINT_FILE_ID, parent_id: EXAMPLE_BLUEPRINTS_FOLDER_ID, name: 'blueprint.md', type: 'file', content: CAPSTONE_BLUEPRINT, sort_order: 0 },
  ];
  return { folders, knowledge, skills, blueprints };
}

// ===== Layer 2 — coworkers (stage 5) =====

export const EXAMPLE_COWORKER_IDS = ['example-cw-ravi', 'example-cw-aisha'];

export function createExampleCoworkers(roomId) {
  const now = new Date().toISOString();
  return [
    {
      id: 'example-cw-ravi',
      room_id: roomId,
      name: 'Ravi · Credit Risk Analyst',
      role: 'Drafts structured credit memos for new retail loan applications. Methodical and conservative — never speculates beyond evidence, always cites the policy section that drove a call.',
      avatar: 'icon:user',
      color: '#5a9e6f',
      instruction_file_ids: ['example-file-credit-review'],
      knowledge_file_ids: ['example-file-retail-policy'],
      tool_ids: [],
      tool_configs: {},
      created_by: 'System',
      updated_at: now,
    },
    {
      id: 'example-cw-aisha',
      room_id: roomId,
      name: 'Aisha · Compliance Reviewer',
      role: 'Validates drafted credit memos against the Compliance Exceptions register. Flags missing exceptions, names the approval level required, and never approves a memo that violates restricted-sector rules.',
      avatar: 'icon:checklist',
      color: '#4a7fb5',
      instruction_file_ids: ['example-file-compliance-check'],
      knowledge_file_ids: ['example-file-compliance-exceptions'],
      tool_ids: [],
      tool_configs: {},
      created_by: 'System',
      updated_at: now,
    },
  ];
}

// ===== Layer 3 — workflow (stage 6) =====

export const EXAMPLE_WORKFLOW_ID = 'example-wf-credit-review';

// Two coworkers, two human reviews — alternating. The Review steps leave
// `assigneeId` empty so the cloner gets pre-filled as reviewer at clone-time,
// or can wire a peer when running the workshop with a partner.
//
// Ships with a fully-wired DAG (trigger + nodes + edges) — the orchestrator at
// runWorkflowAsync.js requires a `trigger` step and walks `workflow.edges` to
// drive forward execution. A workflow without these would hard-fail on Run.
export const EXAMPLE_TRIGGER_STEP_ID = 'step-trigger';

export function createExampleWorkflow(roomId) {
  const now = new Date().toISOString();
  const steps = [
    {
      id: EXAMPLE_TRIGGER_STEP_ID,
      type: 'trigger',
      name: 'Trigger',
      caseInput: '',
    },
    {
      id: 'step-ravi',
      type: 'agent',
      name: 'Ravi drafts credit memo',
      coworkerId: 'example-cw-ravi',
      inputDescription: 'Draft a structured credit memo from the loan application',
    },
    {
      id: 'step-credit-manager',
      type: 'approval',
      name: 'Credit Manager review',
      prompt: 'Review the credit memo for risk framing, completeness, and policy citations. Approve to proceed to compliance, or reject back to Ravi with feedback.',
      actions: ['Approve', 'Reject'],
      assigneeId: '',
    },
    {
      id: 'step-aisha',
      type: 'agent',
      name: 'Aisha checks compliance',
      coworkerId: 'example-cw-aisha',
      inputDescription: 'Validate the memo against the compliance exceptions register; flag any missing or insufficient exceptions',
    },
    {
      id: 'step-senior-approver',
      type: 'approval',
      name: 'Senior Approver sign-off',
      prompt: 'Review the compliance report and the underlying memo. As DRI, sign off if everything is in order or reject with feedback.',
      actions: ['Approve', 'Reject'],
      assigneeId: '',
    },
  ];
  const nodes = steps.map((s, i) => ({
    id: s.id,
    type: s.type,
    position: { x: 80, y: i * 240 },
    data: { ...s },
  }));
  const edges = [];
  for (let i = 0; i < steps.length - 1; i++) {
    edges.push({
      id: `edge-${steps[i].id}-${steps[i + 1].id}`,
      source: steps[i].id,
      target: steps[i + 1].id,
    });
  }
  return {
    id: EXAMPLE_WORKFLOW_ID,
    room_id: roomId,
    name: 'Credit Review Process',
    steps,
    nodes,
    edges,
    created_by: 'System',
    updated_at: now,
  };
}
