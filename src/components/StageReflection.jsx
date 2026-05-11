import { useState, useMemo } from 'react';
import { REFLECTION_PROMPTS, REFLECTION_TEXT_VERSION } from '../data/reflectionPrompts';

// Per-stage reflection sheet — research+industry required instrument.
// Source: research-questions.md, Section 3 (Q15-Q38).
//
// Fires when the participant advances out of a primitive-teaching stage
// (3-8). Four required questions per stage in a fixed shape:
//   1. clarity 1-5     — concept clarity (1 Not clear at all → 5 Extremely clear)
//   2. agreement 1-5   — usefulness / trust / confidence (Strongly disagree → Strongly agree)
//   3+4. text / chip / chips — varies by stage (see reflectionPrompts.js)
//
// No Skip. The sheet is a hard gate so the learning lands before the
// next stage takes over.
//
// Payload mapped to the DB row:
//   confidence    smallint  ← clarity answer (kept on the old column for
//                              back-compat with HandoutPage rendering)
//   agreement     smallint  ← agreement answer
//   transfer_text text      ← the text-type question's value (null if
//                              the stage has no text question, e.g. Stage 7)
//   structured    jsonb     ← every chip / chips answer keyed by qid
//                              (e.g. { barriers: [...] } or
//                              { confidence_shift: '...', check_first: '...' })

const CLARITY_LEGEND = [
  { v: 1, label: 'Not clear at all' },
  { v: 2, label: 'Slightly clear' },
  { v: 3, label: 'Moderately clear' },
  { v: 4, label: 'Very clear' },
  { v: 5, label: 'Extremely clear' },
];

const AGREEMENT_LEGEND = [
  { v: 1, label: 'Strongly disagree' },
  { v: 2, label: 'Disagree' },
  { v: 3, label: 'Neutral' },
  { v: 4, label: 'Agree' },
  { v: 5, label: 'Strongly agree' },
];

function ScaleControl({ value, onChange, legend, ariaLabel }) {
  return (
    <>
      <div className="sr-scale" role="radiogroup" aria-label={ariaLabel}>
        {legend.map(opt => (
          <button
            key={opt.v}
            type="button"
            role="radio"
            aria-checked={value === opt.v}
            className={`sr-scale-btn${value === opt.v ? ' is-selected' : ''}`}
            onClick={() => onChange(opt.v)}
            title={opt.label}
          >
            {opt.v}
          </button>
        ))}
      </div>
      <div className="sr-scale-legend">
        <span>{legend[0].label}</span>
        <span>{legend[legend.length - 1].label}</span>
      </div>
    </>
  );
}

function ChipSelect({ value, onChange, options, name }) {
  return (
    <div className="dm-chips" role="radiogroup" aria-label={name}>
      {options.map(opt => {
        const sel = value === opt.v;
        return (
          <button
            key={opt.v}
            type="button"
            role="radio"
            aria-checked={sel}
            className={`dm-chip${sel ? ' is-selected' : ''}`}
            onClick={() => onChange(opt.v)}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

function ChipMultiSelect({ value, onChange, options, name }) {
  const set = new Set(Array.isArray(value) ? value : []);
  return (
    <div className="dm-chips" role="group" aria-label={name}>
      {options.map(opt => {
        const sel = set.has(opt.v);
        return (
          <button
            key={opt.v}
            type="button"
            aria-pressed={sel}
            className={`dm-chip${sel ? ' is-selected' : ''}`}
            onClick={() => {
              const next = new Set(set);
              if (next.has(opt.v)) next.delete(opt.v);
              else next.add(opt.v);
              onChange([...next]);
            }}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

function isAnswered(q, value) {
  if (value === undefined || value === null) return false;
  if (q.type === 'text')  return String(value).trim().length > 0;
  if (q.type === 'chips') return Array.isArray(value) && value.length > 0;
  return value !== '';
}

export default function StageReflection({ stage, onSubmit }) {
  const prompt = REFLECTION_PROMPTS[stage];
  const [answers, setAnswers] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  const setAnswer = (id, v) => setAnswers(a => ({ ...a, [id]: v }));

  const canSave = useMemo(() => {
    if (!prompt) return false;
    return prompt.questions.every(q => isAnswered(q, answers[q.id])) && !submitting;
  }, [prompt, answers, submitting]);

  if (!prompt) return null;

  async function handleSave() {
    if (!canSave) return;
    setSubmitting(true);
    setError(null);
    try {
      // Map each question's id to the DB column it belongs in. clarity
      // and agreement go on their own columns; the lone text answer goes
      // on transfer_text (null when the stage has no text question);
      // every chip/chips answer is folded into the structured jsonb
      // keyed by the question's id.
      const payload = {
        confidence: null,        // clarity → confidence (kept for back-compat)
        agreement:  null,
        transfer_text: null,
        structured: {},
        questions_text_version: REFLECTION_TEXT_VERSION,
      };
      for (const q of prompt.questions) {
        const v = answers[q.id];
        if (q.type === 'clarity')   payload.confidence = v;
        else if (q.type === 'agreement') payload.agreement = v;
        else if (q.type === 'text')      payload.transfer_text = String(v || '').trim();
        else if (q.type === 'chip' || q.type === 'chips') payload.structured[q.id] = v;
      }
      await onSubmit(payload);
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

        {prompt.questions.map((q) => (
          <div key={q.id} className="sr-question">
            <label className="sr-question-label">{q.text}</label>
            {q.type === 'clarity' && (
              <ScaleControl
                value={answers[q.id] ?? null}
                onChange={(v) => setAnswer(q.id, v)}
                legend={CLARITY_LEGEND}
                ariaLabel={q.text}
              />
            )}
            {q.type === 'agreement' && (
              <ScaleControl
                value={answers[q.id] ?? null}
                onChange={(v) => setAnswer(q.id, v)}
                legend={AGREEMENT_LEGEND}
                ariaLabel={q.text}
              />
            )}
            {q.type === 'text' && (
              <textarea
                className="sr-note"
                value={answers[q.id] || ''}
                onChange={e => setAnswer(q.id, e.target.value)}
                placeholder={q.placeholder || 'A few sentences in your own words.'}
                rows={3}
              />
            )}
            {q.type === 'chip' && (
              <ChipSelect
                value={answers[q.id] ?? ''}
                onChange={(v) => setAnswer(q.id, v)}
                options={q.options}
                name={q.text}
              />
            )}
            {q.type === 'chips' && (
              <ChipMultiSelect
                value={answers[q.id] ?? []}
                onChange={(v) => setAnswer(q.id, v)}
                options={q.options}
                name={q.text}
              />
            )}
          </div>
        ))}

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
