import { useState } from 'react';

// Forms & responses view for the Research Bench. Shows the actual answers
// participants entered in the workshop's forms — Demographics, per-stage
// Reflections, and the End-of-workshop Survey — as spreadsheet-style tables
// (one row per participant, one column per question). Consent-filtered to
// match the rest of the bench. Cohorts that predate a form show an empty note.

// ---- code → readable label maps (mirror the form option codes) ----
const LABELS = {
  // tenure
  lt_1y: '<1 year', '1_3y': '1–3 years', '3_7y': '3–7 years', '7_15y': '7–15 years', '15y_plus': '15+ years',
  // industry
  technology: 'Technology', finance: 'Finance', healthcare: 'Healthcare', education: 'Education',
  consulting: 'Consulting', public_sector: 'Public sector', media_marketing: 'Media / Marketing', other: 'Other',
  // work_type
  strategy: 'Strategy', operations: 'Operations', analysis: 'Analysis', research: 'Research',
  writing: 'Writing', customer: 'Customer work', product_eng: 'Product / Eng', management: 'Management',
  // ai_use_frequency
  never: 'Never', occasionally: 'Occasionally', weekly: 'Weekly', daily: 'Daily', multiple_daily: 'Multiple/day',
  // ai tools / use cases
  chatgpt: 'ChatGPT', claude: 'Claude', gemini: 'Gemini', copilot: 'Copilot', perplexity: 'Perplexity',
  image_gen: 'Image gen', internal: 'Internal tool', none_yet: 'None yet',
  drafting: 'Drafting', summarizing: 'Summarizing', brainstorm: 'Brainstorming', data: 'Data analysis',
  coding: 'Coding', decision: 'Decision support', automation: 'Automation',
  // mental model
  search_engine: 'Search engine', writing_assistant: 'Writing assistant', productivity_tool: 'Productivity tool',
  coworker: 'Coworker', expert: 'Expert advisor', risky: 'Risky tool', unsure: 'Not sure',
  // adoption criteria
  accuracy: 'Accuracy', speed: 'Speed', privacy: 'Privacy', ease: 'Ease of use', control: 'Control',
  explainability: 'Explainability', cost: 'Cost', quality: 'Output quality', reviewability: 'Reviewability',
  // concept used first
  skill_file: 'Skill file', knowledge_file: 'Knowledge file', ai_coworker: 'AI coworker',
  workflow: 'Workflow', audit_log: 'Audit log', cost_view: 'Cost view',
  // reflection structured codes (common ones)
  too_rigid: 'Too rigid', privacy_concern: 'Privacy', wrong_application: 'Wrong application',
  unclear_policy: 'Unclear policy', misinterpretation: 'Misinterpretation', unsure_which: 'Unsure which',
  too_much_effort: 'Too much effort', confidentiality: 'Confidentiality',
  specialized_assistant: 'Specialized assistant', junior_teammate: 'Junior teammate',
  subject_expert: 'Subject expert', workflow_component: 'Workflow component', chatbot_label: 'Chatbot w/ label',
  saved_prompt: 'Saved prompt', after_each_step: 'After each step', when_uncertain: 'When uncertain',
  high_risk: 'High-risk only', before_final: 'Before final', before_start: 'Before AI starts',
  not_always: 'Not always needed', quality_over: 'Quality over cost', use_selectively: 'Use selectively',
  slightly_more: 'Slightly more', much_more: 'Much more', no_change: 'No change',
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

// Generic scrollable table. cols = [{key, label, render?}]. First column
// (participant name) is sticky so wide tables stay readable.
function Table({ cols, rows, getName }) {
  if (!rows.length) return <div className="rf-empty">No participants.</div>;
  return (
    <div className="rf-scroll">
      <table className="rf-table">
        <thead>
          <tr>
            <th className="rf-sticky">Participant</th>
            {cols.map(c => <th key={c.key}>{c.label}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              <td className="rf-sticky rf-name">{getName(r)}</td>
              {cols.map(c => (
                <td key={c.key}>{c.render ? c.render(r) : fmt(r.row?.[c.key])}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const DEMO_COLS = [
  { key: 'role', label: 'Role' },
  { key: 'tenure_band', label: 'Tenure' },
  { key: 'industry', label: 'Industry' },
  { key: 'work_type', label: 'Work type' },
  { key: 'ai_familiarity', label: 'AI familiarity (1–5)' },
  { key: 'ai_use_frequency', label: 'AI use freq.' },
  { key: 'ai_tools', label: 'AI tools used' },
  { key: 'ai_use_cases', label: 'AI use cases' },
  { key: 'ai_mental_model', label: 'Mental model' },
  { key: 'evaluation_confidence', label: 'Eval confidence (1–5)' },
  { key: 'delegation_comfort', label: 'Delegation comfort (1–5)' },
  { key: 'adoption_criteria_top3', label: 'Top-3 adoption criteria' },
  { key: 'delegation_boundary', label: 'Would NOT delegate (why)' },
  { key: 'workshop_goal', label: 'Workshop goal' },
];

const SURVEY_COLS = [
  { key: 'satisfaction', label: 'Satisfaction (1–5)' },
  { key: 'relevance', label: 'Relevance (1–5)' },
  { key: 'clarity', label: 'Clarity (1–5)' },
  { key: 'theory_practice', label: 'Theory/practice (1–5)' },
  { key: 'improved_skills', label: 'Improved skills (1–5)' },
  { key: 'can_apply', label: 'Can apply (1–5)' },
  { key: 'would_recommend', label: 'Would recommend' },
  { key: 'platform_rating', label: 'Platform (1–5)' },
  { key: 'platform_reliability', label: 'Reliability (1–5)' },
  { key: 'likely_to_use', label: 'Likely to use (1–5)' },
  { key: 'ai_was_chat_tool', label: 'Was: chat tool (1–5)' },
  { key: 'ai_repeatable_systems', label: 'Now: repeatable system (1–5)' },
  { key: 'aware_human_oversight', label: 'Aware: oversight (1–5)' },
  { key: 'aware_cost_tradeoffs', label: 'Aware: cost (1–5)' },
  { key: 'trust_when_inspectable', label: 'Trust if inspectable (1–5)' },
  { key: 'identify_ai_tasks', label: 'Can ID AI tasks (1–5)' },
  { key: 'identify_human_review', label: 'Can ID review needs (1–5)' },
  { key: 'concept_used_first', label: 'Concept used first' },
  { key: 'real_task_text', label: 'Real task to use Foundry' },
  { key: 'foundry_improvement_text', label: 'What would make it easier' },
  { key: 'most_valuable', label: 'Most valuable (legacy)' },
];

const STAGES = ['3', '4', '5', '6', '7', '8'];
const STAGE_NAME = { 3: 'Skills', 4: 'Knowledge', 5: 'Coworkers', 6: 'Workflow', 7: 'Audit', 8: 'Economics' };

// Reflection cell: clarity / agreement ratings + the transfer text + any
// structured (multi/single-select) answers, stacked compactly.
function ReflectionCell({ refl }) {
  if (!refl) return <span className="rf-muted">—</span>;
  const struct = refl.structured && typeof refl.structured === 'object' ? refl.structured : {};
  const structParts = Object.values(struct).map(v => fmt(v)).filter(s => s && s !== '—');
  return (
    <div className="rf-refl-cell">
      <div className="rf-refl-rate">
        clarity <b>{refl.confidence ?? '—'}</b> · agree <b>{refl.agreement ?? '—'}</b>
      </div>
      {refl.transfer_text && <div className="rf-refl-text">“{refl.transfer_text}”</div>}
      {structParts.length > 0 && <div className="rf-refl-struct">{structParts.join(' · ')}</div>}
    </div>
  );
}

export default function ResearchForms({ data }) {
  const [form, setForm] = useState('demographics');
  if (!data) return <div className="rf-empty">Pick a cohort to see its form responses.</div>;

  // Consent-filtered, sorted by name.
  const consented = (data.participants || [])
    .filter(p => (p.kind || 'human') === 'human')
    .filter(p => {
      const c = data.consentByPid?.[p.id];
      return c && c.granted === true && !c.withdrawn_at;
    })
    .sort((a, b) => (a.name || '').localeCompare(b.name || ''));

  if (!consented.size && !consented.length) {
    return <div className="rf-empty">No consented participants in this cohort.</div>;
  }

  // reflections grouped: pid -> stage -> row
  const reflByPid = {};
  for (const r of data.stageReflections || []) {
    (reflByPid[r.participant_id] ||= {})[String(r.stage)] = r;
  }

  const demoRows = consented.map(p => ({ name: p.name, row: data.demographicsByPid?.[p.id] || {} }));
  const surveyRows = consented.map(p => ({ name: p.name, row: data.feedbackByPid?.[p.id] || {} }));
  const reflRows = consented.map(p => ({ name: p.name, refl: reflByPid[p.id] || {} }));

  const hasDemo = demoRows.some(r => Object.keys(r.row).length);
  const hasSurvey = surveyRows.some(r => Object.keys(r.row).length);
  const hasRefl = reflRows.some(r => Object.keys(r.refl).length);

  return (
    <div className="rf-wrap">
      <div className="rf-tabs">
        <button className={form === 'demographics' ? 'is-active' : ''} onClick={() => setForm('demographics')}>Demographics</button>
        <button className={form === 'reflections' ? 'is-active' : ''} onClick={() => setForm('reflections')}>Reflections</button>
        <button className={form === 'survey' ? 'is-active' : ''} onClick={() => setForm('survey')}>End survey</button>
        <span className="rf-count">{consented.length} consented participants</span>
      </div>

      {form === 'demographics' && (
        hasDemo
          ? <Table cols={DEMO_COLS} rows={demoRows} getName={r => r.name} />
          : <div className="rf-empty">This cohort predates the demographics form.</div>
      )}

      {form === 'survey' && (
        hasSurvey
          ? <Table cols={SURVEY_COLS} rows={surveyRows} getName={r => r.name} />
          : <div className="rf-empty">No end-of-workshop survey responses for this cohort.</div>
      )}

      {form === 'reflections' && (
        hasRefl
          ? (
            <div className="rf-scroll">
              <table className="rf-table">
                <thead>
                  <tr>
                    <th className="rf-sticky">Participant</th>
                    {STAGES.map(s => <th key={s}>S{s} · {STAGE_NAME[s]}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {reflRows.map((r, i) => (
                    <tr key={i}>
                      <td className="rf-sticky rf-name">{r.name}</td>
                      {STAGES.map(s => <td key={s}><ReflectionCell refl={r.refl[s]} /></td>)}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
          : <div className="rf-empty">No stage reflections for this cohort.</div>
      )}
    </div>
  );
}
