import { useEffect, useMemo, useState } from 'react';
import { computeScorecard, LEVELS, LEVEL_COLORS } from '../utils/graduationScorecard';
import FeedbackForm from './FeedbackForm';

// Graduation screen — the "Own it" moment at workshop end. Computes a
// competency scorecard per participant from their actual platform activity
// and renders per-dimension levels (Awareness → Application → Mastery →
// Influence) plus an overall band. The rubric lives in
// src/utils/graduationScorecard.js; this component is display-only.
//
// Before the rubric reveals, every participant must submit the post-workshop
// feedback survey once. The gate is per (workshop_id, participant_id) and
// short-circuits if a row already exists in workshop_feedback.
export default function GraduationScreen({
  userName,
  conversations,
  coworkers,
  workflows,
  workflowRuns,
  flatFiles,
  participants,
  tools,
  fileTree,
  userPreferences,
  loadAllRoomApprovals,
  onSignOut,
  embedded = false,
  sb,
  myParticipantId,
}) {
  const [approvals, setApprovals] = useState(null);
  // Feedback gate state. 'unknown' until we've checked Supabase, then either
  // 'pending' (show form) or 'submitted' (show rubric). Without sb or a
  // participant id we can't gate, so fall through to 'submitted' silently.
  const canGate = !!(sb && myParticipantId);
  const [feedbackStatus, setFeedbackStatus] = useState(canGate ? 'unknown' : 'submitted');
  const [submitting, setSubmitting] = useState(false);
  const [feedbackError, setFeedbackError] = useState(null);

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

  // Has this participant already submitted feedback for this workshop?
  useEffect(() => {
    if (!canGate) return;
    let cancelled = false;
    sb.loadMyFeedback(myParticipantId).then(row => {
      if (cancelled) return;
      setFeedbackStatus(row ? 'submitted' : 'pending');
    }).catch(() => {
      // On error, don't strand the participant — let them through. The DB
      // unique constraint still prevents duplicate inserts on a later submit.
      if (!cancelled) setFeedbackStatus('submitted');
    });
    return () => { cancelled = true; };
  }, [canGate, sb, myParticipantId]);

  const scorecard = useMemo(() => {
    if (approvals === null) return null;
    return computeScorecard({
      userName, conversations, coworkers, workflows, workflowRuns,
      flatFiles, participants, approvals, tools, fileTree, userPreferences,
    });
  }, [userName, conversations, coworkers, workflows, workflowRuns, flatFiles, participants, approvals, tools, fileTree, userPreferences]);

  async function handleFeedbackSubmit(payload) {
    setFeedbackError(null);
    setSubmitting(true);
    const res = await sb.saveFeedback({
      ...payload,
      participant_id: myParticipantId,
      participant_name: userName,
    });
    setSubmitting(false);
    if (res.ok) {
      setFeedbackStatus('submitted');
    } else {
      setFeedbackError(res.error || 'Could not save feedback. Try again.');
    }
  }

  // Tally is user-scoped, matching the per-dimension rubric below.
  // Counting room-wide totals here was misleading: the screen reads as
  // "your" graduation but the numbers were the cohort's, so an admin
  // viewing a deprecated workshop would see "132 files" with every
  // competency below saying "no activity" — same data, two framings.
  const totalMessages = (conversations || []).reduce(
    (sum, c) => sum + (c.messages || []).filter(m => m.type === 'user').length,
    0,
  );
  const filesCount = (flatFiles || []).filter(f => f.type === 'file' && f.createdBy === userName).length;
  const coworkersCount = (coworkers || []).filter(c => c.createdBy === userName).length;
  const runsCount = (workflowRuns || []).filter(r => r.startedBy === userName).length;

  const overall = scorecard?.overallLevel ?? 0;
  const overallLabel = LEVELS[overall];

  // Feedback gate — render form before any rubric content. Tally + header
  // stay in place above the form so it doesn't feel like a different screen.
  if (feedbackStatus === 'unknown') {
    return (
      <div className={`grad-page${embedded ? ' embedded' : ''}`}>
        <div className="grad-container">
          <div className="grad-loading">Loading…</div>
        </div>
      </div>
    );
  }

  return (
    <div className={`grad-page${embedded ? ' embedded' : ''}`}>
      <div className="grad-container">
        <div className="grad-header">
          <div className="grad-eyebrow">Graduation</div>
          <h1 className="grad-title">Thanks for participating, {userName}.</h1>
          <p className="grad-subtitle">
            {feedbackStatus === 'pending'
              ? 'A few quick questions before your scorecard reveals.'
              : 'A read of your workshop activity — what you built, reviewed, and shaped. Everything is preserved in the workshop archive.'}
          </p>
        </div>

        {feedbackStatus === 'pending' ? (
          <FeedbackForm
            onSubmit={handleFeedbackSubmit}
            submitting={submitting}
            errorMessage={feedbackError}
          />
        ) : (
          <>
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
              <div className="grad-loading">Computing your scorecard&hellip;</div>
            ) : (
              <>
                <div className="grad-overall">
                  <div className="grad-overall-label">Overall level</div>
                  <div className="grad-overall-badge" style={{ background: LEVEL_COLORS[overall] }}>
                    {overallLabel}
                  </div>
                  <div className="grad-overall-hint">
                    {overall === 0 && 'No activity recorded yet.'}
                    {overall === 1 && 'You’ve seen the shape of each primitive.'}
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

            <div className="grad-attribution">
              Foundry by{' '}
              <a href="https://alokkhatri.com" target="_blank" rel="noopener noreferrer">
                Alok Khatri
              </a>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
