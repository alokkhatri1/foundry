import { useMemo, useState } from 'react';

// Pre-graduation feedback survey. Trimmed to a five-question wrap-up —
// per-primitive learning ratings live in the per-stage reflections now,
// so this final form only captures what those can't:
//
//   1. would_recommend  — yes/no, the headline NPS-style signal
//   2. trainer          — 1-5 composite of pacing, clarity, energy
//   3. pace             — too_slow / just_right / too_fast
//   4. most_valuable    — free text, single most valuable part
//   5. improvement_notes — free text, one specific change for next time
//
// Every field is required; no optional fields. The form keeps the
// participant honest at the close — five questions, ~one minute.
//
// Payload mapping: the single trainer rating is written into all three
// existing trainer_* columns so the admin Recap card's averages keep
// working without a schema rewrite. Old columns we no longer ask
// about (satisfaction, relevance, clarity, materials_quality,
// theory_practice, improved_skills, can_apply, duration_appropriate,
// future_topics, platform_*) are simply omitted from the upsert and
// land as NULL on new rows.

const SCALE_LEGEND = [
  { v: 1, label: 'Poor' },
  { v: 2, label: 'Fair' },
  { v: 3, label: 'Good' },
  { v: 4, label: 'Great' },
  { v: 5, label: 'Excellent' },
];

const PACE_OPTIONS = [
  { v: 'too_slow',   label: 'Too slow' },
  { v: 'just_right', label: 'Just right' },
  { v: 'too_fast',   label: 'Too fast' },
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

function PaceControl({ value, onChange, name }) {
  return (
    <div className="sv-yesno sv-pace" role="radiogroup" aria-label={name}>
      {PACE_OPTIONS.map(opt => {
        const sel = value === opt.v;
        return (
          <button
            key={opt.v}
            type="button"
            role="radio"
            aria-checked={sel}
            className={`sv-yesno-btn${sel ? ' is-selected' : ''}`}
            onClick={() => onChange(opt.v)}
          >
            {opt.label}
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

const QUESTIONS = [
  {
    id: 'would_recommend',
    type: 'yesno',
    text: 'Would you recommend this workshop to a colleague?',
  },
  {
    id: 'trainer',
    type: 'scale',
    text: 'How was the trainer overall — pacing, clarity, energy?',
  },
  {
    id: 'pace',
    type: 'pace',
    text: 'How was the pace of the workshop?',
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
        {q.type === 'scale' && <ScaleControl value={value} onChange={onChange} name={q.text} />}
        {q.type === 'yesno' && <YesNoControl value={value} onChange={onChange} name={q.text} />}
        {q.type === 'pace'  && <PaceControl  value={value} onChange={onChange} name={q.text} />}
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
    // Single trainer rating fans out to all three trainer_* columns so the
    // admin Recap card's existing averages keep working without a schema
    // rewrite. Dropped fields land as NULL on new rows.
    const trainer = answers.trainer;
    const payload = {
      would_recommend:    answers.would_recommend === 'yes',
      trainer_knowledge:  trainer,
      trainer_delivery:   trainer,
      trainer_engagement: trainer,
      pace:               answers.pace,
      most_valuable:      answers.most_valuable.trim(),
      improvement_notes:  answers.improvement_notes.trim(),
    };
    onSubmit(payload);
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
            Five quick questions, about a minute. The per-stage reflections
            captured what you learned; this is the look-back on the whole.
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
                All five answered. Ready to submit.
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
