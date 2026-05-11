import { useMemo, useState } from 'react';

// Pre-chat questionnaire — research+industry required instrument,
// baseline only. Source: research-questions.md, Section 1 (Q1-Q13).
// 13 baseline questions, all required. Submit unlocks Chat.
//
// Research consent (Section 2 / Q14) is deliberately NOT collected here.
// We ask consent at workshop close instead, when participants have seen
// what their workshop activity actually contains and can make an
// informed decision. The FeedbackForm carries that ask.
//
// Persistence: all 13 fields land on participant_demographics.

export const DEMOGRAPHICS_TEXT_VERSION = 2;

// ---------- option sets (codes persisted; labels here are the on-screen text)

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

const WORK_TYPE_OPTIONS = [
  { v: 'strategy',    label: 'Strategy / planning' },
  { v: 'operations',  label: 'Operations' },
  { v: 'analysis',    label: 'Analysis / reporting' },
  { v: 'research',    label: 'Research' },
  { v: 'writing',     label: 'Writing / communication' },
  { v: 'customer',    label: 'Customer or client work' },
  { v: 'product_eng', label: 'Product / engineering' },
  { v: 'management',  label: 'Management' },
  { v: 'other',       label: 'Other' },
];

const USE_FREQ_OPTIONS = [
  { v: 'never',       label: 'Never' },
  { v: 'occasional',  label: 'Occasionally' },
  { v: 'weekly',      label: 'Weekly' },
  { v: 'daily',       label: 'Daily' },
  { v: 'multi_daily', label: 'Multiple times a day' },
];

const TOOL_OPTIONS = [
  { v: 'chatgpt',     label: 'ChatGPT' },
  { v: 'claude',      label: 'Claude' },
  { v: 'gemini',      label: 'Gemini' },
  { v: 'copilot',     label: 'Copilot' },
  { v: 'perplexity',  label: 'Perplexity' },
  { v: 'image_gen',   label: 'Image-generation tools' },
  { v: 'internal',    label: 'Internal company AI tool' },
  { v: 'other',       label: 'Other' },
  { v: 'none',        label: 'None yet' },
];

const USE_CASES_OPTIONS = [
  { v: 'drafting',     label: 'Drafting text' },
  { v: 'summarizing',  label: 'Summarizing documents' },
  { v: 'brainstorm',   label: 'Brainstorming' },
  { v: 'research',     label: 'Research' },
  { v: 'data',         label: 'Data analysis' },
  { v: 'coding',       label: 'Coding' },
  { v: 'decision',     label: 'Decision support' },
  { v: 'automation',   label: 'Automating repeated work' },
  { v: 'not_yet',      label: 'I do not use AI yet' },
  { v: 'other',        label: 'Other' },
];

const MENTAL_MODEL_OPTIONS = [
  { v: 'search',         label: 'A search engine' },
  { v: 'writing',        label: 'A writing assistant' },
  { v: 'productivity',   label: 'A productivity tool' },
  { v: 'coworker',       label: 'A coworker' },
  { v: 'expert',         label: 'An expert advisor' },
  { v: 'automation',     label: 'An automation system' },
  { v: 'risky',          label: 'A risky tool that needs close supervision' },
  { v: 'unsure',         label: 'I am not sure yet' },
];

const ADOPTION_CRITERIA_OPTIONS = [
  { v: 'accuracy',       label: 'Accuracy' },
  { v: 'speed',          label: 'Speed' },
  { v: 'privacy',        label: 'Privacy' },
  { v: 'ease',           label: 'Ease of use' },
  { v: 'control',        label: 'Control' },
  { v: 'explainability', label: 'Explainability' },
  { v: 'cost',           label: 'Cost' },
  { v: 'quality',        label: 'Quality of final output' },
  { v: 'reviewability',  label: 'Ability to review or edit before use' },
];

// 1-5 self-rated AI familiarity ladder. Distinct from the workshop
// survey's Strongly disagree → Strongly agree scale.
const FAMILIARITY_LEGEND = [
  { v: 1, label: 'New to AI' },
  { v: 2, label: 'Curious' },
  { v: 3, label: 'Comfortable' },
  { v: 4, label: 'Practiced' },
  { v: 5, label: 'Expert' },
];

// 1-5 agreement scale used for Q10 and Q11.
const AGREEMENT_LEGEND = [
  { v: 1, label: 'Strongly disagree' },
  { v: 2, label: 'Disagree' },
  { v: 3, label: 'Neutral' },
  { v: 4, label: 'Agree' },
  { v: 5, label: 'Strongly agree' },
];

// ---------- question schema (numbering matches research-questions.md)

const SECTIONS = [
  {
    id: 'A',
    eyebrow: 'Section A',
    title: 'About you',
    sub: 'A read of your role and the kind of work you do.',
    questions: [
      { id: 'role',       type: 'text',  text: 'What is your role or job title?', placeholder: 'e.g. Product manager, Credit analyst, Designer…' },
      { id: 'tenure_band', type: 'chip',  text: 'How long have you been in your current role?', options: TENURE_OPTIONS },
      { id: 'industry',   type: 'chip',  text: 'Which industry are you in?',                    options: INDUSTRY_OPTIONS },
      { id: 'work_type',  type: 'chips', text: 'Which best describes the type of work you do?',  options: WORK_TYPE_OPTIONS },
    ],
  },
  {
    id: 'B',
    eyebrow: 'Section B',
    title: 'Current AI use',
    sub: 'Where you start with AI tools today — not a test.',
    questions: [
      { id: 'ai_familiarity',   type: 'familiarity', text: 'How familiar are you with AI tools today?' },
      { id: 'ai_use_frequency', type: 'chip',        text: 'How often do you use AI tools right now?',                       options: USE_FREQ_OPTIONS },
      { id: 'ai_tools',         type: 'chips',       text: 'Which AI tools have you used? Pick any.',                         options: TOOL_OPTIONS },
      { id: 'ai_use_cases',     type: 'chips',       text: 'What do you usually use AI for?',                                 options: USE_CASES_OPTIONS },
      { id: 'ai_mental_model',  type: 'chip',        text: 'Which statement best describes how you currently think about AI?', options: MENTAL_MODEL_OPTIONS },
    ],
  },
  {
    id: 'C',
    eyebrow: 'Section C',
    title: 'Trust, delegation, and control',
    sub: 'How you decide whether AI gets to do the work.',
    questions: [
      { id: 'evaluation_confidence', type: 'agreement', text: 'I can usually tell when an AI answer is good enough to use.' },
      { id: 'delegation_comfort',    type: 'agreement', text: 'I feel comfortable delegating a work task to AI if I can review the output before using it.' },
      { id: 'adoption_criteria_top3', type: 'rank',    text: 'When deciding whether to use AI, what matters most to you? Rank your top three.', options: ADOPTION_CRITERIA_OPTIONS, pickCount: 3 },
      { id: 'delegation_boundary',   type: 'text',     text: 'What kind of work would you not want AI to do for you? Why?', placeholder: 'A type of decision, a kind of judgment, a domain you would keep human…' },
    ],
  },
];

const ALL_QUESTIONS = SECTIONS.flatMap(s => s.questions);

function pad2(n) { return String(n).padStart(2, '0'); }

function isAnswered(q, value) {
  if (value === undefined || value === null) return false;
  if (q.type === 'text')  return String(value).trim().length > 0;
  if (q.type === 'chips') return Array.isArray(value) && value.length > 0;
  if (q.type === 'rank')  return Array.isArray(value) && value.length === (q.pickCount || 3);
  return value !== '';
}

// ---------- controls

function FamiliarityControl({ value, onChange }) {
  return (
    <div className="sv-scale" role="radiogroup" aria-label="AI familiarity">
      {FAMILIARITY_LEGEND.map(opt => {
        const sel = value === opt.v;
        return (
          <button key={opt.v} type="button" role="radio" aria-checked={sel}
            className={`sv-scale-btn${sel ? ' is-selected' : ''}`}
            onClick={() => onChange(opt.v)} title={opt.label}
          >{opt.v}</button>
        );
      })}
      <div className="sv-scale-legend" aria-hidden>
        <span>{FAMILIARITY_LEGEND[0].label}</span>
        <span>{FAMILIARITY_LEGEND[FAMILIARITY_LEGEND.length - 1].label}</span>
      </div>
    </div>
  );
}

function AgreementControl({ value, onChange, name }) {
  return (
    <div className="sv-scale" role="radiogroup" aria-label={name}>
      {AGREEMENT_LEGEND.map(opt => {
        const sel = value === opt.v;
        return (
          <button key={opt.v} type="button" role="radio" aria-checked={sel}
            className={`sv-scale-btn${sel ? ' is-selected' : ''}`}
            onClick={() => onChange(opt.v)} title={opt.label}
          >{opt.v}</button>
        );
      })}
      <div className="sv-scale-legend" aria-hidden>
        <span>{AGREEMENT_LEGEND[0].label}</span>
        <span>{AGREEMENT_LEGEND[AGREEMENT_LEGEND.length - 1].label}</span>
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
          <button key={v} type="button" role="radio" aria-checked={sel}
            className={`sv-yesno-btn${sel ? ' is-selected' : ''} is-${v}`}
            onClick={() => onChange(v)}
          >{v.charAt(0).toUpperCase() + v.slice(1)}</button>
        );
      })}
    </div>
  );
}

function ChipSelect({ value, onChange, options, name }) {
  return (
    <div className="dm-chips" role="radiogroup" aria-label={name}>
      {options.map(opt => {
        const sel = value === opt.v;
        return (
          <button key={opt.v} type="button" role="radio" aria-checked={sel}
            className={`dm-chip${sel ? ' is-selected' : ''}`}
            onClick={() => onChange(opt.v)}
          >{opt.label}</button>
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
          <button key={opt.v} type="button" aria-pressed={sel}
            className={`dm-chip${sel ? ' is-selected' : ''}`}
            onClick={() => {
              const next = new Set(set);
              if (next.has(opt.v)) next.delete(opt.v);
              else next.add(opt.v);
              // Codes that mean "none of the above" are exclusive with
              // other selections — picking them clears the rest, picking
              // anything else clears them. Q7 ('none') and Q8 ('not_yet')
              // both have this semantics.
              const exclusives = new Set(['none', 'not_yet']);
              if (exclusives.has(opt.v) && next.has(opt.v)) {
                onChange([opt.v]);
                return;
              }
              if (!exclusives.has(opt.v)) {
                for (const ex of exclusives) next.delete(ex);
              }
              onChange([...next]);
            }}
          >{opt.label}</button>
        );
      })}
    </div>
  );
}

// Top-N ranking pills. Click to add (gets next rank); click again to
// remove (subsequent ranks slide down). Once `pickCount` are picked,
// further clicks are no-ops until the user removes one.
function RankControl({ value, onChange, options, pickCount = 3, name }) {
  const order = Array.isArray(value) ? value : [];
  const rankOf = (v) => {
    const idx = order.indexOf(v);
    return idx === -1 ? null : idx + 1;
  };
  return (
    <div className="dm-rank" role="group" aria-label={name}>
      <div className="dm-rank-help">
        {order.length < pickCount
          ? `Pick ${pickCount - order.length} more — your top three in order.`
          : `Top three picked. Click a chip again to remove.`}
      </div>
      <div className="dm-chips">
        {options.map(opt => {
          const r = rankOf(opt.v);
          const sel = r !== null;
          const atLimit = order.length >= pickCount && !sel;
          return (
            <button key={opt.v} type="button" aria-pressed={sel}
              disabled={atLimit}
              className={`dm-chip dm-rank-chip${sel ? ' is-selected' : ''}${atLimit ? ' is-disabled' : ''}`}
              onClick={() => {
                if (sel) onChange(order.filter(x => x !== opt.v));
                else if (order.length < pickCount) onChange([...order, opt.v]);
              }}
            >
              {sel && <span className="dm-rank-badge">{r}</span>}
              {opt.label}
            </button>
          );
        })}
      </div>
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

// ---------- rows

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
        {q.type === 'text'        && <TextControl       value={value} onChange={onChange} placeholder={q.placeholder} />}
        {q.type === 'chip'        && <ChipSelect        value={value} onChange={onChange} options={q.options} name={q.text} />}
        {q.type === 'chips'       && <ChipMultiSelect   value={value} onChange={onChange} options={q.options} name={q.text} />}
        {q.type === 'rank'        && <RankControl       value={value} onChange={onChange} options={q.options} pickCount={q.pickCount} name={q.text} />}
        {q.type === 'familiarity' && <FamiliarityControl value={value} onChange={onChange} />}
        {q.type === 'agreement'   && <AgreementControl   value={value} onChange={onChange} name={q.text} />}
        {q.type === 'yesno'       && <YesNoControl      value={value} onChange={onChange} name={q.text} />}
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

// ---------- shell

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
      role:                    String(answers.role || '').trim(),
      tenure_band:             answers.tenure_band,
      industry:                answers.industry,
      work_type:               Array.isArray(answers.work_type) ? answers.work_type : [],
      ai_familiarity:          answers.ai_familiarity,
      ai_use_frequency:        answers.ai_use_frequency,
      ai_tools:                Array.isArray(answers.ai_tools) ? answers.ai_tools : [],
      ai_use_cases:            Array.isArray(answers.ai_use_cases) ? answers.ai_use_cases : [],
      ai_mental_model:         answers.ai_mental_model,
      evaluation_confidence:   answers.evaluation_confidence,
      delegation_comfort:      answers.delegation_comfort,
      adoption_criteria_top3:  Array.isArray(answers.adoption_criteria_top3) ? answers.adoption_criteria_top3 : [],
      delegation_boundary:     String(answers.delegation_boundary || '').trim(),
      questions_text_version:  DEMOGRAPHICS_TEXT_VERSION,
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
            A short questionnaire about your role, how you work with AI today, and how you weigh trust against delegation. About a minute.
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
