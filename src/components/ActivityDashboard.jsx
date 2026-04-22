import { useState, useEffect, useMemo } from 'react';
import EducationalCue from './EducationalCue';
import { CoworkerGlyph } from './Icon';
import RunDagView from './RunDagView';
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
  rejected: { label: 'Rejected', color: '#c45c5c', bg: '#fdf0f0' },
  error: { label: 'Error', color: '#c45c5c', bg: '#fdf0f0' },
};

const STEP_STATUS_ICON = {
  completed: '\u2713',
  running: '\u25CF',
  waiting: '\u25CB',
  pending: '\u25CB',
  error: '\u2715',
};

// ===== Run Card =====
function RunCard({ run, onClick, onNudge, showEducationalCues }) {
  const cfg = STATUS_CONFIG[run.status] || STATUS_CONFIG.running;
  const stepResults = run.stepResults || [];
  const completedSteps = stepResults.filter(s => s.status === 'completed').length;
  const totalSteps = stepResults.length;
  const waitingStep = stepResults.find(s => s.status === 'waiting');

  return (
    <div className="rcard" onClick={() => onClick(run.id)}>
      <div className="rcard-top">
        <span className="rcard-name">{run.workflowName}</span>
        <span className="rcard-status" style={{ color: cfg.color, background: cfg.bg }}>{cfg.label}</span>
      </div>

      {/* Progress bar */}
      <div className="rcard-progress">
        {stepResults.map((step, i) => (
          <div key={i} className="rcard-progress-item">
            {i > 0 && <span className="rcard-progress-line" style={{ background: step.status === 'completed' ? cfg.color : 'var(--border-color)' }}></span>}
            <span className={`rcard-progress-dot ${step.status}`} style={step.status === 'completed' || step.status === 'running' ? { background: cfg.color } : {}}>
              {isIconOrImage(step.coworkerAvatar)
                ? <CoworkerGlyph avatar={step.coworkerAvatar} size={10} color="#ffffff" />
                : (step.coworkerAvatar || STEP_STATUS_ICON[step.status] || '\u25CB')}
            </span>
          </div>
        ))}
        <span className="rcard-progress-label">{completedSteps}/{totalSteps}</span>
      </div>

      <div className="rcard-meta">
        <span>Started by {run.startedBy}</span>
        <span>{timeAgo(run.startedAt)}</span>
      </div>

      {waitingStep && (
        <>
          <div className="rcard-waiting">
            <span>Waiting on {waitingStep.assigneeName || 'reviewer'}</span>
            <button className="rcard-nudge" onClick={e => { e.stopPropagation(); onNudge(run.id); }}>Nudge</button>
          </div>
          <EducationalCue cueId="activity-nudge" show={showEducationalCues} />
        </>
      )}
    </div>
  );
}

// ===== Run Detail View =====
// DAG mirror on the left, decision-first sidebar on the right. Clicking a
// node selects it on both sides; the sidebar row expands inline with the
// step's output, decision log, or (if it's the run owner's turn) the
// approval form.
function RunDetailView({ run, onBack, onApprovalAction, onCancelRun, onNudge, showEducationalCues, currentUserName, approvals, onLoadApprovals, workflows, currentStage, sb }) {
  const showCost = stageReached(currentStage, '7b');
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
  const cfg = STATUS_CONFIG[run.status] || STATUS_CONFIG.running;
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

  return (
    <div className="rdetail-v2">
      <div className="rdetail-header">
        <button className="files-back-btn" onClick={onBack}>{'\u2190'} Dashboard</button>
        <div className="rdetail-title">
          <span className="rdetail-name">{run.workflowName}</span>
          <span className="rcard-status" style={{ color: cfg.color, background: cfg.bg }}>{cfg.label}</span>
        </div>
        <div className="rdetail-meta">
          Started by {run.startedBy} {'\u00B7'} {timeAgo(run.startedAt)}
          {run.completedAt && <> {'\u00B7'} Finished {timeAgo(run.completedAt)}</>}
        </div>
        {isOwner && (run.status === 'running' || run.status === 'waiting_approval') && onCancelRun && (
          <button
            className="run-btn run-btn-stop"
            style={{ marginLeft: 'auto' }}
            onClick={() => onCancelRun(run.id)}
            title="Stop this run"
          >Stop</button>
        )}
        <EducationalCue cueId="activity-run-status" show={showEducationalCues} />
      </div>

      <div className="rdetail-v2-case">
        <span className="rdetail-case-label">Case Input</span>
        <span className="rdetail-case-text">{run.caseInput}</span>
      </div>

      <div className="rdetail-v2-body">
        <div className="rdetail-v2-dag">
          <RunDagView
            workflow={workflow}
            run={runWithApprovals}
            selectedStepId={selectedStepId}
            onSelectStep={setSelectedStepId}
            costByStepId={showCost ? costByStepId : null}
          />
        </div>

        <aside className="rdetail-v2-sidebar">
          <div className="rdetail-v2-sidebar-title">Decisions</div>
          <DecisionList
            run={run}
            selectedStepId={selectedStepId}
            onSelectStep={setSelectedStepId}
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
    <div className="rdetail-v2-decisions">
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
    headline = 'Case started';
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
    <div className={`rdetail-v2-row status-${state}${isSelected ? ' selected' : ''}`} onClick={onSelect}>
      <div className="rdetail-v2-row-main">
        <span className={`rdetail-v2-row-dot status-${state}`} />
        <div className="rdetail-v2-row-text">
          <div className="rdetail-v2-row-headline">
            <span className="rdetail-v2-row-subject">{subject}</span>
            <span className="rdetail-v2-row-verb"> {headline}</span>
          </div>
          {(metaBits.length > 0 || latestApproval?.comment) && (
            <div className="rdetail-v2-row-meta">
              {metaBits.join(' \u00B7 ')}
              {latestApproval?.comment && <> {metaBits.length > 0 && '\u00B7'} &ldquo;{latestApproval.comment}&rdquo;</>}
            </div>
          )}
        </div>
      </div>

      {isSelected && (
        <div className="rdetail-v2-row-expand" onClick={e => e.stopPropagation()}>
          {/* Coworker output */}
          {!isReview && step.status === 'completed' && step.output && (
            <div className="rdetail-step-output">{step.output}</div>
          )}

          {/* Decision log for review steps */}
          {isReview && stepApprovals.length > 0 && (
            <div className="rdetail-decisionlog">
              <div className="rdetail-decisionlog-title">Decision log</div>
              {stepApprovals.map(a => (
                <div key={a.id} className={`rdetail-decisionlog-entry ${a.action === 'Approve' ? 'approve' : 'reject'}`}>
                  <div className="rdetail-decisionlog-head">
                    <span className={`rdetail-decisionlog-action ${a.action === 'Approve' ? 'approve' : 'reject'}`}>{a.action}</span>
                    <span className="rdetail-decisionlog-who">by {a.resolved_by || 'unknown'}</span>
                    <span className="rdetail-decisionlog-when">{timeAgo(new Date(a.resolved_at).getTime())}</span>
                  </div>
                  {a.comment && <div className="rdetail-decisionlog-comment">&ldquo;{a.comment}&rdquo;</div>}
                </div>
              ))}
            </div>
          )}

          {/* Approval form for the run owner when this review is waiting */}
          {isReview && state === 'waiting' && isOwner && (
            <div className="rdetail-step-approval">
              <div className="rdetail-step-approval-prompt">
                Waiting for {step.assigneeName || 'reviewer'} to take action.
              </div>
              <textarea
                className="cl-approval-comment"
                placeholder="Add a comment (optional)..."
                value={comment}
                onChange={e => setComment(e.target.value)}
                rows={2}
              />
              <div className="cl-approval-actions">
                {['Approve', 'Reject', 'Request Correction', 'Escalate'].map(action => {
                  const cls = action === 'Approve' ? 'approve' : action === 'Reject' ? 'reject' : action === 'Request Correction' ? 'correction' : 'escalate';
                  return (
                    <button key={action} className={`cl-approval-btn ${cls}`} onClick={() => onApprovalAction(run.id, null, action, comment)}>
                      {action}
                    </button>
                  );
                })}
              </div>
              <button className="rcard-nudge" style={{ marginTop: 8 }} onClick={() => onNudge(run.id)}>
                Nudge {step.assigneeName || 'reviewer'}
              </button>
            </div>
          )}

          {/* Waiting on someone else */}
          {isReview && state === 'waiting' && !isOwner && (
            <div className="rdetail-step-approval">
              <div className="rdetail-step-approval-prompt" style={{ color: 'var(--text-muted)' }}>
                Waiting on {step.assigneeName || 'a reviewer'}. Only {run.startedBy} (who started this run) can resolve it from this view.
              </div>
            </div>
          )}

          {/* Coworker in flight */}
          {!isReview && state === 'running' && (
            <div className="rdetail-step-running">
              <div className="cl-loading"><span></span><span></span><span></span></div>
              <span>Processing...</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ===== Main Dashboard =====
export default function ActivityDashboard({ workflowRuns, onApprovalAction, onCancelRun, onNudge, participants, currentUserName, coworkers, workflows, showEducationalCues, approvalsByRun, onLoadApprovals, currentStage, sb }) {
  const [selectedRunId, setSelectedRunId] = useState(null);

  const selectedRun = selectedRunId ? workflowRuns.find(r => r.id === selectedRunId) : null;

  // Two buckets per the Stage 7 spec: Active (in-flight or waiting on a human)
  // and Recent (finished, rejected, errored). Active sorts newest-first so a
  // fresh run jumps to the top; Recent sorts by completion time.
  const activeRuns = workflowRuns
    .filter(r => r.status === 'running' || r.status === 'waiting_approval')
    .sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0));
  const recentRuns = workflowRuns
    .filter(r => r.status === 'completed' || r.status === 'rejected' || r.status === 'error')
    .sort((a, b) => (b.completedAt || b.startedAt || 0) - (a.completedAt || a.startedAt || 0));
  const pendingReviewCount = activeRuns.filter(r => r.status === 'waiting_approval').length;
  const [showRecent, setShowRecent] = useState(true);

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
    <div className="adash">
      <div className="adash-header">
        <h2 className="adash-title">Observability</h2>
        <div className="adash-summary">
          <EducationalCue cueId="activity-dashboard" show={showEducationalCues} />
          {activeRuns.length > 0 && <span className="adash-stat running">{activeRuns.length} active</span>}
          {pendingReviewCount > 0 && <span className="adash-stat waiting">{pendingReviewCount} awaiting review</span>}
          {recentRuns.length > 0 && <span className="adash-stat completed">{recentRuns.length} recent</span>}
        </div>
      </div>

      <div className="adash-body">
        {workflowRuns.length === 0 && (
          <div className="adash-empty">
            <p className="adash-empty-title">No orchestration runs yet</p>
            <p className="adash-empty-desc">Go to the Orchestration tab and click Run to start one. Active runs will appear here — everyone in the workshop can see them.</p>
          </div>
        )}

        {activeRuns.length > 0 && (
          <div className="adash-section">
            <div className="adash-section-title adash-section-active">Active ({activeRuns.length})</div>
            <div className="adash-grid">
              {activeRuns.map(run => (
                <RunCard key={run.id} run={run} onClick={setSelectedRunId} onNudge={onNudge} showEducationalCues={showEducationalCues} />
              ))}
            </div>
          </div>
        )}

        {recentRuns.length > 0 && (
          <div className="adash-section">
            <div className="adash-section-title adash-section-completed" onClick={() => setShowRecent(!showRecent)} style={{ cursor: 'pointer' }}>
              {showRecent ? '\u25BE' : '\u25B8'} Recent ({recentRuns.length})
            </div>
            {showRecent && (
              <div className="adash-grid">
                {recentRuns.map(run => (
                  <RunCard key={run.id} run={run} onClick={setSelectedRunId} onNudge={onNudge} showEducationalCues={showEducationalCues} />
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
