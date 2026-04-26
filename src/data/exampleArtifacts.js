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

export function createExampleFiles(roomId) {
  const now = new Date().toISOString();
  const base = { room_id: roomId, created_by: 'System', updated_at: now };
  // Folder hierarchy: Examples/ → knowledge/ + skills/
  const folders = [
    { ...base, id: EXAMPLE_FOLDER_ID, parent_id: null, name: 'Examples', type: 'folder', sort_order: -1 },
    { ...base, id: EXAMPLE_KNOWLEDGE_FOLDER_ID, parent_id: EXAMPLE_FOLDER_ID, name: 'knowledge', type: 'folder', sort_order: 0 },
    { ...base, id: EXAMPLE_SKILLS_FOLDER_ID, parent_id: EXAMPLE_FOLDER_ID, name: 'skills', type: 'folder', sort_order: 1 },
  ];
  const knowledge = [
    { ...base, id: 'example-file-retail-policy', parent_id: EXAMPLE_KNOWLEDGE_FOLDER_ID, name: 'retail_lending_policy.md', type: 'file', content: RETAIL_LENDING_POLICY, sort_order: 0 },
    { ...base, id: 'example-file-compliance-exceptions', parent_id: EXAMPLE_KNOWLEDGE_FOLDER_ID, name: 'compliance_exceptions.md', type: 'file', content: COMPLIANCE_EXCEPTIONS, sort_order: 1 },
  ];
  const skills = [
    { ...base, id: 'example-file-credit-review', parent_id: EXAMPLE_SKILLS_FOLDER_ID, name: 'credit_review.md', type: 'file', content: CREDIT_REVIEW_SKILL, sort_order: 0 },
    { ...base, id: 'example-file-compliance-check', parent_id: EXAMPLE_SKILLS_FOLDER_ID, name: 'compliance_check.md', type: 'file', content: COMPLIANCE_CHECK_SKILL, sort_order: 1 },
  ];
  return { folders, knowledge, skills };
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
// `assigneeName` empty so the participant can either run it solo (assigning
// themselves) or wire a peer when running the workshop with a partner.
export function createExampleWorkflow(roomId) {
  const now = new Date().toISOString();
  return {
    id: EXAMPLE_WORKFLOW_ID,
    room_id: roomId,
    name: 'Credit Review Process',
    steps: [
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
    ],
    nodes: null,
    edges: null,
    created_by: 'System',
    updated_at: now,
  };
}
