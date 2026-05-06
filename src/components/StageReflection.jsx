import { useState } from 'react';
import { REFLECTION_PROMPTS } from '../data/reflectionPrompts';

// Per-stage reflection sheet. Fires when the participant advances out of
// a primitive-teaching stage. Three required fields:
//   - 1-5 understanding rating
//   - "in your own words" reflection on the primitive
//   - a small habit for the week
//
// There is no Skip; the sheet is a hard gate designed to make the
// learning land before the next stage takes over. The accumulated
// habit answers are what the takeaway PDF surfaces back as the
// participant's personal practice plan.
export default function StageReflection({ stage, onSubmit }) {
  const prompt = REFLECTION_PROMPTS[stage];
  const [confidence, setConfidence] = useState(null);
  const [note, setNote] = useState('');
  const [habit, setHabit] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  if (!prompt) return null;

  const noteOk = note.trim().length > 0;
  const habitOk = habit.trim().length > 0;
  const canSave = confidence !== null && noteOk && habitOk && !submitting;

  async function handleSave() {
    if (!canSave) return;
    setSubmitting(true);
    setError(null);
    try {
      await onSubmit({ confidence, note: note.trim(), habit: habit.trim() });
      // Reset on success too — if the parent leaves us mounted (e.g.
      // it re-renders for the next stage), the button shouldn't stay
      // stuck on "Saving…" with stale state from the previous click.
      setSubmitting(false);
    } catch (err) {
      setError(err?.message || 'Something went wrong saving. Try again.');
      setSubmitting(false);
    }
  }

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
          <label className="sr-question-label" htmlFor="sr-note">{prompt.note}</label>
          <textarea
            id="sr-note"
            className="sr-note"
            value={note}
            onChange={e => setNote(e.target.value)}
            placeholder="A few sentences in your own words."
            rows={3}
          />
        </div>

        <div className="sr-question">
          <label className="sr-question-label" htmlFor="sr-habit">{prompt.habit}</label>
          <textarea
            id="sr-habit"
            className="sr-note"
            value={habit}
            onChange={e => setHabit(e.target.value)}
            placeholder="One small thing you'll try this week."
            rows={2}
          />
        </div>

        {error && <div className="sr-error">{error}</div>}

        <div className="sr-actions">
          <button type="button" className="sr-save" onClick={handleSave} disabled={!canSave}>
            {submitting ? 'Saving…' : 'Save and continue'}
          </button>
        </div>
      </div>
    </div>
  );
}
