// AI auditor for Stage 8 (Auditability), per-run scope.
//
// Each peer audit at Stage 7 lives on a *run*. Stage 8's job is to put
// AI's read of the same run next to those peer audits, so the
// participant compares two readings of one common artefact rather than
// "AI's general thoughts" against "peer's specific note."
//
// Scope per call: one run's case input, the workflow steps + step
// outputs, and any peer audits already on the run (so AI can avoid
// trivially echoing them or notice things peers missed). One AI audit
// per run, shared across the cohort.

export const AUDIT_PROMPT_VERSION = 2;

const SYSTEM_PROMPT = `You are an audit pass over a single run of a workflow in a workshop on AI-native organisations. The participant who started this run is one human in a room of peers; some peers may have already audited this run with their own notes.

Your job is to write the AI side of the comparison: read the run carefully, then produce ONE structured finding with this shape:

- observation: one sentence — a specific pattern or detail you notice IN THIS RUN. Cite the actual case, coworker, or output text.
- meaning: one sentence — what that pattern implies about how the participant's AI setup is configured (the workflow shape, a coworker's role, a skill file, the case framing).
- suggestion: one sentence — one concrete change that would make a measurable difference if the workflow ran again.

Be specific. Avoid generic compliments ("good run") or generic warnings ("could be more concise"). Avoid restating what the peer audits already said — if peer audits exist, look for what they missed or didn't emphasise. Where there's nothing meaningful to say, say so plainly rather than padding.

Respond in JSON exactly:
{
  "observation": "...",
  "meaning": "...",
  "suggestion": "..."
}`;

function describePeerAudit(a, participantsById) {
  const auditor = participantsById?.[a.auditor_id]?.name || 'a peer';
  return `Peer audit by ${auditor}:
- Noticed: ${a.observation}
- So what: ${a.meaning}
- Now what: ${a.suggestion}`;
}

function describeRun(run, workflow) {
  const steps = (workflow?.steps || run.stepResults || []);
  const stepLines = (run.stepResults || []).map((s, i) => {
    const def = steps.find(x => x.id === s.stepId) || {};
    const cwName = def.coworker?.name || s.coworkerName || '';
    const role = def.coworker?.role || '';
    const out = typeof s.output === 'string' ? s.output : (s.output ? JSON.stringify(s.output) : '');
    const trimmedOut = out.length > 1500 ? out.slice(0, 1500) + '…[truncated]' : out;
    if (s.type === 'approval') {
      return `Step ${i + 1} — Review (assignee: ${def.assigneeName || s.assigneeName || '?'}, prompt: "${(def.prompt || '').slice(0, 200)}"): ${s.status}${trimmedOut ? `\n  Outcome: ${trimmedOut}` : ''}`;
    }
    if (s.type === 'agent') {
      return `Step ${i + 1} — Coworker ${cwName} (role: "${role.slice(0, 200)}"): ${s.status}${trimmedOut ? `\n  Output: ${trimmedOut}` : ''}`;
    }
    return `Step ${i + 1} — ${s.type || 'step'}: ${s.status}${trimmedOut ? `\n  Output: ${trimmedOut}` : ''}`;
  }).join('\n\n');
  return [
    `# Run: ${run.workflowName} — ${run.status}`,
    ``,
    `## Case input`,
    (run.caseInput || '(none — workflow ran without a case input)').slice(0, 2000),
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

// Run an AI audit on one specific run.
// Inputs:
//   run            — the workflow_runs row (with stepResults, caseInput, etc.)
//   workflow       — the workflows row that produced the run (for step definitions)
//   peerAudits     — array of run_audits rows already on this run
//   participantsById — map for resolving auditor names in the prompt
//   callClaudeAPI  — the App-level helper (systemPrompt, userMessage, options)
export async function runAiAuditOnRun({ run, workflow, peerAudits = [], participantsById = {}, callClaudeAPI }) {
  const sections = [
    'Read the run below and produce your finding.',
    '',
    describeRun(run, workflow),
  ];
  if (peerAudits.length > 0) {
    sections.push('', '## Peer audits already on this run', '');
    for (const a of peerAudits) sections.push(describePeerAudit(a, participantsById), '');
  }
  const userMessage = sections.join('\n');

  const resp = await callClaudeAPI(SYSTEM_PROMPT, userMessage, {
    model: 'claude-sonnet-4-6',
    max_tokens: 1000,
    segment: 'ai_audit',
  });

  if (!resp?.success) {
    throw new Error(resp?.error || 'AI audit call failed.');
  }
  const text = resp.content || '';
  let finding;
  try {
    finding = JSON.parse(stripCodeFence(text));
  } catch (err) {
    throw new Error(`Audit response was not valid JSON: ${err.message}. Raw: ${text.slice(0, 500)}`);
  }
  if (!finding || !finding.observation || !finding.meaning || !finding.suggestion) {
    throw new Error('Audit response missing required fields (observation, meaning, suggestion).');
  }
  return { finding, model: 'claude-sonnet-4-6' };
}
