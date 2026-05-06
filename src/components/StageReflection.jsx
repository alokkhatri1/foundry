import { useState } from 'react';
import { REFLECTION_PROMPTS } from '../data/reflectionPrompts';

// Per-stage reflection sheet. Fires when the participant advances out of
// a primitive-teaching stage. Two fields, both optional in spirit (the
// scaled is required to "Save", but Skip closes the sheet without saving).
// Skip writes nothing — there's no penalty, and re-prompting on the same
// transition won't happen because stages only advance forward.
export default function StageReflection({ stage, onSubmit, onSkip }) {
  const prompt = REFLECTION_PROMPTS[stage];
  const [confidence, setConfidence] = useState(null);
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);

  if (!prompt) return null;

  async function handleSave() {
    if (submitting) return;
    setSubmitting(true);
    try {
      await onSubmit({ confidence, note: note.trim() || null });
    } finally {
      setSubmitting(false);
    }
  }

  const canSave = confidence !== null && !submitting;

  return (
    <div className="sr-overlay" role="dialog" aria-modal="true" aria-labelledby="sr-title">
      <div className="sr-card">
        <div className="sr-eyebrow">
          <span className="sr-eyebrow-dot" aria-hidden />
          STAGE {stage} · QUICK REFLECTION
        </div>
        <h3 id="sr-title" className="sr-title">{prompt.label}</h3>
        <p className="sr-anchor"><em>{prompt.anchor}</em></p>

        <div className="sr-question">
          <label className="sr-question-label">{prompt.scaled}</label>
          <div className="sr-scale">
            {[1, 2, 3, 4, 5].map(n => (
              <button
                key={n}
                type="button"
                className={`sr-scale-btn${confidence === n ? ' is-selected' : ''}`}
                onClick={() => setConfidence(n)}
                aria-label={`${n} of 5`}
              >
                {n}
              </button>
            ))}
          </div>
          <div className="sr-scale-legend">
            <span>Not at all</span>
            <span>Completely</span>
          </div>
        </div>

        <div className="sr-question">
          <label className="sr-question-label" htmlFor="sr-note">
            {prompt.note} <span className="sr-optional">(optional)</span>
          </label>
          <textarea
            id="sr-note"
            className="sr-note"
            value={note}
            onChange={e => setNote(e.target.value)}
            placeholder="A line or two — whatever's still on your mind."
            rows={3}
          />
        </div>

        <div className="sr-actions">
          <button type="button" className="sr-skip" onClick={onSkip} disabled={submitting}>
            Skip for now
          </button>
          <button type="button" className="sr-save" onClick={handleSave} disabled={!canSave}>
            {submitting ? 'Saving…' : 'Save reflection'}
          </button>
        </div>
      </div>
    </div>
  );
}
