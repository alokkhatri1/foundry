import { useEffect, useMemo, useState } from 'react';
import { computeScorecard, LEVELS, LEVEL_COLORS } from '../utils/graduationScorecard';

// Graduation screen — the "Own it" moment at workshop end. Computes a
// competency scorecard per participant from their actual platform activity
// and renders per-dimension levels (Awareness → Application → Mastery →
// Influence) plus an overall band. The rubric lives in
// src/utils/graduationScorecard.js; this component is display-only.
export default function GraduationScreen({
  userName,
  conversations,
  coworkers,
  workflows,
  workflowRuns,
  flatFiles,
  participants,
  loadAllRoomApprovals,
  onSignOut,
  embedded = false,
}) {
  const [approvals, setApprovals] = useState(null);

  // One-shot load of every approval in the room for accurate cross-participant
  // scoring (influence = reviews for 2+ peers, etc). Realtime subscription
  // isn't needed here — graduation is a read-only moment.
  useEffect(() => {
    let cancelled = false;
    loadAllRoomApprovals?.().then(rows => {
      if (!cancelled) setApprovals(rows || []);
    }).catch(() => { if (!cancelled) setApprovals([]); });
    return () => { cancelled = true; };
  }, [loadAllRoomApprovals]);

  const scorecard = useMemo(() => {
    if (approvals === null) return null;
    return computeScorecard({
      userName, conversations, coworkers, workflows, workflowRuns,
      flatFiles, participants, approvals,
    });
  }, [userName, conversations, coworkers, workflows, workflowRuns, flatFiles, participants, approvals]);

  const totalMessages = (conversations || []).reduce((sum, c) => sum + (c.messages?.length || 0), 0);
  const filesCount = (flatFiles || []).filter(f => f.type === 'file').length;
  const coworkersCount = (coworkers || []).length;
  const runsCount = (workflowRuns || []).length;

  const overall = scorecard?.overallLevel ?? 0;
  const overallLabel = LEVELS[overall];

  return (
    <div className={`grad-page${embedded ? ' embedded' : ''}`}>
      <div className="grad-container">
        <div className="grad-header">
          <div className="grad-eyebrow">Graduation</div>
          <h1 className="grad-title">Thanks for participating, {userName}.</h1>
          <p className="grad-subtitle">
            A read of your workshop activity — what you built, reviewed, and shaped. Everything is preserved in the workshop archive.
          </p>
        </div>

        {/* Quick tally */}
        <div className="grad-tally">
          <div className="grad-tally-item">
            <div className="grad-tally-num">{totalMessages}</div>
            <div className="grad-tally-label">messages</div>
          </div>
          <div className="grad-tally-item">
            <div className="grad-tally-num">{filesCount}</div>
            <div className="grad-tally-label">files</div>
          </div>
          <div className="grad-tally-item">
            <div className="grad-tally-num">{coworkersCount}</div>
            <div className="grad-tally-label">coworkers</div>
          </div>
          <div className="grad-tally-item">
            <div className="grad-tally-num">{runsCount}</div>
            <div className="grad-tally-label">workflow runs</div>
          </div>
        </div>

        {/* Scorecard */}
        {scorecard === null ? (
          <div className="grad-loading">Computing your scorecard\u2026</div>
        ) : (
          <>
            <div className="grad-overall">
              <div className="grad-overall-label">Overall level</div>
              <div className="grad-overall-badge" style={{ background: LEVEL_COLORS[overall] }}>
                {overallLabel}
              </div>
              <div className="grad-overall-hint">
                {overall === 0 && 'No activity recorded yet.'}
                {overall === 1 && 'You\u2019ve seen the shape of each primitive.'}
                {overall === 2 && 'You put every piece into practice at least once.'}
                {overall === 3 && 'You moved past first-use and started refining.'}
                {overall === 4 && 'Your work influenced how others on the team worked.'}
              </div>
            </div>

            <div className="grad-dimensions">
              <div className="grad-dim-head">Competencies</div>
              {scorecard.dimensions.map(d => (
                <div key={d.key} className="grad-dim-row">
                  <div className="grad-dim-left">
                    <div className="grad-dim-label">{d.label}</div>
                    <div className="grad-dim-hint">{d.hint}</div>
                  </div>
                  <div className="grad-dim-ladder">
                    {[1, 2, 3, 4].map(step => (
                      <div
                        key={step}
                        className={`grad-dim-rung${step <= d.level ? ' on' : ''}${step === d.level ? ' current' : ''}`}
                        style={step === d.level ? { background: LEVEL_COLORS[d.level], color: '#fff' } : {}}
                        title={LEVELS[step]}
                      >
                        {step === d.level ? LEVELS[step] : ''}
                      </div>
                    ))}
                  </div>
                  <div className="grad-dim-evidence">{d.evidence}</div>
                </div>
              ))}
            </div>
          </>
        )}

        {!embedded && (
          <div className="grad-footer">
            <button className="landing-join-btn grad-signout-btn" onClick={onSignOut}>
              Sign out
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
