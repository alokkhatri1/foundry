export const KNOWLEDGE_TEMPLATE = `# [Topic Name]

## Purpose
<!-- What does this document cover? -->

## Rules
<!-- List the key rules, limits, thresholds, or requirements -->

## Exceptions
<!-- When do the rules NOT apply? -->

## References
<!-- Link to source documents or authority -->
`;

export const INSTRUCTION_TEMPLATE = `# [Agent Name]

## Role
<!-- One sentence: what is this agent's job? -->

## What You Read
<!-- Which knowledge files does this agent use? -->

## What You Analyze
<!-- Step by step: what does this agent check or evaluate? -->

## What You Return
<!-- What output does this agent produce? Be specific. -->

## Constraints
<!-- What must this agent NEVER do? -->
`;

export const REVIEW_CRITERIA = `# Review Criteria

## Evaluation Framework
All incoming cases are evaluated against the following criteria before a decision is made.

## Required Documents
1. Completed application or request form
2. Supporting documentation relevant to the case type
3. Identity verification of the requestor
4. Financial or impact summary (if applicable)
5. Prior history or references (if applicable)

## Scoring Criteria
- **Completeness** (0-25): Are all required documents and information present?
- **Eligibility** (0-25): Does the case meet the basic requirements?
- **Risk Assessment** (0-25): What is the risk level based on available information?
- **Alignment** (0-25): Does this align with organizational priorities and policies?

## Risk Flags
- Missing or outdated documentation
- Inconsistencies between submitted documents
- First-time requestor with no prior history
- Case value exceeds standard thresholds
- Multiple concurrent active cases from same requestor

## Thresholds
- Score 80-100: Low risk — standard processing
- Score 60-79: Medium risk — additional review recommended
- Score below 60: High risk — escalation required
`;

export const APPROVAL_RULES = `# Approval Rules and Escalation

## Standard Approval Chain
1. Case Officer: Prepares case, gathers documents, submits for review
2. Team Lead: Approves standard cases within normal parameters
3. Department Head: Approves cases that exceed standard thresholds or have risk flags
4. Executive Committee: Approves high-value or high-risk cases

## Escalation Triggers (Automatic Upward Referral)
- Any case where the AI confidence score is below 0.6
- Any case flagged with more than 2 exceptions
- Any case involving a VIP or sensitive party
- Any case in a restricted category
- Any case that has been previously rejected and resubmitted

## Approval Requirements
- All approvals must include: Approver name, timestamp, decision rationale
- Rejections must include: Specific criteria or rules triggering rejection
- Conditional approvals must list all conditions and deadlines

## Conflict of Interest
- No officer may approve a case involving a personal relationship
- No officer may approve a case where they have a financial interest
`;

export const CASE_REVIEWER_INSTRUCTIONS = `# Case Review Agent

## Role
You are a case review specialist. You evaluate incoming cases against the review criteria and provide a structured assessment.

## What You Read
- The case details and submitted documents
- review-criteria.md (for evaluation framework and scoring)
- approval-rules.md (for escalation triggers)
- Any output from previous agents in the workflow

## What You Analyze
1. Evaluate the case against each scoring criterion (Completeness, Eligibility, Risk, Alignment)
2. Check for risk flags
3. Determine the appropriate approval authority based on the case
4. Identify any escalation triggers
5. Cross-reference with document check results if available

## What You Return
Provide your assessment with these sections:
- Confidence Score: 0.0 to 1.0
- Status: "recommend_approve" or "recommend_reject" or "needs_human_review"
- Summary: Concise assessment paragraph
- Scoring Breakdown: Score for each criterion with justification
- Risk Factors: List of identified risks with severity (high/medium/low)
- Issues: List of specific concerns
- Recommended Action: "approve" or "reject" or "request_correction" or "escalate"
- Conditions: Any conditions that should be attached if approved

## Constraints
- You RECOMMEND. You do not APPROVE or REJECT. Use language like "recommend approval" not "approved."
- If critical information is missing, lower your confidence score and flag it
- Always reference specific criteria when flagging issues
- Be conservative — when in doubt, recommend human review
`;

export const DOCUMENT_CHECKER_INSTRUCTIONS = `# Document Checker Agent

## Role
You are a document verification specialist. You check submitted documents against the required checklist.

## What You Read
- The case details including list of documents submitted
- review-criteria.md (for required document list)

## What You Analyze
1. Check each required document against the checklist
2. Flag any missing documents
3. Check document validity and completeness
4. Flag any inconsistencies between documents
5. Check for case-type-specific requirements

## What You Return
Provide your assessment with these sections:
- Confidence Score: 0.0 to 1.0 (1.0 = all documents present and valid)
- Status: "complete" or "incomplete" or "needs_correction"
- Summary: Brief overall assessment
- Documents Verified: List of documents checked with status
- Issues: List of specific problems found
- Recommended Action: "proceed" or "request_documents" or "escalate"

## Constraints
- You ONLY verify documents. You do NOT assess the case itself.
- If a document is mentioned but you cannot verify its contents, flag it as "submitted but unverifiable"
- Never assume a document exists if it is not explicitly listed
- Be specific about what is missing and reference the exact requirement
`;

export const DEFAULT_TEST_CASE = `New case submitted by Greenfield Solutions Ltd., a mid-size consulting firm. They are requesting approval for a partnership expansion project valued at $250,000. The company has been operating for 3 years with steady growth. Documents submitted: company registration, financial statements (1 year), project proposal, client references (2), team qualifications summary.`;

export function createStarterFolders(orgName) {
  // Fresh workshops open empty — participants create their own top-level
  // folders at Stage 3 via the "+ New Folder" button. The function is kept
  // for API compatibility with seedWorkshopContent, but no sample dept folder
  // is pre-seeded.
  void orgName;
  return {
    id: 'root',
    name: 'files',
    type: 'folder',
    children: [],
  };
}

// Preserved for reference: the original Operations seed is still available
// under this name in case a scenario wants to import it explicitly.
export function createSampleOperationsTree(orgName) {
  void orgName;
  return {
    id: 'root',
    name: 'files',
    type: 'folder',
    children: [
      {
        id: 'dept-operations',
        name: 'Operations',
        type: 'folder',
        children: [
          {
            id: 'ops-knowledge',
            name: 'knowledge',
            type: 'folder',
            children: [
              {
                id: 'file-review-criteria',
                name: 'review-criteria.md',
                type: 'file',
                content: REVIEW_CRITERIA,
              },
              {
                id: 'file-approval-rules',
                name: 'approval-rules.md',
                type: 'file',
                content: APPROVAL_RULES,
              },
            ],
          },
          {
            id: 'ops-instructions',
            name: 'skills',
            type: 'folder',
            children: [
              {
                id: 'file-case-reviewer',
                name: 'case-reviewer.md',
                type: 'file',
                content: CASE_REVIEWER_INSTRUCTIONS,
              },
              {
                id: 'file-doc-checker',
                name: 'document-checker.md',
                type: 'file',
                content: DOCUMENT_CHECKER_INSTRUCTIONS,
              },
            ],
          },
        ],
      },
    ],
  };
}

export function createStarterCoworkers() {
  return [
    {
      id: 'cw-doc-checker',
      name: 'Document Checker',
      role: 'Verifies submitted documents against the required checklist',
      avatar: 'icon:checklist',
      color: '#4a7fb5',
      instructionFileIds: ['file-doc-checker'],
      knowledgeFileIds: ['file-review-criteria'],
      toolIds: [],
      createdBy: 'System',
      createdAt: Date.now(),
    },
    {
      id: 'cw-case-reviewer',
      name: 'Case Reviewer',
      role: 'Evaluates cases against review criteria and provides structured recommendations',
      avatar: 'icon:search',
      color: '#5a9e6f',
      instructionFileIds: ['file-case-reviewer'],
      knowledgeFileIds: ['file-review-criteria', 'file-approval-rules'],
      toolIds: [],
      createdBy: 'System',
      createdAt: Date.now(),
    },
  ];
}

// ===== Built-in Tools =====
// These are automatically available to every coworker — no wiring needed.

export const BUILTIN_TOOLS = [
  {
    id: 'builtin-create-file',
    name: 'Create File',
    type: 'create',
    description: 'Create a new file in the shared Files workspace. Use this when you want to produce an artifact — a summary, a report, a draft — that the user and everyone else in the workshop can see and open. Provide a clear title and the full markdown content.',
    icon: '\uD83D\uDCDD',
    isBuiltin: true,
    createdBy: 'System',
    config: {
      templateId: 'document_generator',
      parameters: [
        { name: 'title', label: 'File Title', type: 'string', required: true, description: 'Short title for the file — also used to generate the filename' },
        { name: 'content', label: 'Content', type: 'string', required: true, description: 'Full markdown content of the file' },
      ],
    },
  },
  {
    id: 'builtin-send-message',
    name: 'Send Message',
    type: 'communicate',
    description: 'Post a short message into the shared conversation. Use this to announce progress, flag a decision point, or surface something the team should know in the moment. The message appears as a system note in the chat — everyone in the workshop can see it.',
    icon: '\uD83D\uDCAC',
    isBuiltin: true,
    createdBy: 'System',
    config: {
      templateId: 'send_chat_message',
      parameters: [
        { name: 'message', label: 'Message', type: 'string', required: true, description: 'The message to post to the shared chat' },
      ],
    },
  },
];

// Starter external connectors — real, free, no-auth APIs for workshop demos
export const STARTER_CONNECTORS = [
  {
    id: 'connector-exchange-rates',
    name: 'Exchange Rates',
    type: 'connect',
    description: 'Gets live currency exchange rates. Useful for financial case processing and international transactions.',
    icon: '\uD83D\uDCB1',
    createdBy: 'System',
    config: {
      templateId: 'api_caller',
      parameters: [],
      url: 'https://open.er-api.com/v6/latest/USD',
      method: 'GET',
    },
  },
  {
    id: 'connector-country-lookup',
    name: 'Country Lookup',
    type: 'connect',
    description: 'Looks up country information — currency, population, region, languages. Useful for KYC and compliance checks.',
    icon: '\uD83C\uDF0D',
    createdBy: 'System',
    config: {
      templateId: 'api_caller',
      parameters: [],
      url: 'https://restcountries.com/v3.1/name/australia',
      method: 'GET',
    },
  },
];

export function createStarterTools() {
  const now = Date.now();
  return [
    ...BUILTIN_TOOLS.map(t => ({ ...t, createdAt: now })),
    ...STARTER_CONNECTORS.map(t => ({ ...t, createdAt: now })),
  ];
}

// Ensures built-in tools and starter connectors exist. Cleans up legacy tools.
export function ensurePrebuiltTools(existingTools) {
  if (!existingTools) return createStarterTools();

  const currentBuiltinIds = new Set(BUILTIN_TOOLS.map(t => t.id));
  // Keep only current builtins and connectors — drops legacy/retired builtins too
  let tools = existingTools.filter(t => (t.isBuiltin && currentBuiltinIds.has(t.id)) || t.type === 'connect');

  const currentIds = new Set(tools.map(t => t.id));

  // Ensure built-in tools exist
  for (const builtin of BUILTIN_TOOLS) {
    if (!currentIds.has(builtin.id)) {
      tools.push({ ...builtin, createdAt: Date.now() });
      currentIds.add(builtin.id);
    }
  }

  // Ensure starter connectors exist
  for (const connector of STARTER_CONNECTORS) {
    if (!currentIds.has(connector.id)) {
      tools.push({ ...connector, createdAt: Date.now() });
      currentIds.add(connector.id);
    }
  }

  return tools;
}

export function createStarterWorkflow() {
  return {
    id: 'wf-case-review',
    name: 'Case Review Process',
    steps: [
      {
        id: 'step-1',
        type: 'agent',
        name: 'Document Check',
        coworkerId: 'cw-doc-checker',
        inputDescription: 'Verify submitted documents against requirements',
      },
      {
        id: 'step-2',
        type: 'agent',
        name: 'Case Assessment',
        coworkerId: 'cw-case-reviewer',
        inputDescription: 'Evaluate case against review criteria',
      },
      {
        id: 'step-3',
        type: 'approval',
        name: 'Human Review',
        prompt: 'Review the AI assessment and approve, reject, or request corrections',
        actions: ['Approve', 'Reject', 'Request Correction', 'Escalate'],
        maxCorrections: 3,
        correctionTarget: 'step-1',
      },
      {
        id: 'step-4',
        type: 'system',
        name: 'Process Case',
        action: 'update_status',
        description: 'Update case status and send confirmation',
      },
    ],
  };
}

export function createStarterRun() {
  const now = Date.now();
  return {
    id: 'run-example-001',
    workflowId: 'wf-case-review',
    workflowName: 'Case Review Process',
    status: 'completed',
    currentStepIndex: 3,
    startedBy: 'Demo Facilitator',
    startedAt: now - 480000,
    completedAt: now - 60000,
    caseInput: DEFAULT_TEST_CASE,
    stepResults: [
      {
        stepId: 'step-1', stepName: 'Document Check', type: 'agent',
        coworkerName: 'Document Checker', coworkerAvatar: '\uD83D\uDCCB', skillName: 'Verify Documents',
        status: 'completed', completedAt: now - 420000,
        output: 'Confidence Score: 0.72\n\nStatus: incomplete\n\nSummary: Document verification identified some gaps in the submission from Greenfield Solutions Ltd.\n\nDocuments Verified:\n- Company registration: Submitted \u2713\n- Financial statements: 1 year provided (criteria recommends 2+ years for cases above $200k) \u26A0\n- Project proposal: Submitted \u2713\n- Client references: 2 provided \u2713\n- Team qualifications: Submitted \u2713\n- Identity verification: Not explicitly provided \u2717\n\nIssues:\n1. Only 1 year of financial statements provided. For cases of this value, 2 years is recommended.\n2. No identity verification document found for the primary requestor.\n\nRecommended Action: request_documents',
      },
      {
        stepId: 'step-2', stepName: 'Case Assessment', type: 'agent',
        coworkerName: 'Case Reviewer', coworkerAvatar: '\uD83D\uDD0D', skillName: 'Review Cases',
        status: 'completed', completedAt: now - 300000,
        output: 'Confidence Score: 0.65\n\nStatus: needs_human_review\n\nSummary: Greenfield Solutions Ltd. is requesting $250,000 for a partnership expansion. The case shows promise but has documentation gaps and limited operating history.\n\nScoring Breakdown:\n- Completeness: 18/25 (missing identity verification, limited financials)\n- Eligibility: 20/25 (meets basic requirements)\n- Risk Assessment: 15/25 (limited history, above-threshold value)\n- Alignment: 20/25 (expansion aligns with growth objectives)\n\nTotal Score: 73/100 (Medium risk)\n\nRisk Factors:\n- Limited operating history (3 years) — medium\n- Single year financials for high-value case — medium\n- Missing identity verification — high\n\nRecommended Action: request_correction\n\nConditions if approved:\n1. Obtain identity verification for primary requestor\n2. Request second year of financial statements\n3. Standard progress reporting quarterly',
      },
      {
        stepId: 'step-3', stepName: 'Human Review', type: 'approval',
        assigneeName: 'Demo Facilitator',
        status: 'completed', completedAt: now - 120000,
        output: 'Approve: Proceed with conditions — request additional documents within 14 days.',
      },
      {
        stepId: 'step-4', stepName: 'Process Case', type: 'system',
        status: 'completed', completedAt: now - 60000,
        output: 'Case CSE-2026-04-00892 approved. Status updated. Confirmation sent. Timestamp: 2026-04-16 14:26:05',
      },
    ],
  };
}

export function createStarterLogs() {
  const now = Date.now();
  return [
    { timestamp: now - 480000, type: 'workflow', message: 'started by Demo Facilitator | workflow: Case Review Process' },
    { timestamp: now - 420000, type: 'agent', message: 'Document Checker | confidence: 0.72' },
    { timestamp: now - 300000, type: 'agent', message: 'Case Reviewer | confidence: 0.65' },
    { timestamp: now - 120000, type: 'approval', message: 'Demo Facilitator: Approve | "Proceed with conditions"' },
    { timestamp: now - 60000, type: 'system', message: 'update_status | CSE-2026-04-00892 | SUCCESS' },
    { timestamp: now - 60000, type: 'workflow', message: 'status: COMPLETED' },
  ];
}

export function createEmptyFolders(orgName) {
  void orgName;
  return {
    id: 'root',
    name: 'files',
    type: 'folder',
    children: [
      {
        id: 'dept-new',
        name: 'New Folder',
        type: 'folder',
        children: [
          {
            id: 'new-knowledge',
            name: 'knowledge',
            type: 'folder',
            children: [],
          },
          {
            id: 'new-instructions',
            name: 'skills',
            type: 'folder',
            children: [],
          },
        ],
      },
    ],
  };
}
