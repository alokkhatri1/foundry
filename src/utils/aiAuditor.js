// AI auditor for Stage 8 (Auditability).
//
// Runs an independent read on everything a participant produced — files
// they wrote, coworkers they built, workflow drafts, runs they kicked off
// — and writes structured findings (per-artefact W/SW/NW plus an overall
// read). Designed to sit *alongside* peer audits at Stage 7, not replace
// them: the comparison between AI's read and peers' reads is the lesson.
//
// Independent read by design: no reference workflow, no rubric, no
// ground truth. The AI is just a thoughtful peer with a comprehensive
// view, asked to surface patterns and propose configuration changes.
// Matches the queryable-org philosophy — audit = querying the substrate
// from a particular posture, not checking against a standard.

export const AUDIT_PROMPT_VERSION = 1;

const SYSTEM_PROMPT = `You are an audit pass over a participant's work in a workshop on AI-native organisations. The participant has built files, AI coworkers, workflow drafts, and run those workflows. Your job is to read everything they produced and write a structured audit.

For EACH artefact (file, coworker, workflow, run), produce a finding shaped:
- observation: one sentence — a specific pattern you notice IN THIS ARTEFACT, not a generic comment.
- meaning: one sentence — what that pattern implies about how this part of their AI setup is configured.
- suggestion: one sentence — one concrete change that would make a measurable difference on the next run.

Then produce ONE overall finding using the same shape, looking across all artefacts together.

Be specific. Avoid generic compliments ("nice work"). Avoid generic warnings ("could be more concise"). The audit is most useful when the suggestion is something the participant could actually act on with a small edit. Where there's nothing meaningful to say, say so plainly rather than padding.

Respond in JSON exactly matching this schema:
{
  "per_artifact": [
    { "kind": "file"|"coworker"|"workflow"|"run", "id": "...", "name": "...", "observation": "...", "meaning": "...", "suggestion": "..." }
  ],
  "overall": { "observation": "...", "meaning": "...", "suggestion": "..." }
}`;

function fileSummary(f) {
  const folder = (f.parentPath || []).join('/') || '(root)';
  const body = (f.content || '').slice(0, 4000); // cap per-file body to keep prompt size sane
  return [
    `### File: ${f.name}`,
    `Folder: ${folder}`,
    `Created: ${f.created_at || ''}`,
    `Content:`,
    '~~~',
    body,
    '~~~',
  ].join('\n');
}

function coworkerSummary(cw) {
  const skills = (cw.instructionFileNames || []).join(', ') || '(none)';
  const knowledge = (cw.knowledgeFileNames || []).join(', ') || '(none)';
  return [
    `### Coworker: ${cw.name}`,
    `Role: ${cw.role || '(blank)'}`,
    `Skill files: ${skills}`,
    `Knowledge files: ${knowledge}`,
  ].join('\n');
}

function workflowSummary(wf) {
  const stepLines = (wf.steps || []).map((s, i) => {
    if (s.type === 'trigger') return `  ${i + 1}. Trigger — case: ${(s.caseInput || '').slice(0, 200)}`;
    if (s.type === 'agent') return `  ${i + 1}. Coworker: ${s.coworker?.name || s.name} — role: ${(s.coworker?.role || '').slice(0, 200)}`;
    if (s.type === 'approval') return `  ${i + 1}. Review (assignee: ${s.assigneeName || '?'}) — prompt: ${(s.prompt || '').slice(0, 200)}`;
    return `  ${i + 1}. ${s.type || 'step'}: ${s.name || ''}`;
  }).join('\n');
  return [
    `### Workflow: ${wf.name}`,
    `Steps:`,
    stepLines || '  (no steps)',
  ].join('\n');
}

function runSummary(r) {
  const stepLines = (r.stepResults || []).map((s, i) => {
    const out = typeof s.output === 'string' ? s.output.slice(0, 800) : (s.output ? JSON.stringify(s.output).slice(0, 800) : '');
    return `  Step ${i + 1} (${s.type || 'step'}, ${s.status || ''}): ${out}`;
  }).join('\n');
  return [
    `### Run: ${r.workflowName} — ${r.status}`,
    `Started: ${r.startedAt ? new Date(r.startedAt).toISOString() : ''}`,
    `Step outputs:`,
    stepLines || '  (none)',
  ].join('\n');
}

// Build a markdown dossier of the participant's artefacts to feed into
// the audit prompt. `artefacts` is the structured shape returned by
// gatherParticipantArtefacts below.
function buildDossier(artefacts) {
  const sections = [];
  if (artefacts.files.length) {
    sections.push('## Files\n\n' + artefacts.files.map(fileSummary).join('\n\n'));
  }
  if (artefacts.coworkers.length) {
    sections.push('## Coworkers\n\n' + artefacts.coworkers.map(coworkerSummary).join('\n\n'));
  }
  if (artefacts.workflows.length) {
    sections.push('## Workflows\n\n' + artefacts.workflows.map(workflowSummary).join('\n\n'));
  }
  if (artefacts.runs.length) {
    sections.push('## Runs\n\n' + artefacts.runs.map(runSummary).join('\n\n'));
  }
  return sections.length ? sections.join('\n\n') : 'No artefacts produced yet.';
}

// Pull the participant's artefacts from the in-memory state already
// loaded by App.jsx. Filtering by created_by/started_by uses the
// participant's display name (which matches how those columns are
// stamped at write time).
export function gatherParticipantArtefacts({ userName, flatFiles = [], coworkers = [], workflows = [], workflowRuns = [] }) {
  const myFiles = flatFiles
    .filter(f => f.type === 'file' && f.createdBy === userName)
    .map(f => ({
      id: f.id,
      name: f.name,
      content: f.content || '',
      created_at: f.createdAt,
      // Compute a parentPath best-effort — flat list, so walk parent_id chain.
      parentPath: pathFor(f.id, flatFiles),
    }));
  const fileById = Object.fromEntries(flatFiles.map(f => [f.id, f]));
  const myCoworkers = coworkers
    .filter(c => c.createdBy === userName)
    .map(c => ({
      id: c.id,
      name: c.name,
      role: c.role,
      instructionFileNames: (c.instructionFileIds || []).map(id => fileById[id]?.name).filter(Boolean),
      knowledgeFileNames: (c.knowledgeFileIds || []).map(id => fileById[id]?.name).filter(Boolean),
    }));
  const myWorkflows = workflows
    .filter(w => w.createdBy === userName)
    .map(w => ({ id: w.id, name: w.name, steps: w.steps || [] }));
  const myRuns = workflowRuns
    .filter(r => r.startedBy === userName)
    .map(r => ({
      id: r.id,
      workflowName: r.workflowName,
      status: r.status,
      startedAt: r.startedAt,
      stepResults: r.stepResults || [],
    }));
  return { files: myFiles, coworkers: myCoworkers, workflows: myWorkflows, runs: myRuns };
}

function pathFor(id, flatFiles) {
  const byId = Object.fromEntries(flatFiles.map(f => [f.id, f]));
  const out = [];
  let cur = byId[id]?.parentId;
  while (cur && byId[cur]) {
    out.unshift(byId[cur].name);
    cur = byId[cur].parentId;
  }
  return out;
}

// Strip a JSON code-fence if Claude wraps the response in one. The
// system prompt asks for plain JSON; this defends against the common
// case anyway.
function stripCodeFence(text) {
  const t = (text || '').trim();
  const m = t.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  return m ? m[1] : t;
}

// Run the AI audit end-to-end:
// 1. Build the dossier
// 2. Call Claude via the parent's callClaudeAPI(systemPrompt, userMessage, options)
// 3. Parse the JSON response
// 4. Hand back findings + token usage
//
// callClaudeAPI is the App-level helper; signature is
// (systemPrompt, userMessage, options) returning {success, content} on
// ok or {success: false, error} on failure.
export async function runAiAudit({ artefacts, callClaudeAPI }) {
  const dossier = buildDossier(artefacts);
  const userMessage = [
    'Here is everything the participant produced in this workshop. Audit the work using the schema you were given.',
    '',
    dossier,
  ].join('\n');

  const resp = await callClaudeAPI(SYSTEM_PROMPT, userMessage, {
    model: 'claude-sonnet-4-6',
    // The audit's response is a JSON object with per-artefact findings;
    // 4000 tokens covers ~10-20 artefacts comfortably. Override of the
    // default 600-token cap is wired in App.jsx callClaudeAPI.
    max_tokens: 4000,
    segment: 'ai_audit',
  });

  if (!resp?.success) {
    throw new Error(resp?.error || 'AI audit call failed.');
  }
  const text = resp.content || '';
  let findings;
  try {
    findings = JSON.parse(stripCodeFence(text));
  } catch (err) {
    throw new Error(`Audit response was not valid JSON: ${err.message}. Raw: ${text.slice(0, 500)}`);
  }
  if (!findings || !Array.isArray(findings.per_artifact) || !findings.overall) {
    throw new Error('Audit response missing required fields (per_artifact, overall).');
  }

  // callClaudeAPI already logs token usage to llm_usage with segment
  // 'ai_audit'; we don't need to duplicate that here. We hand back what
  // the caller might want for the ai_audits row's bookkeeping columns.
  return {
    findings,
    model: 'claude-sonnet-4-6',
  };
}
