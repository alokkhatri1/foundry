import { REFLECTION_PROMPTS } from '../data/reflectionPrompts';
import { LEVELS } from '../utils/graduationScorecard';

// Reflections takeaway. Rendered offscreen, captured by html2canvas,
// embedded as A4 portrait pages in jsPDF. For each stage the participant
// reflected on, the card shows the stage's intent (anchor) plus the
// participant's four answers (clarity rating, agreement rating, the
// text answer, and the structured selection).
//
// Card framework (cover · per-stage cards · closer) is locked. The
// sections inside each card adapt to whatever the new reflection shape
// produced — same gr-takeaway-card-section pattern, just iterated over
// the question array from reflectionPrompts.js.

const REFLECTION_STAGES_ORDERED = ['3', '4', '5', '6', '7', '8'];

// Stage option codes → human labels for the structured-answer fields.
// Mirrors the option arrays in reflectionPrompts.js so the takeaway
// shows what the participant saw, not the enum code.
const STRUCTURED_LABELS = {
  '3': {
    barriers: {
      wrong_application: 'It might apply the instruction incorrectly',
      forget_contents:   'I might forget what the skill contains',
      too_rigid:         'It might make the AI too rigid',
      manual_control:    'I would rather control each prompt manually',
      no_repeated_tasks: 'I do not have repeated tasks where this is useful',
      privacy:           'Privacy or company policy concerns',
      other:             'Other',
    },
  },
  '4': {
    barriers: {
      confidentiality:   'Confidentiality',
      unclear_policy:    'Unclear data policy',
      misinterpretation: 'Fear of wrong interpretation',
      too_much_effort:   'Too much effort',
      unsure_which:      'I do not know which documents are useful',
      do_not_trust:      'I do not trust the AI with files',
      other:             'Other',
    },
  },
  '5': {
    feeling: {
      saved_prompt:          'A saved prompt',
      specialized_assistant: 'A specialized assistant',
      junior_teammate:       'A junior teammate',
      sme:                   'A subject-matter expert',
      workflow_component:    'A workflow component',
      chatbot_label:         'A chatbot with a label',
      unsure:                'I am not sure',
    },
  },
  '6': {
    review_point: {
      before_start:    'Before the AI starts',
      after_each_step: 'After each AI step',
      before_final:    'Only before the final output',
      when_uncertain:  'Only when the AI is uncertain',
      high_risk:       'Only for high-risk tasks',
      not_always:      'Human review is not always needed',
      other:           'Other',
    },
  },
  '7': {
    confidence_shift: {
      much_less:     'Much less confident',
      slightly_less: 'Slightly less confident',
      no_change:     'No change',
      slightly_more: 'Slightly more confident',
      much_more:     'Much more confident',
    },
    check_first: {
      prompt:        'The original prompt',
      skill:         'The skill/instruction file',
      knowledge:     'The knowledge file',
      coworker_role: 'The coworker role',
      workflow_step: 'The workflow step where the issue appeared',
      review_point:  'The human review or approval point',
      final_output:  'The final output only',
      unsure:        'I am not sure',
    },
  },
  '8': {
    behavior_change: {
      use_less:        'I would use AI less',
      use_selectively: 'I would use AI more selectively',
      simpler_flows:   'I would choose simpler workflows when possible',
      quality_over:    'I would still prioritize quality over cost',
      do_not_grok:     'I do not understand the cost well enough yet',
      no_change:       'It would not change my behavior',
      other:           'Other',
    },
  },
};

function structuredLabel(stage, key, code) {
  return STRUCTURED_LABELS[String(stage)]?.[key]?.[code] || code;
}

function RatingRow({ score }) {
  return (
    <div className="gr-takeaway-card-rating-row">
      <span className="gr-takeaway-card-rating" aria-label={`${score} of 5`}>
        {[1, 2, 3, 4, 5].map(n => (
          <span
            key={n}
            className={`gr-takeaway-card-rating-dot${n <= score ? ' is-on' : ''}`}
            aria-hidden
          />
        ))}
      </span>
      <span className="gr-takeaway-card-rating-num">{score} / 5</span>
    </div>
  );
}

// Returns the rendered JSX for one reflection question + its answer,
// or null if the answer isn't present (so a half-filled reflection
// only surfaces what the participant actually wrote).
function renderAnswer(stage, q, r) {
  if (q.type === 'clarity') {
    // clarity is stored on the legacy `confidence` column.
    if (typeof r.confidence !== 'number') return null;
    return (
      <div className="gr-takeaway-card-section" key={q.id}>
        <div className="gr-takeaway-card-question">{q.text}</div>
        <RatingRow score={r.confidence} />
      </div>
    );
  }
  if (q.type === 'agreement') {
    if (typeof r.agreement !== 'number') return null;
    return (
      <div className="gr-takeaway-card-section" key={q.id}>
        <div className="gr-takeaway-card-question">{q.text}</div>
        <RatingRow score={r.agreement} />
      </div>
    );
  }
  if (q.type === 'text') {
    const v = (r.transfer_text || '').trim();
    if (!v) return null;
    return (
      <div className="gr-takeaway-card-section" key={q.id}>
        <div className="gr-takeaway-card-question">{q.text}</div>
        <blockquote className="gr-takeaway-card-quote">{v}</blockquote>
      </div>
    );
  }
  if (q.type === 'chip') {
    const code = r.structured?.[q.id];
    if (!code) return null;
    return (
      <div className="gr-takeaway-card-section" key={q.id}>
        <div className="gr-takeaway-card-question">{q.text}</div>
        <blockquote className="gr-takeaway-card-quote">{structuredLabel(stage, q.id, code)}</blockquote>
      </div>
    );
  }
  if (q.type === 'chips') {
    const codes = r.structured?.[q.id];
    if (!Array.isArray(codes) || codes.length === 0) return null;
    return (
      <div className="gr-takeaway-card-section" key={q.id}>
        <div className="gr-takeaway-card-question">{q.text}</div>
        <blockquote className="gr-takeaway-card-quote">
          {codes.map(c => structuredLabel(stage, q.id, c)).join(' · ')}
        </blockquote>
      </div>
    );
  }
  return null;
}

// Has-content test: a reflection row counts as filled if any of its
// new fields, the legacy note/habit, or a confidence rating is set.
function isFilled(r) {
  if (!r) return false;
  if (typeof r.confidence === 'number') return true;
  if (typeof r.agreement === 'number')  return true;
  if (r.transfer_text && r.transfer_text.trim()) return true;
  if (r.structured && typeof r.structured === 'object' && Object.keys(r.structured).length > 0) return true;
  // Legacy fields, pre-instrument rows.
  if (r.note?.trim() || r.habit?.trim()) return true;
  return false;
}

export default function HandoutPage({
  userName,
  orgName,
  level,
  date,
  reflections,
}) {
  const reflectionsByStage = new Map();
  for (const r of (reflections || [])) {
    reflectionsByStage.set(String(r.stage), r);
  }

  const filledStages = REFLECTION_STAGES_ORDERED
    .map(stage => ({ stage, prompt: REFLECTION_PROMPTS[stage], r: reflectionsByStage.get(stage) }))
    .filter(({ r }) => isFilled(r));

  const levelWord = (typeof level === 'number' && LEVELS[level]) ? LEVELS[level] : null;
  const metaParts = [userName || 'Participant'];
  if (orgName) metaParts.push(orgName);
  metaParts.push(`Issued ${date}`);
  if (levelWord) metaParts.push(`Level: ${levelWord}`);

  return (
    <div className="gr-takeaway">
      {/* Cover */}
      <header className="gr-takeaway-cover">
        <div className="gr-takeaway-eyebrow">
          <span className="gr-takeaway-eyebrow-dot" aria-hidden />
          FOUNDRY · YOUR REFLECTIONS
        </div>
        <h1 className="gr-takeaway-title">
          You rehearse&nbsp;<em>to become AI native</em>.
        </h1>
        <div className="gr-takeaway-meta">
          {metaParts.map((p, i) => (
            <span key={i} className="gr-takeaway-meta-bit">{p}</span>
          ))}
        </div>
      </header>

      {/* Per-stage reflection cards. Each card iterates the stage's
          question list and renders only the answers that were given —
          so a half-filled reflection just shows fewer sections. */}
      <div className="gr-takeaway-cards">
        {filledStages.map(({ stage, prompt, r }) => (
          <article key={stage} className="gr-takeaway-card">
            <header className="gr-takeaway-card-head">
              <div className="gr-takeaway-card-meta">
                <span className="gr-takeaway-card-stage">Stage {stage}</span>
              </div>
              <h2 className="gr-takeaway-card-label">{prompt?.label || `Stage ${stage}`}</h2>
              {prompt?.anchor && (
                <p className="gr-takeaway-card-anchor"><em>{prompt.anchor}</em></p>
              )}
            </header>

            {(prompt?.questions || []).map(q => renderAnswer(stage, q, r))}
          </article>
        ))}
      </div>

      {/* Closer */}
      <footer className="gr-takeaway-closer">
        <div className="gr-takeaway-closer-mark">
          <svg viewBox="0 0 80 24" aria-hidden>
            <path d="M 4 18 C 14 4, 24 22, 34 12 S 54 4, 64 18" stroke="#d97757" strokeWidth="1.5" fill="none" strokeLinecap="round" />
            <circle cx="68" cy="18" r="1.5" fill="#d97757" />
          </svg>
        </div>
        <div className="gr-takeaway-closer-text">
          Save this somewhere you’ll see it when you next sit down to build.
        </div>
        <div className="gr-takeaway-closer-credit">
          Foundry by Alok Khatri
        </div>
      </footer>
    </div>
  );
}
