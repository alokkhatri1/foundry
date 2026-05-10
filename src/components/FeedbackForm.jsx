import { useMemo, useState } from 'react';

// Pre-graduation feedback survey — 18 questions across six sections, plus
// an appended Section G for research consent. Sections + question wording
// follow the editorial design at design/Foundry Survey + Graduation.html.
//
// Section A — Training evaluation (6 scales)        → satisfaction, relevance,
//                                                     clarity, trainer_knowledge,
//                                                     trainer_delivery,
//                                                     trainer_engagement
// Section B — Design & materials (2 scales, 1 yes/no)→ materials_quality,
//                                                     duration_appropriate,
//                                                     theory_practice
// Section C — Learning impact (2 scales)            → improved_skills, can_apply
// Section D — Open feedback (3 optional texts)      → most_valuable,
//                                                     future_topics,
//                                                     improvement_notes
// Section E — Recommendation (1 yes/no)             → would_recommend
// Section F — The platform (3 scales)               → platform_rating,
//                                                     platform_reliability,
//                                                     platform_support
// Section G — Research (1 yes/no, appended past the design's E&F)
//                                                   → research_consent table
//
// Required = all scale + yes/no questions (15 from the design + 1 consent).
// Section D's three texts are optional. Submit is enabled once required is
// complete; texts can stay empty and ride through as NULL.

const SCALE_LEGEND = [
  { v: 1, label: 'Strongly disagree' },
  { v: 2, label: 'Disagree' },
  { v: 3, label: 'Neutral' },
  { v: 4, label: 'Agree' },
  { v: 5, label: 'Strongly agree' },
];

// Bumped whenever the on-screen consent copy materially changes, so each
// research_consent row records the wording the participant actually saw.
export const CONSENT_TEXT_VERSION = 1;

const SECTIONS = [
  {
    id: 'A',
    eyebrow: 'Section A',
    title: 'Training evaluation',
    sub: 'A read of the session itself — content, trainer, delivery.',
    questions: [
      { id: 'satisfaction',       type: 'scale', text: 'Overall satisfaction with the training session.' },
      { id: 'relevance',          type: 'scale', text: 'Relevance of the training content to your role and work.' },
      { id: 'clarity',            type: 'scale', text: 'Clarity and organization of the training content.' },
      { id: 'trainer_knowledge',  type: 'scale', text: 'Trainer’s knowledge of the subject matter.' },
      { id: 'trainer_delivery',   type: 'scale', text: 'Trainer’s effectiveness in delivering the content.' },
      { id: 'trainer_engagement', type: 'scale', text: 'Trainer’s ability to engage and interact with participants.' },
    ],
  },
  {
    id: 'B',
    eyebrow: 'Section B',
    title: 'Design & materials',
    sub: 'Slides, pacing, time on the platform.',
    questions: [
      { id: 'materials_quality',    type: 'scale', text: 'Quality and usefulness of the slides and reference content.' },
      { id: 'duration_appropriate', type: 'yesno', text: 'Was the training duration appropriate?' },
      { id: 'theory_practice',      type: 'scale', text: 'Balance between guided explanation and hands-on practice on the platform.' },
    ],
  },
  {
    id: 'C',
    eyebrow: 'Section C',
    title: 'Learning impact',
    sub: 'What you take with you.',
    questions: [
      { id: 'improved_skills', type: 'scale', text: 'The training improved my knowledge and skills.' },
      { id: 'can_apply',       type: 'scale', text: 'I can apply what I learned in my work.' },
    ],
  },
  {
    id: 'D',
    eyebrow: 'Section D',
    title: 'Open feedback',
    sub: 'In your own words. All three are optional.',
    questions: [
      { id: 'most_valuable',     type: 'text', text: 'What aspects of the training did you find most valuable?', placeholder: 'A method, a moment, a mental model that clicked…' },
      { id: 'future_topics',     type: 'text', text: 'What topics would you like to see in future trainings?',    placeholder: 'A skill, a tool, an unanswered question…' },
      { id: 'improvement_notes', type: 'text', text: 'Any suggestions to improve future training sessions?',     placeholder: 'Anything you would change, drop, or add.' },
    ],
  },
  {
    id: 'E',
    eyebrow: 'Section E',
    title: 'Recommendation',
    sub: 'Would you send a colleague?',
    questions: [
      { id: 'would_recommend', type: 'yesno', text: 'Would you recommend this training to others?' },
    ],
  },
  {
    id: 'F',
    eyebrow: 'Section F',
    title: 'The platform',
    sub: 'How Foundry held up while you were learning.',
    questions: [
      { id: 'platform_rating',      type: 'scale', text: 'Ease of using the Foundry platform — intuitive, easy to navigate.' },
      { id: 'platform_reliability', type: 'scale', text: 'Reliability during the workshop — no lag, errors, or sync issues.' },
      { id: 'platform_support',     type: 'scale', text: 'How well the platform supported what you were trying to learn.' },
    ],
  },
  // Section G is the legal/research consent — not part of the training-
  // evaluation design, but required to keep the research_consent table
  // in sync. Rendered with the same shell as the design sections.
  {
    id: 'G',
    eyebrow: 'Section G',
    title: 'Research',
    sub: 'A final ask about using your work to make Foundry better.',
    questions: [
      {
        id: 'research_consent',
        type: 'yesno',
        text: 'May we learn from your journey to improve future workshops?',
        description: 'If yes, the chats, files, coworkers, workflows, and reflections you produced during this workshop will be used as research data to make Foundry better. Your name and email will be replaced with an anonymous participant ID before any analysis. You can withdraw consent any time by emailing alok@tangible.careers.',
      },
    ],
  },
];

const ALL_QUESTIONS = SECTIONS.flatMap(s => s.questions);
// "Required" excludes free-text fields — Section D is opt-in writing.
const REQUIRED_IDS = ALL_QUESTIONS.filter(q => q.type !== 'text').map(q => q.id);

function pad2(n) { return String(n).padStart(2, '0'); }

function isAnswered(q, value) {
  if (value === undefined || value === null) return false;
  if (q.type === 'text') return String(value).trim().length > 0;
  return value !== '';
}

// ---------------------------------------------------------------- controls

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
      rows={3}
    />
  );
}

// ---------------------------------------------------------------- rows

function Question({ q, index, value, onChange, isRequired }) {
  const answered = isAnswered(q, value);
  return (
    <div className={`sv-q${answered ? ' is-answered' : ''}`}>
      <div className="sv-q-meta">
        <span className="sv-q-num">{pad2(index)}</span>
        {isRequired && <span className="sv-q-req">required</span>}
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
            isRequired={q.type !== 'text'}
          />
        ))}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------- shell

export default function FeedbackForm({ onSubmit, submitting, errorMessage, userName }) {
  const [answers, setAnswers] = useState({});
  const setAnswer = (id, v) => setAnswers(a => ({ ...a, [id]: v }));

  const answeredRequired = useMemo(() => {
    return REQUIRED_IDS.filter(id => {
      const q = ALL_QUESTIONS.find(qq => qq.id === id);
      return isAnswered(q, answers[id]);
    }).length;
  }, [answers]);
  const totalRequired = REQUIRED_IDS.length;
  const ready = answeredRequired === totalRequired;

  // Section start indices for 01..NN numbering across sections.
  let cursor = 0;
  const startIndices = SECTIONS.map(s => {
    const start = cursor;
    cursor += s.questions.length;
    return start;
  });

  function handleSubmit() {
    if (!ready || submitting) return;
    const trim = (v) => (typeof v === 'string' ? v.trim() : '');
    // Maps every answer onto the workshop_feedback column it was named for.
    // Yes/no → boolean for the two boolean columns; scales pass through as
    // 1-5 ints. Optional texts go through as empty string when blank — the
    // save layer turns those into NULL.
    const feedback = {
      satisfaction:         answers.satisfaction,
      relevance:            answers.relevance,
      clarity:              answers.clarity,
      trainer_knowledge:    answers.trainer_knowledge,
      trainer_delivery:     answers.trainer_delivery,
      trainer_engagement:   answers.trainer_engagement,
      materials_quality:    answers.materials_quality,
      duration_appropriate: answers.duration_appropriate === 'yes',
      theory_practice:      answers.theory_practice,
      improved_skills:      answers.improved_skills,
      can_apply:            answers.can_apply,
      most_valuable:        trim(answers.most_valuable),
      future_topics:        trim(answers.future_topics),
      improvement_notes:    trim(answers.improvement_notes),
      would_recommend:      answers.would_recommend === 'yes',
      platform_rating:      answers.platform_rating,
      platform_reliability: answers.platform_reliability,
      platform_support:     answers.platform_support,
    };
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
          {pad2(answeredRequired)}<span className="sv-progress-of"> / {pad2(totalRequired)}</span>
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
            Eighteen short questions about the training, the materials, and the platform. Twelve scales, three yes/no, three optional notes — about five minutes. Your answers shape the next cohort.
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
                All required questions answered. Optional notes are still open.
              </span>
            ) : (
              <span className="sv-footer-pending">
                <em>{totalRequired - answeredRequired}</em> required {totalRequired - answeredRequired === 1 ? 'question' : 'questions'} left to answer.
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
            style={{ width: `${(answeredRequired / totalRequired) * 100}%` }}
          />
        </div>
      </div>
    </div>
  );
}
