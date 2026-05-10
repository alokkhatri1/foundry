import { useEffect, useState } from 'react';

// Inline step comments — Stage 7's primary interaction.
//
// Each step in a run gets a short Google-Docs-style thread asking one
// question phrased to fit the actor:
//   - Coworker step: "Is the AI making decisions correctly?"
//   - Review step:   "Is the human making decisions correctly?"
//
// Comments are public, named, and live in realtime. Author kind is
// always 'human' here; the AI auditor at Stage 8 writes to the same
// table with author_kind='ai' and the comparison view filters by kind.

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
  return null; // trigger or unknown — no comment thread
}

export default function StepCommentThread({
  runId, stepId, stepType,
  myParticipantId, participantsById,
  sb,
}) {
  const prompt = promptForStepType(stepType);
  const [comments, setComments] = useState([]);
  const [draft, setDraft] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState(null);

  // Initial load + realtime sub. Subscription uses the run_id filter
  // (not step_id) since one run's threads are commonly viewed together;
  // we filter to the current step in memory.
  useEffect(() => {
    if (!sb || !runId) return;
    let cancelled = false;
    sb.loadStepComments(runId).then(rows => {
      if (cancelled) return;
      setComments(rows.filter(c => c.step_id === stepId));
    });
    const unsub = sb.subscribeToStepComments?.(runId, (payload) => {
      const row = payload.new || payload.old;
      if (!row || row.step_id !== stepId) return;
      setComments(prev => {
        if (payload.eventType === 'DELETE') return prev.filter(c => c.id !== row.id);
        if (prev.some(c => c.id === row.id)) return prev;
        return [...prev, row].sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
      });
    });
    return () => { cancelled = true; unsub?.(); };
  }, [sb, runId, stepId]);

  if (!prompt) return null;

  async function submit() {
    const body = draft.trim();
    if (!body || submitting) return;
    setSubmitting(true);
    setErr(null);
    const res = await sb.saveStepComment({
      runId, stepId, body,
      authorId: myParticipantId, authorKind: 'human',
    });
    setSubmitting(false);
    if (!res.ok) {
      setErr(res.error || 'Could not post comment.');
      return;
    }
    setDraft('');
    // Realtime should fold the new comment in; if not, the optimistic
    // append handles the gap.
    setComments(prev => prev.some(c => c.id === res.comment.id) ? prev : [...prev, res.comment]);
  }

  return (
    <div className="sc-thread">
      <div className="sc-thread-prompt">{prompt}</div>
      {comments.length === 0 && <div className="sc-thread-empty">No comments yet. Add the first read.</div>}
      {comments.length > 0 && (
        <div className="sc-thread-list">
          {comments.map(c => {
            const authorName = c.author_kind === 'ai'
              ? 'AI auditor'
              : (participantsById?.[c.author_id]?.name || 'someone');
            return (
              <div key={c.id} className={`sc-comment is-${c.author_kind}`}>
                <div className="sc-comment-meta">
                  <strong>{authorName}</strong>
                  <span className="sc-comment-time">{timeAgo(c.created_at)}</span>
                </div>
                <div className="sc-comment-body">{c.body}</div>
              </div>
            );
          })}
        </div>
      )}
      <div className="sc-thread-input">
        <textarea
          className="sc-thread-textarea"
          rows={2}
          value={draft}
          onChange={e => setDraft(e.target.value)}
          placeholder="Add a comment on this decision…"
          onKeyDown={e => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); submit(); }
          }}
        />
        <div className="sc-thread-actions">
          {err && <span className="sc-thread-err">{err}</span>}
          <button
            type="button"
            className="sc-thread-submit"
            onClick={submit}
            disabled={!draft.trim() || submitting}
          >
            {submitting ? 'Posting…' : 'Post comment'}
          </button>
        </div>
      </div>
    </div>
  );
}
