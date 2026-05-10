import { useEffect, useMemo, useState } from 'react';
import { runAiStepAuditOnRun, AUDIT_PROMPT_VERSION } from '../utils/aiAuditor';

// Stage 8 — Auditability (per-step scope, symmetric with Stage 7).
//
// Stage 7 captures human comments per step on a run via step_comments.
// Stage 8's AI auditor produces comments in the same shape on the same
// steps, written to step_comments with author_kind='ai'. This page
// shows, for each run the participant peer-commented on, every step
// that has comments (peer or AI) with peer comments on the left and AI
// comments on the right.
//
// Gate: until the participant has commented on at least 2 distinct
// runs at Stage 7, the comparison surface is locked. The page surfaces
// a prompt nudging them back to Observability.

const MIN_AUDITED_RUNS = 2;

function StatusBadge({ status }) {
  const map = {
    pending:   { label: 'Pending',   className: 'au-badge is-pending' },
    running:   { label: 'Auditing…', className: 'au-badge is-running' },
    completed: { label: 'Done',      className: 'au-badge is-done' },
    error:     { label: 'Error',     className: 'au-badge is-error' },
  };
  const cfg = map[status] || map.pending;
  return <span className={cfg.className}>{cfg.label}</span>;
}

function timeAgo(ts) {
  if (!ts) return '';
  const diff = Math.floor((Date.now() - new Date(ts).getTime()) / 1000);
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

function promptForStepType(type) {
  if (type === 'agent')    return 'Is the AI making decisions correctly?';
  if (type === 'capture')  return 'Is the AI capturing the right thing?';
  if (type === 'approval') return 'Is the human making decisions correctly?';
  return null;
}

function CommentBlock({ comment, label }) {
  return (
    <div className="au-comment">
      <div className="au-comment-meta">
        <strong>{label}</strong>
        <span className="au-comment-time">{timeAgo(comment.created_at)}</span>
      </div>
      <div className="au-comment-body">{comment.body}</div>
    </div>
  );
}

function StepRow({ stepId, stepDef, stepResult, peerComments, aiComments, participantsById }) {
  const stepType = stepDef?.type || stepResult?.type;
  const prompt = promptForStepType(stepType);
  const stepName = stepDef?.name || stepResult?.stepName
    || (stepType === 'agent'   ? (stepDef?.coworker?.name || 'Coworker step')
      : stepType === 'approval' ? `Review${stepDef?.assigneeName ? ` (${stepDef.assigneeName})` : ''}`
      : stepType === 'capture' ? 'Capture'
      : 'Step');
  return (
    <div className="au-step">
      <div className="au-step-head">
        <strong>{stepName}</strong>
        <span className="au-step-prompt">{prompt}</span>
      </div>
      <div className="au-compare">
        <div className="au-compare-col">
          <div className="au-compare-col-head">Peers</div>
          {peerComments.length === 0
            ? <div className="au-empty">No peer comment.</div>
            : peerComments.map(c => (
                <CommentBlock key={c.id} comment={c}
                  label={participantsById?.[c.author_id]?.name || 'a peer'} />
              ))
          }
        </div>
        <div className="au-compare-col">
          <div className="au-compare-col-head">AI auditor</div>
          {aiComments.length === 0
            ? <div className="au-empty">No AI comment on this step.</div>
            : aiComments.map(c => (
                <CommentBlock key={c.id} comment={c} label="AI auditor" />
              ))
          }
        </div>
      </div>
    </div>
  );
}

function RunCard({ run, workflow, stepCommentsByStep, aiCommentsByStep, aiStatus, isAuditing, onRetry, participantsById }) {
  // Steps to render: any step that has at least one comment, in the order
  // they appear in the run's stepResults. Plus we render the step's
  // metadata via the workflow's step definitions.
  const steps = (run.stepResults || []).filter(s => s.type !== 'trigger');
  const stepDefById = Object.fromEntries((workflow?.steps || []).map(d => [d.id, d]));
  return (
    <article className="au-run-card">
      <header className="au-run-head">
        <div>
          <strong>{run.workflowName}</strong>
          <div className="au-run-meta">
            {run.status} · {timeAgo(run.startedAt)}
          </div>
        </div>
        <div className="au-run-status">
          <StatusBadge status={aiStatus} />
          {aiStatus === 'error' && (
            <button type="button" className="au-rerun" onClick={() => onRetry(run.id)} disabled={isAuditing}>Retry</button>
          )}
        </div>
      </header>
      {steps.map(s => (
        <StepRow
          key={s.stepId}
          stepId={s.stepId}
          stepDef={stepDefById[s.stepId]}
          stepResult={s}
          peerComments={stepCommentsByStep[s.stepId] || []}
          aiComments={aiCommentsByStep[s.stepId] || []}
          participantsById={participantsById}
        />
      ))}
    </article>
  );
}

export default function AuditabilityView({
  sb, myParticipantId, currentUserName, participants,
  workflowRuns, workflows, callClaudeAPI,
}) {
  const [allCommentsByRun, setAllCommentsByRun] = useState({});
  const [aiStatusByRun, setAiStatusByRun] = useState({});
  const [auditingRunIds, setAuditingRunIds] = useState({});
  const [loadedComments, setLoadedComments] = useState(false);

  const runsById = useMemo(
    () => Object.fromEntries((workflowRuns || []).map(r => [r.id, r])),
    [workflowRuns]
  );
  const workflowsById = useMemo(
    () => Object.fromEntries((workflows || []).map(w => [w.id, w])),
    [workflows]
  );
  const participantsById = useMemo(
    () => Object.fromEntries((participants || []).map(p => [p.id, p])),
    [participants]
  );

  // Load step_comments for every run in scope; group by run.
  useEffect(() => {
    if (!sb || !workflowRuns?.length) { setLoadedComments(true); return; }
    let cancelled = false;
    Promise.all(workflowRuns.map(r => sb.loadStepComments(r.id).then(rows => [r.id, rows || []])))
      .then(entries => {
        if (cancelled) return;
        setAllCommentsByRun(Object.fromEntries(entries));
        setLoadedComments(true);
      });
    return () => { cancelled = true; };
  }, [sb, workflowRuns]);

  // Realtime: any new step comment (peer or AI) shows up live.
  useEffect(() => {
    if (!sb?.subscribeToStepComments || !workflowRuns?.length) return;
    const unsubs = workflowRuns.map(r =>
      sb.subscribeToStepComments(r.id, (payload) => {
        const row = payload.new || payload.old;
        if (!row) return;
        setAllCommentsByRun(prev => {
          const list = prev[r.id] || [];
          if (payload.eventType === 'DELETE') {
            return { ...prev, [r.id]: list.filter(c => c.id !== row.id) };
          }
          if (list.some(c => c.id === row.id)) return prev;
          return { ...prev, [r.id]: [...list, row].sort((a, b) => new Date(a.created_at) - new Date(b.created_at)) };
        });
      })
    );
    return () => unsubs.forEach(u => u && u());
  }, [sb, workflowRuns]);

  // Runs the current user has commented on — the unlock condition for
  // Stage 8 and the set of runs we'll audit with AI.
  const myAuditedRunIds = useMemo(() => {
    const ids = new Set();
    for (const [runId, list] of Object.entries(allCommentsByRun)) {
      for (const c of list) {
        if (c.author_kind === 'human' && c.author_id === myParticipantId) {
          ids.add(runId);
          break;
        }
      }
    }
    return [...ids];
  }, [allCommentsByRun, myParticipantId]);

  // Load existing AI audit status rows for these runs (we still use
  // ai_run_audits as a status table even though the actual content
  // lives in step_comments).
  useEffect(() => {
    if (!sb || !loadedComments || myAuditedRunIds.length === 0) return;
    let cancelled = false;
    sb.loadAiRunAudits(myAuditedRunIds).then(rows => {
      if (cancelled) return;
      setAiStatusByRun(Object.fromEntries(rows.map(r => [r.run_id, r])));
    });
    return () => { cancelled = true; };
  }, [sb, loadedComments, myAuditedRunIds.join('|')]);

  // For each audited run, ensure AI audit. Skip if already completed
  // (or if we're already auditing locally). Stale-running detection:
  // re-run if status='running' with updated_at older than 2 minutes.
  useEffect(() => {
    if (!loadedComments || !callClaudeAPI || !sb) return;
    for (const runId of myAuditedRunIds) {
      const status = aiStatusByRun[runId];
      if (status?.status === 'completed') continue;
      if (status?.status === 'running') {
        const ts = status.updated_at ? new Date(status.updated_at).getTime() : 0;
        if (Date.now() - ts < 120_000) continue;
      }
      if (auditingRunIds[runId]) continue;
      kickoffOne(runId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadedComments, myAuditedRunIds.join('|'), aiStatusByRun, callClaudeAPI, sb]);

  async function kickoffOne(runId) {
    const run = runsById[runId];
    if (!run) return;
    setAuditingRunIds(prev => ({ ...prev, [runId]: true }));
    console.log('[Auditability] AI step audit starting for run', runId);
    try {
      await sb.saveAiRunAudit({
        runId, findings: {}, status: 'running',
        triggeredBy: myParticipantId, promptVersion: AUDIT_PROMPT_VERSION,
      });

      const workflow = workflowsById[run.workflowId];
      // Bundle the peer comments for this run by step so AI can avoid
      // restating what peers already said.
      const peerCommentsByStep = {};
      for (const c of (allCommentsByRun[runId] || [])) {
        if (c.author_kind !== 'human') continue;
        if (!peerCommentsByStep[c.step_id]) peerCommentsByStep[c.step_id] = [];
        peerCommentsByStep[c.step_id].push(c);
      }

      const result = await runAiStepAuditOnRun({
        run, workflow, peerCommentsByStep, participantsById, callClaudeAPI,
      });
      console.log('[Auditability] AI returned', result.step_findings.length, 'step findings');

      // Write each finding as a step_comments row with author_kind='ai'.
      for (const f of result.step_findings) {
        await sb.saveStepComment({
          runId, stepId: f.step_id, body: f.comment,
          authorId: null, authorKind: 'ai',
        });
      }

      const res = await sb.saveAiRunAudit({
        runId,
        findings: { step_count: result.step_findings.length },
        status: 'completed',
        model: result.model,
        triggeredBy: myParticipantId,
        promptVersion: AUDIT_PROMPT_VERSION,
      });
      if (res.ok) setAiStatusByRun(prev => ({ ...prev, [runId]: res.audit }));
    } catch (e) {
      console.error('[Auditability] AI audit failed for run', runId, e);
      await sb.saveAiRunAudit({
        runId, findings: {}, status: 'error',
        error: e.message || String(e),
        triggeredBy: myParticipantId,
        promptVersion: AUDIT_PROMPT_VERSION,
      });
    } finally {
      setAuditingRunIds(prev => {
        const { [runId]: _, ...rest } = prev;
        return rest;
      });
    }
  }

  function handleRetry(runId) {
    if (auditingRunIds[runId]) return;
    kickoffOne(runId);
  }

  const ready = loadedComments && myAuditedRunIds.length >= MIN_AUDITED_RUNS;

  return (
    <div className="au-page">
      <div className="au-page-inner">
        <header className="au-page-head">
          <div>
            <div className="au-eyebrow"><span className="au-eyebrow-dot" />STAGE 8 · AUDITABILITY</div>
            <h1 className="au-page-title">Two reads on the same decisions — <em>side by side</em>.</h1>
            <p className="au-page-sub">
              For every run you commented on at Stage 7, the platform reads the same run step by step and writes its own comments. Where do they agree? Where do they pull apart? That gap is the lesson.
            </p>
          </div>
        </header>

        {!ready && loadedComments && (
          <div className="au-gate">
            <div className="au-gate-title">
              {myAuditedRunIds.length === 0
                ? 'Comment on at least two peer runs at Stage 7 to unlock the comparison here.'
                : `One more run with comments at Stage 7 unlocks the comparison.`}
            </div>
            <div className="au-gate-sub">
              You've commented on <strong>{myAuditedRunIds.length}</strong> of {MIN_AUDITED_RUNS} runs.
              Open Observability, click into a peer's run, click any step, and leave a comment on the decision.
            </div>
          </div>
        )}

        {ready && (
          <section className="au-section">
            {myAuditedRunIds.map(runId => {
              const run = runsById[runId];
              if (!run) return null;
              // Group this run's comments by step + author kind.
              const byStep = {};
              const aiByStep = {};
              for (const c of (allCommentsByRun[runId] || [])) {
                const map = c.author_kind === 'ai' ? aiByStep : byStep;
                if (!map[c.step_id]) map[c.step_id] = [];
                map[c.step_id].push(c);
              }
              return (
                <RunCard
                  key={runId}
                  run={run}
                  workflow={workflowsById[run.workflowId]}
                  stepCommentsByStep={byStep}
                  aiCommentsByStep={aiByStep}
                  aiStatus={aiStatusByRun[runId]?.status || (auditingRunIds[runId] ? 'running' : 'pending')}
                  isAuditing={!!auditingRunIds[runId]}
                  onRetry={handleRetry}
                  participantsById={participantsById}
                />
              );
            })}
          </section>
        )}
      </div>
    </div>
  );
}
