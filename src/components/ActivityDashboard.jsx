import { useState } from 'react';
import ActivityLog from './ActivityLog';
import EducationalCue from './EducationalCue';
import { CoworkerGlyph } from './Icon';

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
  const completedSteps = run.stepResults.filter(s => s.status === 'completed').length;
  const totalSteps = run.stepResults.length;
  const waitingStep = run.stepResults.find(s => s.status === 'waiting');

  return (
    <div className="rcard" onClick={() => onClick(run.id)}>
      <div className="rcard-top">
        <span className="rcard-name">{run.workflowName}</span>
        <span className="rcard-status" style={{ color: cfg.color, background: cfg.bg }}>{cfg.label}</span>
      </div>

      {/* Progress bar */}
      <div className="rcard-progress">
        {run.stepResults.map((step, i) => (
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
function RunDetailView({ run, onBack, onApprovalAction, onNudge, showEducationalCues }) {
  const [expandedStep, setExpandedStep] = useState(null);
  const [comment, setComment] = useState('');
  const cfg = STATUS_CONFIG[run.status] || STATUS_CONFIG.running;

  return (
    <div className="rdetail">
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
        <EducationalCue cueId="activity-run-status" show={showEducationalCues} />
      </div>

      {/* Case input */}
      <div className="rdetail-case">
        <div className="rdetail-case-label">Case Input</div>
        <div className="rdetail-case-text">{run.caseInput}</div>
      </div>

      {/* Steps */}
      <div className="rdetail-steps">
        {run.stepResults.map((step, i) => {
          const isExpanded = expandedStep === i;
          const stepCfg = step.status === 'completed' ? { color: '#5a9e6f', icon: '\u2713' }
            : step.status === 'running' ? { color: '#4a7fb5', icon: '\u25CF' }
            : step.status === 'waiting' ? { color: '#c8956c', icon: '\u25CB' }
            : step.status === 'error' ? { color: '#c45c5c', icon: '\u2715' }
            : { color: 'var(--text-muted)', icon: '\u25CB' };

          return (
            <div key={i} className={`rdetail-step ${step.status}`}>
              <div className="rdetail-step-header" onClick={() => setExpandedStep(isExpanded ? null : i)}>
                <span className="rdetail-step-icon" style={{ background: stepCfg.color }}>
                  {isIconOrImage(step.coworkerAvatar)
                    ? <CoworkerGlyph avatar={step.coworkerAvatar} size={12} color="#ffffff" />
                    : (step.coworkerAvatar || stepCfg.icon)}
                </span>
                <span className="rdetail-step-number">Step {i + 1}</span>
                <span className="rdetail-step-name">{step.stepName}</span>
                {step.coworkerName && <span className="rdetail-step-agent">{step.coworkerName}</span>}
                {step.assigneeName && <span className="rdetail-step-agent">{step.assigneeName}</span>}
                <span className="rdetail-step-status" style={{ color: stepCfg.color }}>{step.status}</span>
              </div>

              {/* Expanded: show output or approval UI */}
              {isExpanded && step.output && step.status === 'completed' && (
                <div className="rdetail-step-output">{step.output}</div>
              )}

              {step.status === 'waiting' && (
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

              {step.status === 'running' && (
                <div className="rdetail-step-running">
                  <div className="cl-loading"><span></span><span></span><span></span></div>
                  <span>Processing...</span>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ===== Main Dashboard =====
export default function ActivityDashboard({ workflowRuns, logs, onApprovalAction, onNudge, participants, currentUserName, coworkers, workflows, showEducationalCues }) {
  const [view, setView] = useState('dashboard'); // 'dashboard' | 'log'
  const [selectedRunId, setSelectedRunId] = useState(null);

  const selectedRun = selectedRunId ? workflowRuns.find(r => r.id === selectedRunId) : null;

  const pendingRuns = workflowRuns.filter(r => r.status === 'waiting_approval');
  const activeRuns = workflowRuns.filter(r => r.status === 'running');
  const completedRuns = workflowRuns.filter(r => r.status === 'completed' || r.status === 'rejected' || r.status === 'error');
  const [showCompleted, setShowCompleted] = useState(true);

  if (selectedRun) {
    return (
      <RunDetailView
        run={selectedRun}
        onBack={() => setSelectedRunId(null)}
        onApprovalAction={onApprovalAction}
        onNudge={onNudge}
        showEducationalCues={showEducationalCues}
      />
    );
  }

  return (
    <div className="adash">
      {/* View toggle */}
      <div className="adash-header">
        <div className="adash-toggle">
          <button className={`adash-toggle-btn${view === 'dashboard' ? ' active' : ''}`} onClick={() => setView('dashboard')}>
            Dashboard
          </button>
          <button className={`adash-toggle-btn${view === 'log' ? ' active' : ''}`} onClick={() => setView('log')}>
            Log View
          </button>
        </div>
        <div className="adash-summary">
          <EducationalCue cueId="activity-dashboard" show={showEducationalCues} />
          {activeRuns.length > 0 && <span className="adash-stat running">{activeRuns.length} running</span>}
          {pendingRuns.length > 0 && <span className="adash-stat waiting">{pendingRuns.length} pending</span>}
          {completedRuns.length > 0 && <span className="adash-stat completed">{completedRuns.length} done</span>}
        </div>
      </div>

      {view === 'log' ? (
        <ActivityLog logs={logs} showEducationalCues={showEducationalCues} />
      ) : (
        <div className="adash-body">
          {workflowRuns.length === 0 && (
            <div className="adash-empty">
              <p className="adash-empty-title">No orchestration runs yet</p>
              <p className="adash-empty-desc">Go to the Orchestration tab and click Run to start one. Active runs will appear here.</p>
            </div>
          )}

          {pendingRuns.length > 0 && (
            <div className="adash-section">
              <div className="adash-section-title adash-section-pending">Pending Reviews ({pendingRuns.length})</div>
              <div className="adash-grid">
                {pendingRuns.map(run => (
                  <RunCard key={run.id} run={run} onClick={setSelectedRunId} onNudge={onNudge} showEducationalCues={showEducationalCues} />
                ))}
              </div>
            </div>
          )}

          {activeRuns.length > 0 && (
            <div className="adash-section">
              <div className="adash-section-title adash-section-active">Active Runs ({activeRuns.length})</div>
              <div className="adash-grid">
                {activeRuns.map(run => (
                  <RunCard key={run.id} run={run} onClick={setSelectedRunId} onNudge={onNudge} showEducationalCues={showEducationalCues} />
                ))}
              </div>
            </div>
          )}

          {completedRuns.length > 0 && (
            <div className="adash-section">
              <div className="adash-section-title adash-section-completed" onClick={() => setShowCompleted(!showCompleted)} style={{ cursor: 'pointer' }}>
                {showCompleted ? '\u25BE' : '\u25B8'} Completed ({completedRuns.length})
              </div>
              {showCompleted && (
                <div className="adash-grid">
                  {completedRuns.map(run => (
                    <RunCard key={run.id} run={run} onClick={setSelectedRunId} onNudge={onNudge} showEducationalCues={showEducationalCues} />
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
