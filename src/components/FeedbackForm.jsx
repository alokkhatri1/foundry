import { useMemo, useState } from 'react';

// Pre-graduation feedback survey. Per-primitive learning ratings live
// in the per-stage reflections, so this final form captures only what
// those can't — separating trainer skill from workshop content quality:
//
//   1. would_recommend   — yes/no, the headline NPS-style signal
//   2. trainer_clarity   — 1-5, trainer's content clarity
//   3. trainer_pacing    — 1-5, trainer's pacing
//   4. workshop_content  — 1-5, the workshop's content quality itself
//   5. most_valuable     — free text, single most valuable part
//   6. improvement_notes — free text, one specific change for next time
//   7. research_consent  — yes/no, opt-in to research use
//
// Every field is required; no optional fields. ~one minute end-to-end.
//
// Payload mapping (kept on existing trainer_* columns to avoid a schema
// rewrite — admin Recap averages keep working):
//   trainer_clarity  → trainer_knowledge
//   trainer_pacing   → trainer_delivery
//   workshop_content → trainer_engagement
// Admin labels were updated to match the new meaning. Columns we no
// longer ask about (pace, satisfaction, relevance, clarity,
// materials_quality, theory_practice, improved_skills, can_apply,
// duration_appropriate, future_topics, platform_*) are omitted from
// the upsert and land as NULL on new rows.

const SCALE_LEGEND = [
  { v: 1, label: 'Poor' },
  { v: 2, label: 'Fair' },
  { v: 3, label: 'Good' },
  { v: 4, label: 'Great' },
  { v: 5, label: 'Excellent' },
];

function pad2(n) { return String(n).padStart(2, '0'); }

function ScaleControl({ value, onChange, name }) {
  return (
    <div className="sv-scale" role="radiogroup" aria-label={name}>
      {SCALE_LEGEND.map(opt => {
        const sel = value === opt.v;
        return (
          <button
            key={opt.v}
            type="button"
            role="radio"
            aria-checked={sel}
            className={`sv-scale-btn${sel ? ' is-selected' : ''}`}
            onClick={() => onChange(opt.v)}
            title={opt.label}
          >
            {opt.v}
          </button>
        );
      })}
      <div className="sv-scale-legend" aria-hidden>
        <span>{SCALE_LEGEND[0].label}</span>
        <span>{SCALE_LEGEND[SCALE_LEGEND.length - 1].label}</span>
      </div>
    </div>
  );
}

function YesNoControl({ value, onChange, name }) {
  return (
    <div className="sv-yesno" role="radiogroup" aria-label={name}>
      {['yes', 'no'].map(v => {
        const sel = value === v;
        return (
          <button
            key={v}
            type="button"
            role="radio"
            aria-checked={sel}
            className={`sv-yesno-btn${sel ? ' is-selected' : ''} is-${v}`}
            onClick={() => onChange(v)}
          >
            {v.charAt(0).toUpperCase() + v.slice(1)}
          </button>
        );
      })}
    </div>
  );
}

function TextControl({ value, onChange, placeholder }) {
  return (
    <textarea
      className="sv-text"
      value={value || ''}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      rows={4}
    />
  );
}

// Bumped whenever the on-screen consent copy materially changes, so each
// research_consent row records the wording the participant actually saw.
export const CONSENT_TEXT_VERSION = 1;

const QUESTIONS = [
  {
    id: 'would_recommend',
    type: 'yesno',
    text: 'Would you recommend this workshop to a colleague?',
  },
  {
    id: 'trainer_clarity',
    type: 'scale',
    text: 'How was the trainer in terms of content clarity?',
  },
  {
    id: 'trainer_pacing',
    type: 'scale',
    text: 'How was the trainer in terms of pacing?',
  },
  {
    id: 'workshop_content',
    type: 'scale',
    text: 'How would you rate the content of the workshop?',
  },
  {
    id: 'most_valuable',
    type: 'text',
    text: 'Looking across everything you built and learned, what was the single most valuable part for you?',
    placeholder: 'A method, a moment, a mental model that clicked…',
  },
  {
    id: 'improvement_notes',
    type: 'text',
    text: 'One specific thing we should change for the next group?',
    placeholder: 'Anything you would change, drop, or add.',
  },
  {
    id: 'research_consent',
    type: 'yesno',
    text: 'May we learn from your journey to improve future workshops?',
    description: 'If yes, the chats, files, coworkers, workflows, and reflections you produced during this workshop will be used as research data to make Foundry better. Your name and email will be replaced with an anonymous participant ID before any analysis. You can withdraw consent any time by emailing alok@tangible.careers.',
  },
];

function isAnswered(q, value) {
  if (value === undefined || value === null) return false;
  if (q.type === 'text') return String(value).trim().length > 0;
  return value !== '';
}

function Question({ q, index, value, onChange }) {
  const answered = isAnswered(q, value);
  return (
    <div className={`sv-q${answered ? ' is-answered' : ''}`}>
      <div className="sv-q-meta">
        <span className="sv-q-num">{pad2(index)}</span>
        <span className="sv-q-req">required</span>
      </div>
      <div className="sv-q-body">
        <p className="sv-q-text">{q.text}</p>
        {q.description && <p className="sv-q-desc">{q.description}</p>}
        {q.type === 'scale' && <ScaleControl value={value} onChange={onChange} name={q.text} />}
        {q.type === 'yesno' && <YesNoControl value={value} onChange={onChange} name={q.text} />}
        {q.type === 'text'  && <TextControl  value={value} onChange={onChange} placeholder={q.placeholder} />}
      </div>
    </div>
  );
}

export default function FeedbackForm({ onSubmit, submitting, errorMessage, userName }) {
  const [answers, setAnswers] = useState({});
  const setAnswer = (id, v) => setAnswers(a => ({ ...a, [id]: v }));

  const answeredCount = useMemo(
    () => QUESTIONS.filter(q => isAnswered(q, answers[q.id])).length,
    [answers],
  );
  const totalCount = QUESTIONS.length;
  const ready = answeredCount === totalCount;

  function handleSubmit() {
    if (!ready || submitting) return;
    // Three specific 1-5 ratings ride on the existing trainer_* columns
    // so the admin Recap averages keep working without a schema rewrite:
    //   trainer_clarity  → trainer_knowledge
    //   trainer_pacing   → trainer_delivery
    //   workshop_content → trainer_engagement
    // Admin labels were updated to match the new meaning. Dropped fields
    // (pace, etc.) land as NULL on new rows.
    const feedback = {
      would_recommend:    answers.would_recommend === 'yes',
      trainer_knowledge:  answers.trainer_clarity,
      trainer_delivery:   answers.trainer_pacing,
      trainer_engagement: answers.workshop_content,
      most_valuable:      answers.most_valuable.trim(),
      improvement_notes:  answers.improvement_notes.trim(),
    };
    // Consent rides alongside feedback but is a separate write to its own
    // table — the parent splits and saves both. Versioned against the on-
    // screen text the participant actually saw at submit time.
    const consent = {
      granted: answers.research_consent === 'yes',
      consentTextVersion: CONSENT_TEXT_VERSION,
    };
    onSubmit({ feedback, consent });
  }

  return (
    <div className="sv-page">
      <main className="sv-container">
        <header className="sv-page-head">
          <div className="sv-eyebrow">
            <span className="sv-eyebrow-dot" aria-hidden />
            Workshop close{userName ? ` · ${userName}` : ''}
          </div>
          <h1 className="sv-title">
            Before your scorecard,&nbsp;<em>a few words from you</em>.
          </h1>
          <p className="sv-sub">
            A handful of questions, about a minute. The per-stage reflections
            captured what you learned; this is the look-back on the whole —
            plus a final ask about using your work for research.
          </p>
        </header>

        <section className="sv-section">
          <div className="sv-questions">
            {QUESTIONS.map((q, i) => (
              <Question
                key={q.id}
                q={q}
                index={i + 1}
                value={answers[q.id]}
                onChange={v => setAnswer(q.id, v)}
              />
            ))}
          </div>
        </section>

        {errorMessage && <div className="sv-error">{errorMessage}</div>}

        <footer className="sv-footer">
          <div className="sv-footer-meta">
            {ready ? (
              <span className="sv-footer-ready">
                <span className="sv-footer-ready-dot" aria-hidden />
                All {totalCount} answered. Ready to submit.
              </span>
            ) : (
              <span className="sv-footer-pending">
                <em>{totalCount - answeredCount}</em> {totalCount - answeredCount === 1 ? 'question' : 'questions'} left.
              </span>
            )}
          </div>
          <button
            type="button"
            className={`sv-submit${ready ? ' is-ready' : ''}`}
            disabled={!ready || submitting}
            onClick={handleSubmit}
          >
            {submitting ? 'Submitting…' : 'Submit & reveal scorecard'}
            <span aria-hidden>→</span>
          </button>
        </footer>
      </main>

      <div className="sv-stickybar" aria-hidden>
        <div className="sv-stickybar-track">
          <div
            className="sv-stickybar-fill"
            style={{ width: `${(answeredCount / totalCount) * 100}%` }}
          />
        </div>
      </div>
    </div>
  );
}
