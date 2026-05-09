import { useEffect, useState } from 'react';

// Peer audit panel for a workflow run on Observability. Shows existing
// audits (with realtime updates) and an inline form for writing a new
// one. Three required prompts modelled on the What/So What/Now What
// Liberating Structure that Stage 7 already pairs with — what you
// noticed, why it matters, what to try next pass. The third prompt is
// the load-bearing one because it closes the loop: the run's author
// can read the suggestion and use it to revise their workflow.
//
// Public to the cohort: any participant can audit any run, including
// their own (which lands as a journal entry on their own work).

function timeAgo(ts) {
  if (!ts) return '';
  const diff = Math.floor((Date.now() - new Date(ts).getTime()) / 1000);
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

function AuditForm({ runId, auditorId, revieweeId, sb, onSubmitted }) {
  const [observation, setObservation] = useState('');
  const [meaning, setMeaning] = useState('');
  const [suggestion, setSuggestion] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const ready = observation.trim() && meaning.trim() && suggestion.trim();

  async function submit() {
    if (!ready || submitting) return;
    setSubmitting(true);
    setError(null);
    const res = await sb.saveRunAudit({
      runId, auditorId, revieweeId, observation, meaning, suggestion,
    });
    setSubmitting(false);
    if (!res.ok) {
      setError(res.error || 'Could not save the audit. Try again.');
      return;
    }
    setObservation(''); setMeaning(''); setSuggestion('');
    onSubmitted?.(res.audit);
  }

  return (
    <div className="ra-form">
      <div className="ra-form-head">Write an audit</div>
      <div className="ra-form-row">
        <label className="ra-form-label">What did you notice?</label>
        <textarea
          className="ra-form-input"
          rows={2}
          value={observation}
          onChange={e => setObservation(e.target.value)}
          placeholder="A specific thing about this run that caught your eye."
        />
      </div>
      <div className="ra-form-row">
        <label className="ra-form-label">So what?</label>
        <textarea
          className="ra-form-input"
          rows={2}
          value={meaning}
          onChange={e => setMeaning(e.target.value)}
          placeholder="Why does that matter — what does it imply?"
        />
      </div>
      <div className="ra-form-row">
        <label className="ra-form-label">Now what?</label>
        <textarea
          className="ra-form-input"
          rows={2}
          value={suggestion}
          onChange={e => setSuggestion(e.target.value)}
          placeholder="One concrete thing to try in the next run."
        />
      </div>
      {error && <div className="ra-form-error">{error}</div>}
      <div className="ra-form-actions">
        <button
          type="button"
          className="ra-form-submit"
          onClick={submit}
          disabled={!ready || submitting}
        >
          {submitting ? 'Submitting…' : 'Post audit'}
        </button>
      </div>
    </div>
  );
}

function AuditCard({ audit, participantsById }) {
  const auditorName = participantsById?.[audit.auditor_id]?.name || 'someone';
  return (
    <article className="ra-card">
      <header className="ra-card-head">
        <strong className="ra-card-name">{auditorName}</strong>
        <span className="ra-card-time">{timeAgo(audit.created_at)}</span>
      </header>
      <div className="ra-card-row">
        <span className="ra-card-label">Noticed</span>
        <div className="ra-card-body">{audit.observation}</div>
      </div>
      <div className="ra-card-row">
        <span className="ra-card-label">So what</span>
        <div className="ra-card-body">{audit.meaning}</div>
      </div>
      <div className="ra-card-row">
        <span className="ra-card-label">Now what</span>
        <div className="ra-card-body">{audit.suggestion}</div>
      </div>
    </article>
  );
}

export default function RunAuditPanel({ run, sb, myParticipantId, participants, runOwnerParticipantId }) {
  const [audits, setAudits] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [showForm, setShowForm] = useState(false);

  useEffect(() => {
    if (!run?.id || !sb) return;
    let cancelled = false;
    sb.loadRunAudits(run.id).then(rows => {
      if (cancelled) return;
      setAudits(rows);
      setLoaded(true);
    });
    return () => { cancelled = true; };
  }, [run?.id, sb]);

  // Realtime: fold any incoming audit on this run into the local list.
  useEffect(() => {
    if (!run?.id || !sb?.subscribeToRunAudits) return;
    const unsub = sb.subscribeToRunAudits(null, (payload) => {
      const row = payload.new || payload.old;
      if (!row || row.run_id !== run.id) return;
      if (payload.eventType === 'INSERT') {
        setAudits(prev => prev.some(a => a.id === row.id) ? prev : [...prev, row]);
      } else if (payload.eventType === 'DELETE') {
        setAudits(prev => prev.filter(a => a.id !== row.id));
      }
    });
    return unsub;
  }, [run?.id, sb]);

  const participantsById = participants
    ? Object.fromEntries(participants.map(p => [p.id, p]))
    : {};

  const isOwnRun = myParticipantId && runOwnerParticipantId === myParticipantId;

  return (
    <section className="ra-panel">
      <header className="ra-panel-head">
        <div>
          <h3 className="ra-panel-title">Audit</h3>
          <p className="ra-panel-sub">
            What did a peer notice about this run? {audits.length > 0 ? `${audits.length} audit${audits.length === 1 ? '' : 's'} so far.` : 'Be the first to write one.'}
          </p>
        </div>
        {!showForm && (
          <button
            type="button"
            className="ra-panel-cta"
            onClick={() => setShowForm(true)}
          >
            {isOwnRun ? 'Self-audit' : 'Write an audit'}
          </button>
        )}
      </header>

      {showForm && myParticipantId && (
        <AuditForm
          runId={run.id}
          auditorId={myParticipantId}
          revieweeId={runOwnerParticipantId || null}
          sb={sb}
          onSubmitted={(audit) => {
            setAudits(prev => prev.some(a => a.id === audit.id) ? prev : [...prev, audit]);
            setShowForm(false);
          }}
        />
      )}

      {loaded && audits.length === 0 && !showForm && (
        <div className="ra-empty">No audits yet.</div>
      )}

      {audits.length > 0 && (
        <div className="ra-list">
          {audits.map(a => (
            <AuditCard key={a.id} audit={a} participantsById={participantsById} />
          ))}
        </div>
      )}
    </section>
  );
}
