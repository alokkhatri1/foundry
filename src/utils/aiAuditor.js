// AI auditor for Stage 8 (Auditability), per-step scope.
//
// Symmetric with Stage 7's peer audit: the human leaves one short
// comment per step asking "is the AI/human making decisions correctly?"
// The AI auditor writes comments in the same shape on the same steps.
// At Stage 8 the comparison is per step: peer comment(s) on the left,
// AI comment(s) on the right.
//
// One AI audit pass per run. Produces N step findings where N is the
// number of substantive steps (coworker, review, capture). Trigger
// steps don't have decisions and aren't audited.

export const AUDIT_PROMPT_VERSION = 3;

const SYSTEM_PROMPT = `You are an audit pass over one run of a workflow in a workshop on AI-native organisations. You will read the run step by step and write one short comment per step, mirroring the human auditor's task: "Is the AI making decisions correctly?" for coworker steps, "Is the human making decisions correctly?" for review steps, and "Is the AI capturing the right thing?" for capture steps. Trigger steps (case input) are skipped — they have no decision.

For each step, write a short comment that:
- is specific to the actual output / decision in that step (cite text where helpful),
- avoids restating what peer comments already said — surface what they missed,
- says "looks fine" or skips when there's nothing meaningful to add.

Respond in JSON exactly:
{
  "step_findings": [
    { "step_id": "...", "comment": "..." }
  ]
}

Only include steps you have something useful to say about; skipping a step is acceptable. Use the exact step_id values shown in the run summary.`;

function describePeerComments(commentsByStep, participantsById) {
  const sections = [];
  for (const [stepId, list] of Object.entries(commentsByStep)) {
    if (!list.length) continue;
    const peers = list.filter(c => c.author_kind === 'human');
    if (!peers.length) continue;
    sections.push(`## Peer comments on step ${stepId}`);
    for (const c of peers) {
      const auditor = participantsById?.[c.author_id]?.name || 'a peer';
      sections.push(`- ${auditor}: ${c.body}`);
    }
    sections.push('');
  }
  return sections.join('\n');
}

function describeRun(run, workflow) {
  const steps = workflow?.steps || [];
  const stepDefById = Object.fromEntries(steps.map(s => [s.id, s]));
  const stepLines = (run.stepResults || []).map((s, i) => {
    const def = stepDefById[s.stepId] || {};
    const cwName = def.coworker?.name || s.coworkerName || '';
    const role = def.coworker?.role || '';
    const out = typeof s.output === 'string' ? s.output : (s.output ? JSON.stringify(s.output) : '');
    const trimmed = out.length > 1500 ? out.slice(0, 1500) + '…[truncated]' : out;
    if (s.type === 'trigger') {
      return null; // skip — no decision
    }
    if (s.type === 'approval') {
      return `### Step ${i + 1} (step_id: ${s.stepId}) — Review (assignee: ${def.assigneeName || s.assigneeName || '?'}, prompt: "${(def.prompt || '').slice(0, 200)}"): ${s.status}${trimmed ? `\nOutcome: ${trimmed}` : ''}`;
    }
    if (s.type === 'agent') {
      return `### Step ${i + 1} (step_id: ${s.stepId}) — Coworker ${cwName} (role: "${role.slice(0, 200)}"): ${s.status}${trimmed ? `\nOutput: ${trimmed}` : ''}`;
    }
    if (s.type === 'capture') {
      return `### Step ${i + 1} (step_id: ${s.stepId}) — Capture: ${s.status}${trimmed ? `\nCaptured: ${trimmed}` : ''}`;
    }
    return `### Step ${i + 1} (step_id: ${s.stepId}) — ${s.type}: ${s.status}${trimmed ? `\nOutput: ${trimmed}` : ''}`;
  }).filter(Boolean).join('\n\n');
  return [
    `# Run: ${run.workflowName} — ${run.status}`,
    ``,
    `## Case input`,
    (run.caseInput || '(none)').slice(0, 2000),
    ``,
    `## Steps and outputs`,
    stepLines || '(no steps)',
  ].join('\n');
}

function stripCodeFence(text) {
  const t = (text || '').trim();
  const m = t.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  return m ? m[1] : t;
}

// Run an AI step-audit on one run.
// Inputs:
//   run           — the workflow_runs row (with stepResults, caseInput)
//   workflow      — the workflows row (for step definitions)
//   peerCommentsByStep — { step_id: [step_comments rows] } so AI can avoid
//                  restating peer comments
//   participantsById — name resolution for peer comments
//   callClaudeAPI — App-level helper
// Returns: { step_findings: [{step_id, comment}], model }
export async function runAiStepAuditOnRun({
  run, workflow, peerCommentsByStep = {}, participantsById = {}, callClaudeAPI,
}) {
  const sections = [
    'Read the run below and produce step-level comments.',
    '',
    describeRun(run, workflow),
  ];
  const peerBlock = describePeerComments(peerCommentsByStep, participantsById);
  if (peerBlock.trim()) {
    sections.push('', peerBlock);
  }
  const userMessage = sections.join('\n');

  const resp = await callClaudeAPI(SYSTEM_PROMPT, userMessage, {
    model: 'claude-sonnet-4-6',
    max_tokens: 2000,
    segment: 'ai_audit',
  });

  if (!resp?.success) {
    throw new Error(resp?.error || 'AI audit call failed.');
  }
  const text = resp.content || '';
  let payload;
  try {
    payload = JSON.parse(stripCodeFence(text));
  } catch (err) {
    throw new Error(`Audit response was not valid JSON: ${err.message}. Raw: ${text.slice(0, 500)}`);
  }
  if (!payload || !Array.isArray(payload.step_findings)) {
    throw new Error('Audit response missing step_findings array.');
  }
  // Filter out empty/blank comments — the prompt allows skipping steps.
  const findings = payload.step_findings
    .filter(f => f && f.step_id && (f.comment || '').trim())
    .map(f => ({ step_id: f.step_id, comment: f.comment.trim() }));
  return { step_findings: findings, model: 'claude-sonnet-4-6' };
}
