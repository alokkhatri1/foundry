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

A reference blueprint for a credit application review process. Use it as a
shape — your capstone table will list each step with a Step name, the Node
(who owns the step), the Data source, the Knowledge & skills files that
back the step, and Remarks (logic + definition of done).

| # | Step | Node | Data source | Knowledge / skills | Remarks |
|---|------|------|-------------|--------------------|---------|
| 1 | Applicant profile created | Originator | Applicant onboarding form | Applicant intake checklist | **Logic:** Originator captures borrower identity, registration, ownership, and guarantor details to start the application. **DoD:** Applicant record saved and selectable for proposal creation. |
| 2 | Credit history pulled | Operations | Credit history service | Credit history reading guide | **Logic:** System request sent to the credit bureau; the report is generated and attached to the case file. **DoD:** A valid credit history report is visible in the case attachments. |
| 3 | Application details captured | Originator | Application proposal form | Proposal-fields checklist | **Logic:** Facility type, amount, tenure, security details, and explanations are entered into the system. **DoD:** Mandatory fields completed without validation errors. |
| 4 | Financial statements uploaded | Originator | Financial template + uploaded file | Financial-ratios skill | **Logic:** Originator downloads the template, fills audited and projected financials, uploads the file; the system calculates ratios and populates the financial section. **DoD:** Financial ratios auto-reflected in the proposal view. |
| 5 | Working-capital details uploaded | Originator | Stock and receivables sheet | Working-capital reading guide | **Logic:** Additional working-capital figures uploaded through dedicated sheets. **DoD:** Stock and receivable figures visible in the financial section. |
| 6 | Collateral assessed | Valuation Officer | Valuator assignment + valuation report | Collateral valuation skill | **Logic:** System assigns a valuator via round-robin; collateral is inspected externally and the report is uploaded. **DoD:** Signed valuation report attached and linked to the collateral record. |
| 7 | Supporting documents collected | Originator | Document repository | Required-documents checklist | **Logic:** Originator uploads the required legal, financial, identity, and business proof documents. **DoD:** Required document checklist satisfied in the system. |
| 8 | Proposal submitted for review | Originator | Workflow routing module | Approval-chain skill | **Logic:** Originator confirms completeness and routes the proposal to the approval chain (Branch Lead → Reviewer → Approver). Query loops are handled within the workflow. **DoD:** Proposal reaches the final approver with a decision recorded. |
| 9 | Post-approval routing | Originator | Workflow routing module | Post-approval checklist | **Logic:** After approval, the originator starts a new flow covering documentation, legal review, and disbursement preparation. **DoD:** Case appears in the post-approval queue. |
| 10 | Security documents generated and signed | Documentation Officer | Document generation + signed copies | Security-doc templates | **Logic:** System generates standard security documents; the documentation team edits as needed; the originator collects signatures and uploads scans. **DoD:** Signed document set uploaded and tagged complete. |
| 11 | Documentation and legal verification | Legal Reviewer | Documentation unit + legal review | Legal-compliance skill | **Logic:** Documents checked for completeness and legal compliance; a correction loop runs until satisfactory. **DoD:** Legal clearance recorded in the workflow. |
| 12 | Loan implemented and booked | Operations | Implementation team + operations modules | Booking-checklist skill | **Logic:** Limits set, account activated, contracts and deals created, charges applied. **DoD:** Loan account operational and ready for disbursement. |
| 13 | Workflow completed and reporting available | Reporting | Reporting module | Reporting query guide | **Logic:** Case closed in the system; the loan is visible in reports and monitoring dashboards. **DoD:** Case status marked complete and retrievable in reports. |

## How to use this in the Capstone

1. Open the Capstone tab and add one row per step in your own workflow.
2. Use the columns as a planning frame — one row tells the story of one
   handoff: who does it, where the data lives, what reading material backs
   the work, and what done looks like.
3. When all rows are filled, the Capstone tab unlocks a **Send to copilot**
   action that ships your plan into the Orchestration copilot. The copilot
   uses your plan as the brief and helps you build the actual workflow.

The blueprint above is editable. Rewrite it to match your cohort's domain
if you're running this for something other than a credit review.
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
