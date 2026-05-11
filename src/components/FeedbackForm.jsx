import { useMemo, useState } from 'react';

// End-of-workshop survey — research+industry required instrument.
// Source: research-questions.md, Sections 2 (Q14 research consent) and
// 4 (Q39-Q58, training/platform/learning/perception).
// 21 required questions: 20 evaluation Q's across four sections plus
// a final research consent at the very end. Consent is asked *after*
// the workshop so participants give informed consent having seen
// what their activity actually contains.

const SCALE_LEGEND = [
  { v: 1, label: 'Strongly disagree' },
  { v: 2, label: 'Disagree' },
  { v: 3, label: 'Neutral' },
  { v: 4, label: 'Agree' },
  { v: 5, label: 'Strongly agree' },
];

// Concept-first single-select (Q51)
const CONCEPT_OPTIONS = [
  { v: 'skill',      label: 'Skill file' },
  { v: 'knowledge',  label: 'Knowledge file' },
  { v: 'coworker',   label: 'AI coworker' },
  { v: 'workflow',   label: 'Workflow' },
  { v: 'audit',      label: 'Audit log' },
  { v: 'cost',       label: 'Cost view' },
  { v: 'none_yet',   label: 'None yet' },
  { v: 'other',      label: 'Other' },
];

// Stamped onto every research_consent row so analysis can interpret
// the answer against the exact wording shown at submit time. Bump
// when the consent text materially changes.
export const CONSENT_TEXT_VERSION = 1;

const SECTIONS = [
  {
    id: 'A',
    eyebrow: 'Section A',
    title: 'Training and facilitation',
    sub: 'A read of the session itself.',
    questions: [
      { id: 'satisfaction',    type: 'scale', text: 'Overall, I was satisfied with the workshop.' },
      { id: 'relevance',       type: 'scale', text: 'The workshop content was relevant to my role or work.' },
      { id: 'clarity',         type: 'scale', text: 'The workshop was clearly organized.' },
      { id: 'theory_practice', type: 'scale', text: 'The balance between explanation and hands-on practice was appropriate.' },
    ],
  },
  {
    id: 'B',
    eyebrow: 'Section B',
    title: 'Platform experience',
    sub: 'How Foundry held up while you were learning.',
    questions: [
      { id: 'platform_rating',           type: 'scale', text: 'The Foundry platform was easy to navigate.' },
      { id: 'platform_reliability',      type: 'scale', text: 'The platform was reliable during the workshop.' },
      { id: 'platform_support',          type: 'scale', text: 'The platform helped me understand AI workflows better than a lecture alone would have.' },
      { id: 'foundry_improvement_text',  type: 'text',  text: 'What is one thing that would make Foundry easier to use?', placeholder: 'A friction, a confusing moment, a thing you wished worked differently…' },
    ],
  },
  {
    id: 'C',
    eyebrow: 'Section C',
    title: 'Learning and adoption',
    sub: 'What you take with you, and what you would use it for.',
    questions: [
      { id: 'improved_skills',       type: 'scale', text: 'The workshop improved my ability to use AI at work.' },
      { id: 'identify_ai_tasks',     type: 'scale', text: 'I can identify tasks in my work that are suitable for AI.' },
      { id: 'identify_human_review', type: 'scale', text: 'I can identify tasks in my work that should still require human review.' },
      { id: 'likely_to_use',         type: 'scale', text: 'I am likely to use at least one Foundry concept in my real work.' },
      { id: 'concept_used_first',    type: 'chip',  text: 'Which Foundry concept are you most likely to use first?', options: CONCEPT_OPTIONS },
      { id: 'real_task_text',        type: 'text',  text: 'What is one real task where you could imagine using Foundry?', placeholder: 'A task at work, a recurring decision, a piece of someone’s job…' },
    ],
  },
  {
    id: 'D',
    eyebrow: 'Section D',
    title: 'Perception, trust, and recommendation',
    sub: 'How your view of AI shifted — and whether you would send a colleague.',
    questions: [
      { id: 'ai_was_chat_tool',       type: 'scale', text: 'Before this workshop, I mostly thought of AI as a chat tool.' },
      { id: 'ai_repeatable_systems',  type: 'scale', text: 'After this workshop, I see AI as something that can be organized into repeatable work systems.' },
      { id: 'aware_human_oversight',  type: 'scale', text: 'After this workshop, I feel more aware of where AI needs human oversight.' },
      { id: 'aware_cost_tradeoffs',   type: 'scale', text: 'After this workshop, I feel more aware that AI use involves cost and resource tradeoffs.' },
      { id: 'trust_when_inspectable', type: 'scale', text: 'I would trust AI more when I can inspect its instructions, knowledge, and workflow steps.' },
      { id: 'would_recommend',        type: 'yesno', text: 'Would you recommend this workshop to a colleague?' },
    ],
  },
  // Final ask. Research consent is intentionally last so participants
  // see the full workshop before agreeing to share it. Yes / no with a
  // description; the parent (GraduationScreen) writes it to the
  // separate research_consent table on submit.
  {
    id: 'E',
    eyebrow: 'Section E',
    title: 'Research consent',
    sub: 'Now that you have seen the workshop, may we learn from it?',
    questions: [
      {
        id: 'research_consent',
        type: 'yesno',
        text: 'May we use your workshop activity to improve Foundry and study how professionals learn to work with AI?',
        description: 'If you choose yes, the chats, files, coworkers, workflows, reflections, and feedback you created during this workshop may be used as research data. Your name and email will be replaced with an anonymous participant ID before analysis. Participation is voluntary. Saying no does not affect anything about your workshop. You may withdraw consent later by contacting the research team.',
      },
    ],
  },
];

const ALL_QUESTIONS = SECTIONS.flatMap(s => s.questions);

function pad2(n) { return String(n).padStart(2, '0'); }

function isAnswered(q, value) {
  if (value === undefined || value === null) return false;
  if (q.type === 'text') return String(value).trim().length > 0;
  return value !== '';
}

// ---------- controls

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

function TextControl({ value, onChange, placeholder }) {
  return (
    <textarea
      className="sv-text"
      value={value || ''}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      rows={3}
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
        {q.type === 'scale' && <ScaleControl value={value} onChange={onChange} name={q.text} />}
        {q.type === 'yesno' && <YesNoControl value={value} onChange={onChange} name={q.text} />}
        {q.type === 'chip'  && <ChipSelect   value={value} onChange={onChange} options={q.options} name={q.text} />}
        {q.type === 'text'  && <TextControl  value={value} onChange={onChange} placeholder={q.placeholder} />}
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

export default function FeedbackForm({ onSubmit, submitting, errorMessage, userName }) {
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
    const trim = (v) => (typeof v === 'string' ? v.trim() : '');
    const feedback = {
      // Section A — Training and facilitation
      satisfaction:             answers.satisfaction,
      relevance:                answers.relevance,
      clarity:                  answers.clarity,
      theory_practice:          answers.theory_practice,
      // Section B — Platform
      platform_rating:          answers.platform_rating,
      platform_reliability:     answers.platform_reliability,
      platform_support:         answers.platform_support,
      foundry_improvement_text: trim(answers.foundry_improvement_text),
      // Section C — Learning & adoption
      improved_skills:          answers.improved_skills,
      identify_ai_tasks:        answers.identify_ai_tasks,
      identify_human_review:    answers.identify_human_review,
      likely_to_use:            answers.likely_to_use,
      concept_used_first:       answers.concept_used_first,
      real_task_text:           trim(answers.real_task_text),
      // Section D — Perception, trust, recommendation
      ai_was_chat_tool:         answers.ai_was_chat_tool,
      ai_repeatable_systems:    answers.ai_repeatable_systems,
      aware_human_oversight:    answers.aware_human_oversight,
      aware_cost_tradeoffs:     answers.aware_cost_tradeoffs,
      trust_when_inspectable:   answers.trust_when_inspectable,
      would_recommend:          answers.would_recommend === 'yes',
    };
    // Consent rides alongside feedback — the parent (GraduationScreen)
    // splits the payload and writes feedback + research_consent in
    // parallel. Versioned against the on-screen wording at submit time.
    const consent = {
      granted: answers.research_consent === 'yes',
      consentTextVersion: CONSENT_TEXT_VERSION,
    };
    onSubmit({ feedback, consent });
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
            Workshop close{userName ? ` · ${userName}` : ''}
          </div>
          <h1 className="sv-title">
            Before your scorecard,&nbsp;<em>a few words from you</em>.
          </h1>
          <p className="sv-sub">
            Twenty short questions about the training, the platform, what you’ll take to your work, and how this changed your view of AI. Your answers shape the next cohort.
          </p>
          <div className="sv-legend" aria-label="Scale legend">
            <span className="sv-legend-eyebrow">Scale</span>
            <span className="sv-legend-row">
              {SCALE_LEGEND.map(opt => (
                <span key={opt.v} className="sv-legend-item">
                  <span className="sv-legend-num">{opt.v}</span>
                  {opt.label}
                </span>
              ))}
            </span>
          </div>
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
                All required questions answered. Ready to submit.
              </span>
            ) : (
              <span className="sv-footer-pending">
                <em>{totalCount - answeredCount}</em> required {totalCount - answeredCount === 1 ? 'question' : 'questions'} left to answer.
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
