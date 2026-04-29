import { useState } from 'react';

// Post-workshop feedback survey. Mandatory gate before the graduation rubric
// is shown. Scaled and yes/no questions are required; free-text fields are
// optional. The platform_rating question (Section F) is the one extra
// question that scopes how the app itself worked, separate from trainer
// and content.

const SCALE_QUESTIONS_A = [
  { key: 'satisfaction',       label: 'Overall satisfaction with the training session' },
  { key: 'relevance',          label: 'Relevance of the training content to your role/work' },
  { key: 'clarity',            label: 'Clarity and organization of the training content' },
  { key: 'trainer_knowledge',  label: "Trainer’s knowledge of the subject matter" },
  { key: 'trainer_delivery',   label: "Trainer’s effectiveness in delivering the content" },
  { key: 'trainer_engagement', label: "Trainer’s ability to engage and interact with participants" },
];

const SCALE_QUESTIONS_B_C = [
  { key: 'materials_quality',  label: 'Quality and usefulness of the slides and reference content' },
  { key: 'theory_practice',    label: 'Balance between guided explanation and hands-on practice on the platform' },
  { key: 'improved_skills',    label: 'The training improved my knowledge / skills' },
  { key: 'can_apply',          label: 'I can apply what I learned in my work' },
];

// Section F (Platform) was originally a single question. Since the training
// itself is delivered through the platform, one rating wasn't enough signal —
// expanded to three so the trainer can see ease, reliability, and pedagogical
// fit independently.
const PLATFORM_QUESTIONS = [
  { key: 'platform_rating',       label: 'Ease of using the Foundry platform (intuitive, easy to navigate)' },
  { key: 'platform_reliability',  label: 'Reliability during the workshop (no lag, errors, or sync issues)' },
  { key: 'platform_support',      label: 'How well the platform supported what you were trying to learn' },
];

const SCALE_LABELS = ['Strongly disagree', 'Disagree', 'Neutral', 'Agree', 'Strongly agree'];

function ScaleRow({ value, onChange, disabled }) {
  return (
    <div className="fb-scale-wrap">
      <div className="fb-scale">
        {[1, 2, 3, 4, 5].map(n => (
          <button
            type="button"
            key={n}
            className={`fb-scale-btn${value === n ? ' active' : ''}`}
            onClick={() => onChange(n)}
            disabled={disabled}
            title={SCALE_LABELS[n - 1]}
          >
            {n}
          </button>
        ))}
      </div>
      <div className="fb-scale-legend">
        <span>1 — {SCALE_LABELS[0]}</span>
        <span>5 — {SCALE_LABELS[4]}</span>
      </div>
    </div>
  );
}

function YesNoRow({ value, onChange, disabled }) {
  return (
    <div className="fb-yesno">
      <button
        type="button"
        className={`fb-yesno-btn${value === true ? ' active' : ''}`}
        onClick={() => onChange(true)}
        disabled={disabled}
      >Yes</button>
      <button
        type="button"
        className={`fb-yesno-btn${value === false ? ' active' : ''}`}
        onClick={() => onChange(false)}
        disabled={disabled}
      >No</button>
    </div>
  );
}

export default function FeedbackForm({ onSubmit, submitting, errorMessage }) {
  const [answers, setAnswers] = useState({});
  const [touched, setTouched] = useState(false);

  function update(key, value) {
    setAnswers(prev => ({ ...prev, [key]: value }));
  }

  // Required keys: every scaled and yes/no question (free text is optional).
  const requiredScaleKeys = [
    ...SCALE_QUESTIONS_A.map(q => q.key),
    ...SCALE_QUESTIONS_B_C.map(q => q.key),
    ...PLATFORM_QUESTIONS.map(q => q.key),
  ];
  const missingScale = requiredScaleKeys.filter(k => !answers[k]);
  const missingYesNo = ['duration_appropriate', 'would_recommend'].filter(k => answers[k] === undefined);
  const isComplete = missingScale.length === 0 && missingYesNo.length === 0;

  function handleSubmit(e) {
    e.preventDefault();
    setTouched(true);
    if (!isComplete) return;
    onSubmit({
      satisfaction:         answers.satisfaction,
      relevance:            answers.relevance,
      clarity:              answers.clarity,
      trainer_knowledge:    answers.trainer_knowledge,
      trainer_delivery:     answers.trainer_delivery,
      trainer_engagement:   answers.trainer_engagement,
      materials_quality:    answers.materials_quality,
      duration_appropriate: answers.duration_appropriate,
      theory_practice:      answers.theory_practice,
      improved_skills:      answers.improved_skills,
      can_apply:            answers.can_apply,
      most_valuable:        (answers.most_valuable || '').trim() || null,
      future_topics:        (answers.future_topics || '').trim() || null,
      improvement_notes:    (answers.improvement_notes || '').trim() || null,
      would_recommend:      answers.would_recommend,
      platform_rating:      answers.platform_rating,
      platform_reliability: answers.platform_reliability,
      platform_support:     answers.platform_support,
    });
  }

  function fieldError(key) {
    if (!touched) return false;
    if (key === 'duration_appropriate' || key === 'would_recommend') return answers[key] === undefined;
    return !answers[key];
  }

  return (
    <form className="feedback-form" onSubmit={handleSubmit}>
      <div className="fb-header">
        <h2>Workshop feedback</h2>
        <p className="fb-sub">
          Quick survey before your graduation summary. All scale and yes/no questions are required;
          open-ended ones are optional. Takes about 2 minutes.
        </p>
      </div>

      <section className="fb-section">
        <h3 className="fb-section-title">A. Training evaluation</h3>
        {SCALE_QUESTIONS_A.map((q, i) => (
          <div key={q.key} className={`fb-row${fieldError(q.key) ? ' has-error' : ''}`}>
            <label className="fb-label"><span className="fb-num">{i + 1}.</span> {q.label}</label>
            <ScaleRow value={answers[q.key]} onChange={v => update(q.key, v)} disabled={submitting} />
          </div>
        ))}
      </section>

      <section className="fb-section">
        <h3 className="fb-section-title">B. Training design &amp; materials</h3>
        <div className={`fb-row${fieldError('materials_quality') ? ' has-error' : ''}`}>
          <label className="fb-label"><span className="fb-num">7.</span> {SCALE_QUESTIONS_B_C[0].label}</label>
          <ScaleRow value={answers.materials_quality} onChange={v => update('materials_quality', v)} disabled={submitting} />
        </div>
        <div className={`fb-row${fieldError('duration_appropriate') ? ' has-error' : ''}`}>
          <label className="fb-label"><span className="fb-num">8.</span> Was the training duration appropriate?</label>
          <YesNoRow value={answers.duration_appropriate} onChange={v => update('duration_appropriate', v)} disabled={submitting} />
        </div>
        <div className={`fb-row${fieldError('theory_practice') ? ' has-error' : ''}`}>
          <label className="fb-label"><span className="fb-num">9.</span> {SCALE_QUESTIONS_B_C[1].label}</label>
          <ScaleRow value={answers.theory_practice} onChange={v => update('theory_practice', v)} disabled={submitting} />
        </div>
      </section>

      <section className="fb-section">
        <h3 className="fb-section-title">C. Learning impact</h3>
        <div className={`fb-row${fieldError('improved_skills') ? ' has-error' : ''}`}>
          <label className="fb-label"><span className="fb-num">10.</span> {SCALE_QUESTIONS_B_C[2].label}</label>
          <ScaleRow value={answers.improved_skills} onChange={v => update('improved_skills', v)} disabled={submitting} />
        </div>
        <div className={`fb-row${fieldError('can_apply') ? ' has-error' : ''}`}>
          <label className="fb-label"><span className="fb-num">11.</span> {SCALE_QUESTIONS_B_C[3].label}</label>
          <ScaleRow value={answers.can_apply} onChange={v => update('can_apply', v)} disabled={submitting} />
        </div>
      </section>

      <section className="fb-section">
        <h3 className="fb-section-title">D. Open feedback <span className="fb-optional">optional</span></h3>
        <div className="fb-row">
          <label className="fb-label"><span className="fb-num">12.</span> What aspects of the training did you find most valuable?</label>
          <textarea
            className="fb-textarea"
            value={answers.most_valuable || ''}
            onChange={e => update('most_valuable', e.target.value)}
            disabled={submitting}
            rows={3}
            placeholder="Open response"
          />
        </div>
        <div className="fb-row">
          <label className="fb-label"><span className="fb-num">13.</span> What topics would you like to see in future trainings?</label>
          <textarea
            className="fb-textarea"
            value={answers.future_topics || ''}
            onChange={e => update('future_topics', e.target.value)}
            disabled={submitting}
            rows={3}
            placeholder="Open response"
          />
        </div>
        <div className="fb-row">
          <label className="fb-label"><span className="fb-num">14.</span> Any suggestions to improve future training sessions?</label>
          <textarea
            className="fb-textarea"
            value={answers.improvement_notes || ''}
            onChange={e => update('improvement_notes', e.target.value)}
            disabled={submitting}
            rows={3}
            placeholder="Open response"
          />
        </div>
      </section>

      <section className="fb-section">
        <h3 className="fb-section-title">E. Recommendation</h3>
        <div className={`fb-row${fieldError('would_recommend') ? ' has-error' : ''}`}>
          <label className="fb-label"><span className="fb-num">15.</span> Would you recommend this training to others?</label>
          <YesNoRow value={answers.would_recommend} onChange={v => update('would_recommend', v)} disabled={submitting} />
        </div>
      </section>

      <section className="fb-section">
        <h3 className="fb-section-title">F. Platform</h3>
        {PLATFORM_QUESTIONS.map((q, i) => (
          <div key={q.key} className={`fb-row${fieldError(q.key) ? ' has-error' : ''}`}>
            <label className="fb-label"><span className="fb-num">{16 + i}.</span> {q.label}</label>
            <ScaleRow value={answers[q.key]} onChange={v => update(q.key, v)} disabled={submitting} />
          </div>
        ))}
      </section>

      {errorMessage && <div className="fb-error">{errorMessage}</div>}
      {touched && !isComplete && (
        <div className="fb-error">Please answer all required questions before submitting.</div>
      )}

      <div className="fb-actions">
        <button type="submit" className="fb-submit" disabled={submitting}>
          {submitting ? 'Submitting…' : 'Submit and continue'}
        </button>
      </div>
    </form>
  );
}
