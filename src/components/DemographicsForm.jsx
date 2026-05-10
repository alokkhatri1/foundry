import { useMemo, useState } from 'react';

// Demographics gate — first thing after JoinScreen, before any chat or
// workshop tab is reachable. Eight required questions split across two
// sections; submit upserts a participant_demographics row and unlocks
// the rest of the workshop. Reuses the survey's editorial shell
// (`.sv-page` / `.sv-section` / `.sv-q`) and adds two control variants:
//
//   ChipSelect    — single-select pills for tenure / industry / age / use freq
//   ChipMultiSelect — multi-select pills for AI tools used
//
// Bumped whenever the on-screen wording materially changes so each
// stored row records the wording the participant actually saw.
export const DEMOGRAPHICS_TEXT_VERSION = 1;

const TENURE_OPTIONS = [
  { v: 'lt_1y',  label: 'Less than 1 year' },
  { v: '1_3y',   label: '1–3 years' },
  { v: '3_7y',   label: '3–7 years' },
  { v: '7_15y',  label: '7–15 years' },
  { v: 'gt_15y', label: '15+ years' },
];

const INDUSTRY_OPTIONS = [
  { v: 'tech',          label: 'Technology' },
  { v: 'finance',       label: 'Finance' },
  { v: 'healthcare',    label: 'Healthcare' },
  { v: 'education',     label: 'Education' },
  { v: 'consulting',    label: 'Consulting' },
  { v: 'public_sector', label: 'Public sector' },
  { v: 'marketing',     label: 'Media / Marketing' },
  { v: 'other',         label: 'Other' },
];

const AGE_OPTIONS = [
  { v: '18_24',   label: '18–24' },
  { v: '25_34',   label: '25–34' },
  { v: '35_44',   label: '35–44' },
  { v: '45_54',   label: '45–54' },
  { v: '55_plus', label: '55+' },
];

const USE_FREQ_OPTIONS = [
  { v: 'never',       label: 'Never' },
  { v: 'occasional',  label: 'Occasionally' },
  { v: 'weekly',      label: 'Weekly' },
  { v: 'daily',       label: 'Daily' },
  { v: 'multi_daily', label: 'Multiple times a day' },
];

const TOOL_OPTIONS = [
  { v: 'chatgpt',  label: 'ChatGPT' },
  { v: 'claude',   label: 'Claude' },
  { v: 'gemini',   label: 'Gemini' },
  { v: 'copilot',  label: 'Copilot (GitHub or Microsoft)' },
  { v: 'perplexity', label: 'Perplexity' },
  { v: 'midjourney', label: 'Midjourney / image tools' },
  { v: 'other',    label: 'Other' },
  { v: 'none',     label: 'None yet' },
];

// 1-5 scale for AI familiarity. Distinct legend from the post-workshop
// survey (which uses Strongly disagree → Strongly agree) — here we want
// "where you start", so it's a self-rated ladder.
const FAMILIARITY_LEGEND = [
  { v: 1, label: 'New to AI' },
  { v: 2, label: 'Curious' },
  { v: 3, label: 'Comfortable' },
  { v: 4, label: 'Practiced' },
  { v: 5, label: 'Expert' },
];

const SECTIONS = [
  {
    id: 'A',
    eyebrow: 'Section A',
    title: 'About you',
    sub: 'Helps us understand who built which reflections.',
    questions: [
      { id: 'role',         type: 'text',  text: 'What’s your role or job title?', placeholder: 'e.g. Product manager, Credit analyst, Designer…' },
      { id: 'tenure_band',  type: 'chip',  text: 'How long have you been in your current role?', options: TENURE_OPTIONS },
      { id: 'industry',     type: 'chip',  text: 'Which industry are you in?',                    options: INDUSTRY_OPTIONS },
      { id: 'age_band',     type: 'chip',  text: 'Age band',                                      options: AGE_OPTIONS },
    ],
  },
  {
    id: 'B',
    eyebrow: 'Section B',
    title: 'You and AI',
    sub: 'A quick read of where you start — not a test.',
    questions: [
      { id: 'ai_familiarity',   type: 'familiarity', text: 'How would you rate your familiarity with AI today?' },
      { id: 'ai_use_frequency', type: 'chip',        text: 'How often do you use AI tools right now?', options: USE_FREQ_OPTIONS },
      { id: 'ai_tools',         type: 'chips',       text: 'Which AI tools have you used? Pick any.',  options: TOOL_OPTIONS },
      { id: 'workshop_goal',    type: 'text',        text: 'What do you want to walk away with from this workshop?', placeholder: 'A skill, a habit, a decision you want to feel ready to make…' },
    ],
  },
];

const ALL_QUESTIONS = SECTIONS.flatMap(s => s.questions);

function pad2(n) { return String(n).padStart(2, '0'); }

function isAnswered(q, value) {
  if (value === undefined || value === null) return false;
  if (q.type === 'text')  return String(value).trim().length > 0;
  if (q.type === 'chips') return Array.isArray(value) && value.length > 0;
  return value !== '';
}

// ---------------------------------------------------------------- controls

function FamiliarityControl({ value, onChange }) {
  return (
    <div className="sv-scale" role="radiogroup" aria-label="AI familiarity">
      {FAMILIARITY_LEGEND.map(opt => {
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
        <span>{FAMILIARITY_LEGEND[0].label}</span>
        <span>{FAMILIARITY_LEGEND[FAMILIARITY_LEGEND.length - 1].label}</span>
      </div>
    </div>
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
              // 'none' is exclusive: picking it clears others; picking
              // others while 'none' is set unsets it.
              if (opt.v === 'none' && next.has('none')) {
                onChange(['none']);
                return;
              }
              if (opt.v !== 'none' && next.has('none')) next.delete('none');
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

function TextControl({ value, onChange, placeholder }) {
  return (
    <textarea
      className="sv-text"
      value={value || ''}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      rows={2}
    />
  );
}

// ---------------------------------------------------------------- rows

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
        {q.type === 'text'        && <TextControl     value={value} onChange={onChange} placeholder={q.placeholder} />}
        {q.type === 'chip'        && <ChipSelect      value={value} onChange={onChange} options={q.options} name={q.text} />}
        {q.type === 'chips'       && <ChipMultiSelect value={value} onChange={onChange} options={q.options} name={q.text} />}
        {q.type === 'familiarity' && <FamiliarityControl value={value} onChange={onChange} />}
      </div>
    </div>
  );
}

function Section({ section, startIndex, answers, setAnswer }) {
  return (
    <section className="sv-section">
      <header className="sv-section-head">
        <div className="sv-section-eyebrow">{section.eyebrow}</div>
        <h2 className="sv-section-title">{section.title}</h2>
        <p className="sv-section-sub">{section.sub}</p>
      </header>
      <div className="sv-questions">
        {section.questions.map((q, i) => (
          <Question
            key={q.id}
            q={q}
            index={startIndex + i + 1}
            value={answers[q.id]}
            onChange={v => setAnswer(q.id, v)}
          />
        ))}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------- shell

export default function DemographicsForm({ onSubmit, submitting, errorMessage, userName }) {
  const [answers, setAnswers] = useState({});
  const setAnswer = (id, v) => setAnswers(a => ({ ...a, [id]: v }));

  const answeredCount = useMemo(
    () => ALL_QUESTIONS.filter(q => isAnswered(q, answers[q.id])).length,
    [answers],
  );
  const totalCount = ALL_QUESTIONS.length;
  const ready = answeredCount === totalCount;

  let cursor = 0;
  const startIndices = SECTIONS.map(s => {
    const start = cursor;
    cursor += s.questions.length;
    return start;
  });

  function handleSubmit() {
    if (!ready || submitting) return;
    const payload = {
      role:               String(answers.role || '').trim(),
      tenure_band:        answers.tenure_band,
      industry:           answers.industry,
      age_band:           answers.age_band,
      ai_familiarity:     answers.ai_familiarity,
      ai_use_frequency:   answers.ai_use_frequency,
      ai_tools:           Array.isArray(answers.ai_tools) ? answers.ai_tools : [],
      workshop_goal:      String(answers.workshop_goal || '').trim(),
      questions_text_version: DEMOGRAPHICS_TEXT_VERSION,
    };
    onSubmit(payload);
  }

  return (
    <div className="sv-page">
      <div className="sv-progress" aria-live="polite">
        <span className="sv-progress-num">
          {pad2(answeredCount)}<span className="sv-progress-of"> / {pad2(totalCount)}</span>
        </span>
        <span className="sv-progress-label">required</span>
      </div>

      <main className="sv-container">
        <header className="sv-page-head">
          <div className="sv-eyebrow">
            <span className="sv-eyebrow-dot" aria-hidden />
            Welcome{userName ? ` · ${userName}` : ''}
          </div>
          <h1 className="sv-title">
            Before you start,&nbsp;<em>a few things about you</em>.
          </h1>
          <p className="sv-sub">
            Eight short questions — about a minute. We use these to make
            sense of how different roles and starting points experience
            the workshop.
          </p>
        </header>

        {SECTIONS.map((s, i) => (
          <Section
            key={s.id}
            section={s}
            startIndex={startIndices[i]}
            answers={answers}
            setAnswer={setAnswer}
          />
        ))}

        {errorMessage && <div className="sv-error">{errorMessage}</div>}

        <footer className="sv-footer">
          <div className="sv-footer-meta">
            {ready ? (
              <span className="sv-footer-ready">
                <span className="sv-footer-ready-dot" aria-hidden />
                All {totalCount} answered. Ready to begin.
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
            {submitting ? 'Saving…' : 'Save & open the workshop'}
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
