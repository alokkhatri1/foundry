import { useState } from 'react';
import { REFLECTION_PROMPTS } from '../data/reflectionPrompts';

// Scale legends (mirror StageReflection.jsx) so a rating shows its word too.
const CLARITY_LEGEND = { 1: 'Not clear at all', 2: 'Slightly clear', 3: 'Moderately clear', 4: 'Very clear', 5: 'Extremely clear' };
const AGREEMENT_LEGEND = { 1: 'Strongly disagree', 2: 'Disagree', 3: 'Neutral', 4: 'Agree', 5: 'Strongly agree' };

// Forms & responses view for the Research Bench. Shows the actual answers
// participants entered in the workshop's forms — Demographics, per-stage
// Reflections, and the End-of-workshop Survey — as spreadsheet-style tables
// (one row per participant, one column per question, full question text as the
// header). Consent-filtered. Works for a single cohort or, when the data
// carries roomNameByPid, the whole consented corpus (adds a Cohort column).

// Code → readable label. Keys mirror the actual option codes in
// DemographicsForm / FeedbackForm / reflectionPrompts (verified against source).
const LABELS = {
  // tenure
  lt_1y: '<1 year', '1_3y': '1–3 years', '3_7y': '3–7 years', '7_15y': '7–15 years', gt_15y: '15+ years',
  // industry
  tech: 'Technology', finance: 'Finance', healthcare: 'Healthcare', education: 'Education',
  consulting: 'Consulting', public_sector: 'Public sector', marketing: 'Media / Marketing',
  // work type
  strategy: 'Strategy / planning', operations: 'Operations', analysis: 'Analysis / reporting',
  research: 'Research', writing: 'Writing / communication', customer: 'Customer or client work',
  product_eng: 'Product / engineering', management: 'Management',
  // ai use frequency
  never: 'Never', occasional: 'Occasionally', weekly: 'Weekly', daily: 'Daily', multi_daily: 'Multiple times a day',
  // ai tools
  chatgpt: 'ChatGPT', claude: 'Claude', gemini: 'Gemini', copilot: 'Copilot', perplexity: 'Perplexity',
  image_gen: 'Image-generation tools', internal: 'Internal company AI tool', none: 'None yet',
  // ai use cases
  drafting: 'Drafting text', summarizing: 'Summarizing documents', brainstorm: 'Brainstorming',
  data: 'Data analysis', coding: 'Coding', decision: 'Decision support',
  automation: 'Automating repeated work', not_yet: 'I do not use AI yet',
  // mental model
  search: 'A search engine', productivity: 'A productivity tool', coworker: 'A coworker',
  expert: 'An expert advisor', risky: 'A risky tool that needs supervision', unsure: 'Not sure yet',
  // adoption criteria
  accuracy: 'Accuracy', speed: 'Speed', privacy: 'Privacy', ease: 'Ease of use', control: 'Control',
  explainability: 'Explainability', cost: 'Cost', quality: 'Quality of final output',
  reviewability: 'Review/edit before use',
  // concept used first
  skill: 'Skill file', knowledge: 'Knowledge file', workflow: 'Workflow', audit: 'Audit log',
  none_yet: 'None yet',
  // reflection: skill-file barriers
  wrong_application: 'Might apply instruction incorrectly', forget_contents: 'Might forget skill contents',
  too_rigid: 'Might make AI too rigid', manual_control: 'Rather control each prompt', no_repeated_tasks: 'No repeated tasks',
  // reflection: knowledge-file barriers
  confidentiality: 'Confidentiality', unclear_policy: 'Unclear data policy',
  misinterpretation: 'Fear of wrong interpretation', too_much_effort: 'Too much effort',
  unsure_which: 'Unsure which docs useful', do_not_trust: 'Don’t trust AI with files',
  // reflection: coworker feeling
  saved_prompt: 'A saved prompt', specialized_assistant: 'A specialized assistant',
  junior_teammate: 'A junior teammate', sme: 'A subject-matter expert',
  workflow_component: 'A workflow component', chatbot_label: 'A chatbot with a label',
  // reflection: review point
  before_start: 'Before the AI starts', after_each_step: 'After each AI step',
  before_final: 'Only before final output', when_uncertain: 'Only when AI uncertain',
  high_risk: 'Only high-risk tasks', not_always: 'Not always needed',
  // reflection: confidence shift / check first / behavior change
  much_less: 'Much less confident', slightly_less: 'Slightly less confident', no_change: 'No change',
  slightly_more: 'Slightly more confident', much_more: 'Much more confident',
  prompt: 'The original prompt', coworker_role: 'The coworker role',
  workflow_step: 'The workflow step', review_point: 'The review/approval point', final_output: 'The final output only',
  use_less: 'Use AI less', use_selectively: 'Use AI more selectively', simpler_flows: 'Choose simpler workflows',
  quality_over: 'Prioritize quality over cost', do_not_grok: 'Don’t understand cost yet',
  // shared
  other: 'Other',
};
const lbl = (v) => v == null || v === '' ? '—'
  : (LABELS[v] || String(v).replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()));

function fmt(v) {
  if (v == null || v === '') return '—';
  if (Array.isArray(v)) return v.length ? v.map(lbl).join(', ') : '—';
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  if (typeof v === 'number') return String(v);
  return lbl(v);
}

// Full question text as column headers (verified against the form components).
const DEMO_COLS = [
  { key: 'role', label: 'What is your role or job title?' },
  { key: 'tenure_band', label: 'How long have you been in your current role?' },
  { key: 'industry', label: 'Which industry are you in?' },
  { key: 'work_type', label: 'Which best describes the type of work you do?' },
  { key: 'ai_familiarity', label: 'How familiar are you with AI tools today? (1–5)' },
  { key: 'ai_use_frequency', label: 'How often do you use AI tools right now?' },
  { key: 'ai_tools', label: 'Which AI tools have you used?' },
  { key: 'ai_use_cases', label: 'What do you usually use AI for?' },
  { key: 'ai_mental_model', label: 'Which statement best describes how you currently think about AI?' },
  { key: 'evaluation_confidence', label: 'I can usually tell when an AI answer is good enough to use. (1–5)' },
  { key: 'delegation_comfort', label: 'I feel comfortable delegating a work task to AI if I can review the output. (1–5)' },
  { key: 'adoption_criteria_top3', label: 'When deciding whether to use AI, what matters most? (top 3, ranked)' },
  { key: 'delegation_boundary', label: 'What kind of work would you not want AI to do for you? Why?' },
];

const SURVEY_COLS = [
  { key: 'satisfaction', label: 'Overall, I was satisfied with the workshop. (1–5)' },
  { key: 'relevance', label: 'The workshop content was relevant to my role or work. (1–5)' },
  { key: 'clarity', label: 'The workshop was clearly organized. (1–5)' },
  { key: 'theory_practice', label: 'The balance between explanation and hands-on practice was appropriate. (1–5)' },
  { key: 'improved_skills', label: 'The workshop improved my ability to use AI at work. (1–5)' },
  { key: 'identify_ai_tasks', label: 'I can identify tasks in my work that are suitable for AI. (1–5)' },
  { key: 'identify_human_review', label: 'I can identify tasks that should still require human review. (1–5)' },
  { key: 'likely_to_use', label: 'I am likely to use at least one Foundry concept in my real work. (1–5)' },
  { key: 'concept_used_first', label: 'Which Foundry concept are you most likely to use first?' },
  { key: 'real_task_text', label: 'What is one real task where you could imagine using Foundry?' },
  { key: 'foundry_improvement_text', label: 'What is one thing that would make Foundry easier to use?' },
  { key: 'platform_rating', label: 'The Foundry platform was easy to navigate. (1–5)' },
  { key: 'platform_reliability', label: 'The platform was reliable during the workshop. (1–5)' },
  { key: 'platform_support', label: 'The platform helped me understand AI workflows better than a lecture alone. (1–5)' },
  { key: 'ai_was_chat_tool', label: 'Before this workshop, I mostly thought of AI as a chat tool. (1–5)' },
  { key: 'ai_repeatable_systems', label: 'After this workshop, I see AI as something organized into repeatable work systems. (1–5)' },
  { key: 'aware_human_oversight', label: 'After this workshop, I feel more aware of where AI needs human oversight. (1–5)' },
  { key: 'aware_cost_tradeoffs', label: 'After this workshop, I feel more aware that AI use involves cost/resource tradeoffs. (1–5)' },
  { key: 'trust_when_inspectable', label: 'I would trust AI more when I can inspect its instructions, knowledge, and workflow steps. (1–5)' },
  { key: 'would_recommend', label: 'Would you recommend this workshop to a colleague?' },
  { key: 'most_valuable', label: 'What was most valuable? (legacy)' },
];

const STAGES = ['3', '4', '5', '6', '7', '8'];
const STAGE_NAME = { 3: 'Skills', 4: 'Knowledge', 5: 'Coworkers', 6: 'Workflow', 7: 'Audit', 8: 'Economics' };

// Map a structured chip value (or array) to the question's own option labels —
// authoritative per question, since codes repeat across stages with different
// meanings (e.g. 'unsure', 'no_change', 'privacy').
function optLabel(q, value) {
  const map = Object.fromEntries((q.options || []).map(o => [o.v, o.label]));
  if (Array.isArray(value)) return value.map(v => map[v] || lbl(v)).join(', ');
  return map[value] || lbl(value);
}

// Answer the participant gave to one reflection question, by its type.
function answerFor(q, refl) {
  if (q.type === 'clarity') {
    const v = refl.confidence;
    return v == null ? '—' : `${v} — ${CLARITY_LEGEND[v] || ''}`;
  }
  if (q.type === 'agreement') {
    const v = refl.agreement;
    return v == null ? '—' : `${v} — ${AGREEMENT_LEGEND[v] || ''}`;
  }
  if (q.type === 'text') {
    const v = refl.transfer_text;
    return v ? `“${v}”` : '—';
  }
  // chip / chips → stored under structured[q.id]
  const v = refl.structured?.[q.id];
  return v == null || (Array.isArray(v) && !v.length) ? '—' : optLabel(q, v);
}

// One stage's cell: each question (full text) paired with the participant's
// answer, in the order the form asked them.
function ReflectionCell({ stage, refl }) {
  if (!refl) return <span className="rf-muted">—</span>;
  const prompt = REFLECTION_PROMPTS[stage];
  if (!prompt) return <span className="rf-muted">—</span>;
  return (
    <div className="rf-refl-cell">
      {prompt.questions.map(q => {
        const ans = answerFor(q, refl);
        const isText = q.type === 'text';
        return (
          <div className="rf-rq" key={q.id}>
            <div className="rf-rq-text">{q.text}</div>
            <div className={`rf-rq-ans${isText ? ' rf-rq-quote' : ''}`}>{ans}</div>
          </div>
        );
      })}
    </div>
  );
}

// Generic scrollable table. cols = [{key, label, render?}]. Participant (and
// optionally Cohort) columns are sticky-left so wide tables stay readable.
function Table({ cols, rows, showCohort }) {
  if (!rows.length) return <div className="rf-empty">No participants.</div>;
  return (
    <div className="rf-scroll">
      <table className="rf-table">
        <thead>
          <tr>
            <th className="rf-sticky rf-sticky-1">Participant</th>
            {showCohort && <th className="rf-sticky rf-sticky-2">Cohort</th>}
            {cols.map(c => <th key={c.key}>{c.label}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              <td className="rf-sticky rf-sticky-1 rf-name">{r.name}</td>
              {showCohort && <td className="rf-sticky rf-sticky-2 rf-cohort">{r.cohort}</td>}
              {cols.map(c => <td key={c.key}>{c.render ? c.render(r) : fmt(r.row?.[c.key])}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function ResearchForms({ data }) {
  const [form, setForm] = useState('demographics');
  if (!data) return <div className="rf-empty">Pick a cohort to see its form responses.</div>;

  const showCohort = !!data.roomNameByPid; // all-cohorts mode

  const consented = (data.participants || [])
    .filter(p => (p.kind || 'human') === 'human')
    .filter(p => {
      const c = data.consentByPid?.[p.id];
      return c && c.granted === true && !c.withdrawn_at;
    })
    .sort((a, b) => (a.name || '').localeCompare(b.name || ''));

  if (!consented.length) return <div className="rf-empty">No consented participants.</div>;

  const reflByPid = {};
  for (const r of data.stageReflections || []) {
    (reflByPid[r.participant_id] ||= {})[String(r.stage)] = r;
  }

  const base = (p) => ({ name: p.name, cohort: data.roomNameByPid?.[p.id] });
  const demoRows = consented.map(p => ({ ...base(p), row: data.demographicsByPid?.[p.id] || {} }));
  const surveyRows = consented.map(p => ({ ...base(p), row: data.feedbackByPid?.[p.id] || {} }));
  const reflRows = consented.map(p => ({ ...base(p), refl: reflByPid[p.id] || {} }));

  const hasDemo = demoRows.some(r => Object.keys(r.row).length);
  const hasSurvey = surveyRows.some(r => Object.keys(r.row).length);
  const hasRefl = reflRows.some(r => Object.keys(r.refl).length);

  return (
    <div className="rf-wrap">
      <div className="rf-tabs">
        <button className={form === 'demographics' ? 'is-active' : ''} onClick={() => setForm('demographics')}>Demographics</button>
        <button className={form === 'reflections' ? 'is-active' : ''} onClick={() => setForm('reflections')}>Reflections</button>
        <button className={form === 'survey' ? 'is-active' : ''} onClick={() => setForm('survey')}>End survey</button>
        <span className="rf-count">{consented.length} consented{showCohort ? ' · all cohorts' : ''}</span>
      </div>

      {form === 'demographics' && (
        hasDemo ? <Table cols={DEMO_COLS} rows={demoRows} showCohort={showCohort} />
          : <div className="rf-empty">No demographics responses here (cohorts may predate the form).</div>
      )}

      {form === 'survey' && (
        hasSurvey ? <Table cols={SURVEY_COLS} rows={surveyRows} showCohort={showCohort} />
          : <div className="rf-empty">No end-of-workshop survey responses here.</div>
      )}

      {form === 'reflections' && (
        hasRefl ? (
          <div className="rf-scroll">
            <table className="rf-table">
              <thead>
                <tr>
                  <th className="rf-sticky rf-sticky-1">Participant</th>
                  {showCohort && <th className="rf-sticky rf-sticky-2">Cohort</th>}
                  {STAGES.map(s => <th key={s}>Stage {s} · {STAGE_NAME[s]}</th>)}
                </tr>
              </thead>
              <tbody>
                {reflRows.map((r, i) => (
                  <tr key={i}>
                    <td className="rf-sticky rf-sticky-1 rf-name">{r.name}</td>
                    {showCohort && <td className="rf-sticky rf-sticky-2 rf-cohort">{r.cohort}</td>}
                    {STAGES.map(s => <td key={s}><ReflectionCell stage={s} refl={r.refl[s]} /></td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <div className="rf-empty">No stage reflections here.</div>
      )}
    </div>
  );
}
