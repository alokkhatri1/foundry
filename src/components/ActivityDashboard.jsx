import React, { useState, useEffect, useMemo, useRef } from 'react';

// Forces a re-render every `ms` so any relative-time rendering in the
// subtree (timeAgo cards, etc.) advances without the underlying run
// object mutating.
function useTick(ms = 60_000) {
  const [, setN] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setN(n => n + 1), ms);
    return () => clearInterval(id);
  }, [ms]);
}
import EducationalCue from './EducationalCue';
import { CoworkerGlyph } from './Icon';
import RichText from './RichText';
import { stageReached } from './RevealAt';

function isIconOrImage(avatar) {
  return typeof avatar === 'string' && (avatar.startsWith('icon:') || avatar.startsWith('data:'));
}

function timeAgo(ts) {
  const diff = Math.floor((Date.now() - ts) / 1000);
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

const STATUS_CONFIG = {
  running: { label: 'Running', color: '#4a7fb5', bg: '#e8f0f8' },
  waiting_approval: { label: 'Waiting for Review', color: '#c8956c', bg: '#fdf0e6' },
  completed: { label: 'Completed', color: '#5a9e6f', bg: '#e8f4ec' },
  // Run reached a terminal state after at least one Reject decision routed
  // through a wired rejected-edge branch. Distinct from 'completed' (clean
  // approval path) so a rejection is never invisible in the dashboard.
  rerouted: { label: 'Rerouted (Rejected)', color: '#c8956c', bg: '#fdf0e6' },
  rejected: { label: 'Rejected', color: '#c45c5c', bg: '#fdf0f0' },
  error: { label: 'Error', color: '#c45c5c', bg: '#fdf0f0' },
  cancelled: { label: 'Cancelled', color: '#8c7b68', bg: '#efeae2' },
  interrupted: { label: 'Interrupted', color: '#8c7b68', bg: '#efeae2' },
};

// A run's stored status is what the executor wrote, but if the run completed
// after a wired rejection routing, surface that as a distinct UI state.
// Derived purely from stepResults so no schema/executor change is needed.
function effectiveRunStatus(run) {
  const status = run?.status;
  if (status !== 'completed') return status;
  const hadReject = (run.stepResults || []).some(s =>
    s?.type === 'approval' && typeof s.output === 'string' && s.output.startsWith('Reject')
  );
  return hadReject ? 'rerouted' : 'completed';
}

const STEP_STATUS_ICON = {
  completed: '\u2713',
  running: '\u25CF',
  waiting: '\u25CB',
  pending: '\u25CB',
  error: '\u2715',
};

// ===== Run Card =====
// Maps the executor status -> the tone class on the new pill.
const STATUS_TONE = {
  running:          'is-running',
  waiting_approval: 'is-waiting',
  completed:        'is-completed',
  rerouted:         'is-waiting',
  rejected:         'is-rejected',
  error:            'is-rejected',
  cancelled:        'is-muted',
  interrupted:      'is-muted',
};

function RunCard({ run, onClick, onNudge, showEducationalCues }) {
  const eff = effectiveRunStatus(run);
  const cfg = STATUS_CONFIG[eff] || STATUS_CONFIG.running;
  const tone = STATUS_TONE[eff] || 'is-running';
  const stepResults = run.stepResults || [];
  const completedSteps = stepResults.filter(s => s.status === 'completed').length;
  const totalSteps = stepResults.length;
  const waitingStep = stepResults.find(s => s.status === 'waiting');

  return (
    <button className={`ob-card ${tone}`} onClick={() => onClick(run.id)} type="button">
      <div className="ob-card-top">
        <span className="ob-card-name">{run.workflowName}</span>
        <span className={`ob-card-status ${tone}`}>
          {tone === 'is-running' && <span className="ob-card-status-dot is-pulse" />}
          {cfg.label}
        </span>
      </div>

      {/* Mini DAG flow chip — one tile per step coloured by completion + type */}
      <div className="ob-card-flow">
        {stepResults.map((step, i) => {
          const isCompleted = step.status === 'completed';
          const isActive = step.status === 'running' || step.status === 'waiting';
          const stateClass = isCompleted ? 'is-completed'
            : step.status === 'running' ? 'is-running'
            : step.status === 'waiting' ? 'is-waiting'
            : step.status === 'error' ? 'is-error'
            : 'is-pending';
          return (
            <span key={i} className="ob-card-flow-item">
              {i > 0 && <span className={`ob-card-flow-line${isCompleted ? ' is-completed' : ''}`} />}
              <span className={`ob-card-flow-dot ${stateClass}`}>
                {isCompleted ? '✓' :
                 isActive ? <span className="ob-card-flow-pulse" /> :
                 step.type === 'trigger' ? '▶' :
                 step.type === 'approval' ? '◷' :
                 step.type === 'capture' ? '✦' :
                 '·'}
              </span>
            </span>
          );
        })}
        <span className="ob-card-flow-count">{completedSteps}/{totalSteps}</span>
      </div>

      {run.caseInput && (
        <p className="ob-card-case">{run.caseInput}</p>
      )}

      <div className="ob-card-meta">
        <span>Started by <em>{run.startedBy}</em></span>
        <span className="ob-card-meta-sep">·</span>
        <span>{timeAgo(run.startedAt)}</span>
      </div>

      {waitingStep && (
        <div className="ob-card-waiting">
          <span className="ob-card-waiting-text">Waiting on <em>{waitingStep.assigneeName || 'reviewer'}</em></span>
          <button
            className="ob-card-waiting-nudge"
            onClick={e => { e.stopPropagation(); onNudge(run.id); }}
          >Nudge →</button>
        </div>
      )}

      <EducationalCue cueId="activity-nudge" show={showEducationalCues && !!waitingStep} />
    </button>
  );
}

// ===== Run Detail View =====
// DAG mirror on the left, decision-first sidebar on the right. Clicking a
// node selects it on both sides; the sidebar row expands inline with the
// step's output, decision log, or (if it's the run owner's turn) the
// approval form.
function RunDetailView({ run, onBack, onApprovalAction, onCancelRun, onNudge, showEducationalCues, currentUserName, approvals, onLoadApprovals, workflows, currentStage, sb }) {
  const showCost = stageReached(currentStage, '8');
  const [costByStepId, setCostByStepId] = useState({});

  useEffect(() => {
    if (!showCost || !sb?.loadRunUsage) return;
    sb.loadRunUsage(run.id).then((rows) => {
      const map = {};
      for (const r of rows) {
        const stepId = r.segment_ref_id?.split(':')[1];
        if (!stepId) continue;
        map[stepId] = (map[stepId] || 0) + Number(r.cost_usd || 0);
      }
      setCostByStepId(map);
    });
  }, [run.id, showCost, sb]);
  const cfg = STATUS_CONFIG[effectiveRunStatus(run)] || STATUS_CONFIG.running;
  const isOwner = run.startedBy === currentUserName;

  // The workflow the run was derived from. Needed for the DAG shape
  // (nodes/edges) and node positions. If the workflow has been deleted
  // since the run started, fall back to a synthetic straight-line shape
  // built from stepResults alone — ugly but never blank.
  const workflow = useMemo(() => {
    const found = (workflows || []).find(w => w.id === run.workflowId);
    if (found) return found;
    const steps = (run.stepResults || []).map((sr, i) => ({
      id: sr.stepId,
      type: sr.type,
      name: sr.stepName,
    }));
    const nodes = steps.map((s, i) => ({ id: s.id, type: s.type, position: { x: 80, y: i * 180 } }));
    const edges = [];
    for (let i = 0; i < steps.length - 1; i++) {
      edges.push({
        id: `edge-${steps[i].id}-${steps[i + 1].id}`,
        source: steps[i].id,
        target: steps[i + 1].id,
        sourceHandle: steps[i].type === 'approval' ? 'approved' : 'out',
        targetHandle: 'in',
      });
    }
    return { steps, nodes, edges };
  }, [workflows, run]);

  // Thread approvals into the run object for RunDagView's traversal logic.
  const runWithApprovals = useMemo(
    () => ({ ...run, approvals: approvals || [] }),
    [run, approvals]
  );

  const [selectedStepId, setSelectedStepId] = useState(() => {
    // Default selection: the current action — running, waiting, or the
    // most recently completed step. Empty if nothing has moved yet.
    const sr = run.stepResults || [];
    const active = sr.find(s => s.status === 'running' || s.status === 'waiting');
    if (active) return active.stepId;
    const completed = [...sr].reverse().find(s => s.status === 'completed');
    return completed?.stepId || null;
  });

  useEffect(() => {
    if (onLoadApprovals && !approvals) onLoadApprovals(run.id);
  }, [run.id]); // eslint-disable-line react-hooks/exhaustive-deps

  function approvalsForStep(stepId) {
    return (approvals || []).filter(a => a.step_id === stepId);
  }

  // Status tone for the title pill on the detail view (mirrors the card).
  const eff = effectiveRunStatus(run);
  const tone = STATUS_TONE[eff] || 'is-running';

  return (
    <div className="ob-detail">
      <header className="ob-detail-head">
        <div className="ob-detail-head-left">
          <button className="ob-back" onClick={onBack}>{'←'} Dashboard</button>
          <div className="ob-detail-title">
            <span className="ob-detail-name">{run.workflowName}</span>
            <span className={`ob-card-status ${tone}`}>
              {tone === 'is-running' && <span className="ob-card-status-dot is-pulse" />}
              {cfg.label}
            </span>
          </div>
          <div className="ob-detail-meta">
            Started by <em>{run.startedBy}</em> {'·'} {timeAgo(run.startedAt)}
            {run.completedAt && <> {'·'} finished {timeAgo(run.completedAt)}</>}
          </div>
          <EducationalCue cueId="activity-run-status" show={showEducationalCues} />
        </div>
        {isOwner && (run.status === 'running' || run.status === 'waiting_approval') && onCancelRun && (
          <button
            className="ob-detail-stop"
            onClick={() => onCancelRun(run.id)}
            title="Stop this run"
          >Stop run</button>
        )}
      </header>

      {run.caseInput && (
        <div className="ob-detail-case">
          <span className="ob-detail-case-label">Case input</span>
          <span className="ob-detail-case-text">{run.caseInput}</span>
        </div>
      )}

      <div className="ob-detail-body">
        {/* DAG mirror — vertical chain matching the orchestration node language */}
        <div className="ob-detail-dag">
          <div className="ob-dag-eyebrow">
            <span className="ob-dag-dot" />
            DAG {'·'} {(run.stepResults || []).length} nodes {'·'} {cfg.label.toLowerCase()}
          </div>
          <div className="ob-dag-flow">
            {(run.stepResults || []).map((step, i) => (
              <React.Fragment key={step.stepId}>
                {i > 0 && <div className="ob-dag-edge" />}
                <DagNode
                  step={step}
                  selected={step.stepId === selectedStepId}
                  onClick={() => setSelectedStepId(curr => curr === step.stepId ? null : step.stepId)}
                  cost={showCost ? costByStepId[step.stepId] : null}
                />
              </React.Fragment>
            ))}
          </div>
        </div>

        <aside className="ob-detail-sidebar">
          <div className="ob-detail-sidebar-title">Decisions</div>
          <DecisionList
            run={run}
            selectedStepId={selectedStepId}
            onSelectStep={(id) => setSelectedStepId(curr => curr === id ? null : id)}
            approvalsForStep={approvalsForStep}
            isOwner={isOwner}
            onApprovalAction={onApprovalAction}
            onNudge={onNudge}
          />
        </aside>
      </div>
    </div>
  );
}

// ===== DAG node card =====
// Vertical-chain replacement for the React Flow run view. Same node-type
// stripe colours as the orchestration canvas so participants who learned
// the encoding building the DAG keep reading it the same way at run time.
function DagNode({ step, selected, onClick, cost }) {
  const cls = [
    'ob-dag-node',
    `is-${step.type || 'agent'}`,
    `state-${step.status || 'pending'}`,
    selected && 'is-selected',
  ].filter(Boolean).join(' ');
  const label =
    step.type === 'trigger'  ? 'TRIGGER' :
    step.type === 'approval' ? 'REVIEW'  :
    step.type === 'capture'  ? 'CAPTURE' :
                               'COWORKER';
  const icon =
    step.type === 'trigger'  ? '▶' :
    step.type === 'approval' ? '◷' :
    step.type === 'capture'  ? '✦' :
                               '●';
  const sub =
    step.type === 'agent'    ? (step.coworkerName || step.stepName) :
    step.type === 'approval' ? step.assigneeName :
    step.type === 'capture'  ? 'Compounding into knowledge' :
    null;
  const subLabel =
    step.type === 'agent'    ? 'Coworker' :
    step.type === 'approval' ? 'Reviewer' :
    step.type === 'capture'  ? 'Target' :
    null;
  return (
    <button className={cls} onClick={onClick} type="button">
      <div className="ob-dag-node-row">
        <span className="ob-dag-node-icon">{icon}</span>
        <div className="ob-dag-node-text">
          <div className="ob-dag-node-label">{label}</div>
          <div className="ob-dag-node-name">{step.stepName || label}</div>
        </div>
        <DagStatusBadge status={step.status} />
      </div>
      {sub && (
        <div className="ob-dag-node-sub">
          <span className="ob-dag-node-sub-label">{subLabel}</span>
          <span className="ob-dag-node-sub-value">{sub}</span>
        </div>
      )}
      {cost != null && cost > 0 && (
        <div className="ob-dag-node-sub">
          <span className="ob-dag-node-sub-label">Cost</span>
          <span className="ob-dag-node-sub-value">${cost.toFixed(4)}</span>
        </div>
      )}
    </button>
  );
}

function DagStatusBadge({ status }) {
  if (status === 'completed') return <span className="ob-dag-status is-completed">Done</span>;
  if (status === 'running')   return <span className="ob-dag-status is-running"><span className="ob-card-status-dot is-pulse" />Running</span>;
  if (status === 'waiting')   return <span className="ob-dag-status is-waiting">Waiting</span>;
  if (status === 'error')     return <span className="ob-dag-status is-error">Error</span>;
  return null;
}

// ===== Decision-first sidebar =====
// Rows phrased around who did what, not "Step N <type> <status>". Ordering:
// completed steps by completion time, then whatever's in progress, then
// still-pending (dim). The selected row expands inline with output /
// decision log / approval form.
function DecisionList({ run, selectedStepId, onSelectStep, approvalsForStep, isOwner, onApprovalAction, onNudge }) {
  const [comment, setComment] = useState('');

  // Bucket + order the steps so the list reads as a timeline of decisions
  // rather than the arbitrary authoring order. Completed first (in time
  // order), then active (running/waiting), then not-yet-reached (pending).
  const ordered = useMemo(() => {
    const sr = run.stepResults || [];
    const done = sr
      .filter(s => s.status === 'completed' || s.status === 'skipped' || s.status === 'error')
      .sort((a, b) => (a.completedAt || 0) - (b.completedAt || 0));
    const active = sr.filter(s => s.status === 'running' || s.status === 'waiting');
    const pending = sr.filter(s => s.status === 'pending');
    return [...done, ...active, ...pending];
  }, [run.stepResults]);

  return (
    <div className="ob-detail-decisions">
      {ordered.map(step => (
        <DecisionRow
          key={step.stepId}
          step={step}
          run={run}
          isSelected={step.stepId === selectedStepId}
          onSelect={() => onSelectStep(step.stepId)}
          approvalsForStep={approvalsForStep}
          isOwner={isOwner}
          comment={comment}
          setComment={setComment}
          onApprovalAction={onApprovalAction}
          onNudge={onNudge}
        />
      ))}
    </div>
  );
}

// ===== Decision row =====
// Each row reads like a headline: actor + verb + object, with a small meta
// line below (when, how long, comment). Expanded rows show the full output
// / decision log / approval controls depending on step state.
function DecisionRow({ step, run, isSelected, onSelect, approvalsForStep, isOwner, comment, setComment, onApprovalAction, onNudge }) {
  const state = step.status;
  const isReview = step.type === 'approval';
  const isTrigger = step.type === 'trigger';
  const stepApprovals = isReview ? approvalsForStep(step.stepId) : [];
  const latestApproval = stepApprovals[stepApprovals.length - 1];

  // Headline phrased around the decision, not the step index.
  let headline;
  let subject;
  if (isTrigger) {
    headline = 'started the case';
    subject = run.startedBy || 'someone';
  } else if (isReview) {
    if (state === 'completed' && latestApproval) {
      const verb = latestApproval.action === 'Approve'
        ? 'approved'
        : latestApproval.action === 'Reject'
          ? 'rejected'
          : latestApproval.action.toLowerCase();
      headline = `${verb}`;
      subject = latestApproval.resolved_by || step.assigneeName || 'reviewer';
    } else if (state === 'waiting') {
      headline = 'is reviewing';
      subject = step.assigneeName || 'reviewer';
    } else if (state === 'skipped') {
      headline = 'was skipped';
      subject = step.assigneeName || 'reviewer';
    } else {
      headline = 'up next';
      subject = step.assigneeName || 'reviewer';
    }
  } else {
    // Coworker step
    if (state === 'completed') {
      headline = 'finished';
      subject = step.coworkerName || step.stepName || 'coworker';
    } else if (state === 'running') {
      headline = 'is working';
      subject = step.coworkerName || step.stepName || 'coworker';
    } else if (state === 'error') {
      headline = 'hit an error';
      subject = step.coworkerName || step.stepName || 'coworker';
    } else if (state === 'skipped') {
      headline = 'was skipped';
      subject = step.coworkerName || step.stepName || 'coworker';
    } else {
      headline = 'up next';
      subject = step.coworkerName || step.stepName || 'coworker';
    }
  }

  // Meta line: timing + decision comment if any.
  const metaBits = [];
  if (step.completedAt) metaBits.push(timeAgo(step.completedAt));
  else if (step.startedAt && state === 'running') metaBits.push(`started ${timeAgo(step.startedAt)}`);
  if (step.completedAt && step.startedAt) {
    const dur = step.completedAt - step.startedAt;
    metaBits.push(dur < 1000 ? `${dur}ms` : dur < 60000 ? `${(dur / 1000).toFixed(1)}s` : `${Math.floor(dur / 60000)}m`);
  }

  return (
    <div className={`ob-row state-${state || 'pending'}${isSelected ? ' is-selected' : ''}`} onClick={onSelect}>
      <div className="ob-row-main">
        <span className={`ob-row-dot state-${state || 'pending'}`} />
        <div className="ob-row-text">
          <div className="ob-row-headline">
            <span className="ob-row-subject">{subject}</span>
            <span className="ob-row-verb"> {headline}</span>
          </div>
          {(metaBits.length > 0 || latestApproval?.comment) && (
            <div className="ob-row-meta">
              {metaBits.join(' · ')}
              {latestApproval?.comment && <> {metaBits.length > 0 && '·'} “{latestApproval.comment}”</>}
            </div>
          )}
        </div>
      </div>

      {isSelected && (
        <div className="ob-row-expand" onClick={e => e.stopPropagation()}>
          {/* Trigger — show the case input the run started with */}
          {isTrigger && step.output && (
            <div className="ob-step-output md-doc"><RichText content={String(step.output)} /></div>
          )}
          {isTrigger && !step.output && (
            <div className="ob-step-empty">No case input captured.</div>
          )}

          {/* Coworker — output rendered as markdown so headings/lists read
              cleanly, plus status placeholders for non-terminal states. */}
          {!isReview && !isTrigger && step.type !== 'capture' && state === 'completed' && step.output && (
            <div className="ob-step-output md-doc"><RichText content={String(step.output)} /></div>
          )}
          {!isReview && !isTrigger && step.type !== 'capture' && state === 'running' && (
            <div className="ob-step-running">
              <span className="ob-loading"><span></span><span></span><span></span></span>
              <span>Processing…</span>
            </div>
          )}
          {!isReview && !isTrigger && step.type !== 'capture' && state === 'error' && (
            <div className="ob-step-error">
              {step.output ? String(step.output) : 'Step errored with no detail.'}
            </div>
          )}
          {!isReview && !isTrigger && step.type !== 'capture' && (state === 'pending' || !state) && (
            <div className="ob-step-empty">Hasn\'t run yet.</div>
          )}
          {!isReview && !isTrigger && step.type !== 'capture' && state === 'skipped' && (
            <div className="ob-step-empty">Skipped during this run.</div>
          )}

          {/* Capture — what compounded into which file. */}
          {step.type === 'capture' && state === 'completed' && (
            <div className="ob-step-output">{step.output || 'Captured.'}</div>
          )}
          {step.type === 'capture' && state !== 'completed' && (
            <div className="ob-step-empty">
              {state === 'skipped' ? 'Skipped.' : state === 'running' ? 'Capturing…' : 'Hasn\'t run yet.'}
            </div>
          )}

          {/* Review — decision log of past resolutions. */}
          {isReview && stepApprovals.length > 0 && (
            <div className="ob-decisionlog">
              <div className="ob-decisionlog-title">Decision log</div>
              {stepApprovals.map(a => {
                const kind = a.action === 'Approve' ? 'approve'
                  : a.action === 'Reject' ? 'reject'
                  : a.action === 'Request Correction' ? 'correction'
                  : a.action === 'Escalate' ? 'escalate'
                  : 'reject';
                return (
                  <div key={a.id} className={`ob-decisionlog-entry is-${kind}`}>
                    <div className="ob-decisionlog-head">
                      <span className={`ob-decisionlog-action is-${kind}`}>{a.action}</span>
                      <span className="ob-decisionlog-who">by {a.resolved_by || 'unknown'}</span>
                      <span className="ob-decisionlog-when">{timeAgo(new Date(a.resolved_at).getTime())}</span>
                    </div>
                    {a.comment && <div className="ob-decisionlog-comment">“{a.comment}”</div>}
                  </div>
                );
              })}
            </div>
          )}

          {/* Approval form for the run owner when this review is waiting */}
          {isReview && state === 'waiting' && isOwner && (
            <div className="ob-approval">
              <div className="ob-approval-prompt">
                Waiting for <em>{step.assigneeName || 'a reviewer'}</em> to take action.
              </div>
              <textarea
                className="ob-approval-comment"
                placeholder="Add a comment (optional)…"
                value={comment}
                onChange={e => setComment(e.target.value)}
                rows={2}
              />
              <div className="ob-approval-actions">
                {['Approve', 'Reject', 'Request Correction', 'Escalate'].map(action => {
                  const kind = action === 'Approve' ? 'approve' : action === 'Reject' ? 'reject' : action === 'Request Correction' ? 'correction' : 'escalate';
                  return (
                    <button
                      key={action}
                      className={`ob-approval-btn is-${kind}`}
                      onClick={() => onApprovalAction(run.id, null, action, comment)}
                    >
                      {action}
                    </button>
                  );
                })}
              </div>
              <button className="ob-approval-nudge" onClick={() => onNudge(run.id)}>
                Nudge {step.assigneeName || 'reviewer'}
              </button>
            </div>
          )}

          {/* Waiting on someone else — small note + nudge. */}
          {isReview && state === 'waiting' && !isOwner && (
            <div className="ob-approval">
              <div className="ob-approval-prompt ob-approval-prompt-muted">
                Waiting on <em>{step.assigneeName || 'a reviewer'}</em>. {run.startedBy ? `Only ${run.startedBy} can resolve this here.` : ''}
              </div>
              <button className="ob-approval-nudge" onClick={() => onNudge(run.id)}>
                Nudge {step.assigneeName || 'reviewer'}
              </button>
            </div>
          )}

          {/* Review not yet reached */}
          {isReview && state !== 'waiting' && stepApprovals.length === 0 && (
            <div className="ob-step-empty">
              {state === 'skipped' ? 'Skipped.' : state === 'pending' || !state ? 'Hasn\'t been reached yet.' : 'No decision recorded.'}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ===== Main Dashboard =====
export default function ActivityDashboard({ workflowRuns, onApprovalAction, onCancelRun, onNudge, participants, currentUserName, coworkers, workflows, showEducationalCues, approvalsByRun, onLoadApprovals, currentStage, sb }) {
  // Tick once a minute so timestamps like "5m ago" advance live.
  useTick(60_000);
  const [selectedRunId, setSelectedRunId] = useState(null);

  const selectedRun = selectedRunId ? workflowRuns.find(r => r.id === selectedRunId) : null;

  // Two buckets per the Stage 7 spec: Active (in-flight or waiting on a human)
  // and Recent (finished, rejected, errored). Active sorts newest-first so a
  // fresh run jumps to the top; Recent sorts by completion time.
  const activeRuns = workflowRuns
    .filter(r => r.status === 'running' || r.status === 'waiting_approval')
    .sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0));
  const recentRuns = workflowRuns
    .filter(r => r.status === 'completed' || r.status === 'rejected' || r.status === 'error' || r.status === 'cancelled')
    .sort((a, b) => (b.completedAt || b.startedAt || 0) - (a.completedAt || a.startedAt || 0));
  const pendingReviewCount = activeRuns.filter(r => r.status === 'waiting_approval').length;
  const [showRecent, setShowRecent] = useState(true);
  // Cap how many completed runs hit the DOM at once. With 35 pax × multiple
  // runs over 6h, the recent section can grow past 100 cards — each with
  // expandable RunDagView state. "Show older" reveals the rest in chunks
  // so we never render hundreds at once on a low-end laptop.
  const RECENT_PAGE_SIZE = 30;
  const [recentLimit, setRecentLimit] = useState(RECENT_PAGE_SIZE);
  const visibleRecent = recentRuns.slice(0, recentLimit);
  const hasMoreRecent = recentRuns.length > recentLimit;

  if (selectedRun) {
    return (
      <RunDetailView
        run={selectedRun}
        onBack={() => setSelectedRunId(null)}
        onApprovalAction={onApprovalAction}
        onCancelRun={onCancelRun}
        onNudge={onNudge}
        showEducationalCues={showEducationalCues}
        currentUserName={currentUserName}
        approvals={approvalsByRun?.[selectedRun.id]}
        onLoadApprovals={onLoadApprovals}
        workflows={workflows}
        currentStage={currentStage}
        sb={sb}
      />
    );
  }

  return (
    <div className="ob-page">
      <header className="ob-page-head">
        <div className="ob-page-head-left">
          <div className="ob-page-eyebrow">Stage 7 · Observability</div>
          <h1 className="ob-page-title">Everything your mixed team did, <em>on the record</em>.</h1>
          <p className="ob-page-sub">
            Each run is an artifact; each decision is logged.
          </p>
          <EducationalCue cueId="activity-dashboard" show={showEducationalCues} />
        </div>
        <div className="ob-page-stats">
          {activeRuns.length > 0 && (
            <span className="ob-stat is-running">
              <span className="ob-card-status-dot is-pulse" />
              {activeRuns.length} active
            </span>
          )}
          {pendingReviewCount > 0 && (
            <span className="ob-stat is-waiting">{pendingReviewCount} awaiting review</span>
          )}
          {recentRuns.length > 0 && (
            <span className="ob-stat is-completed">{recentRuns.length} recent</span>
          )}
        </div>
      </header>

      <div className="ob-page-body">
        {workflowRuns.length === 0 && (
          <div className="ob-empty">
            <p className="ob-empty-title">No runs yet</p>
            <p className="ob-empty-desc">Go to Orchestration and click Run on a workflow. Active runs land here — visible to everyone in the room.</p>
          </div>
        )}

        {activeRuns.length > 0 && (
          <div className="ob-section">
            <div className="ob-section-head">
              <span className="ob-section-title">Active</span>
              <span className="ob-section-count">{activeRuns.length}</span>
            </div>
            <div className="ob-grid">
              {activeRuns.map(run => (
                <RunCard key={run.id} run={run} onClick={setSelectedRunId} onNudge={onNudge} showEducationalCues={showEducationalCues} />
              ))}
            </div>
          </div>
        )}

        {recentRuns.length > 0 && (
          <div className="ob-section">
            <div
              className="ob-section-head"
              onClick={() => setShowRecent(!showRecent)}
              style={{ cursor: 'pointer' }}
            >
              <span className="ob-section-title">{showRecent ? '▾' : '▸'} Recent</span>
              <span className="ob-section-count">{recentRuns.length}</span>
            </div>
            {showRecent && (
              <>
                <div className="ob-grid">
                  {visibleRecent.map(run => (
                    <RunCard key={run.id} run={run} onClick={setSelectedRunId} onNudge={onNudge} showEducationalCues={showEducationalCues} />
                  ))}
                </div>
                {hasMoreRecent && (
                  <div style={{ textAlign: 'center', padding: '12px 0' }}>
                    <button
                      onClick={() => setRecentLimit(n => n + RECENT_PAGE_SIZE)}
                      style={{
                        background: 'var(--paper, #fffdf9)',
                        border: '1px solid var(--rule-soft, #e6dcc6)',
                        borderRadius: 999,
                        padding: '6px 16px',
                        fontSize: 12,
                        fontFamily: 'var(--mono, monospace)',
                        letterSpacing: '0.12em',
                        textTransform: 'uppercase',
                        color: 'var(--ink-muted, #8a7a64)',
                        cursor: 'pointer',
                      }}
                    >
                      Show older runs ({recentRuns.length - recentLimit} more)
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
