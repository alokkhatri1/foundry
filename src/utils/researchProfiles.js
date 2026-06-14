// Turns a research dataset into compact, pseudonymous participant profiles for
// a skill Run, and assembles the Run prompt. Consent scope is "all-anonymized",
// so profiles are numbered (Participant N), never named. Only the data
// dimensions a skill declares are included, to keep the prompt tight.
import { completeRecordPids } from './researchBundle';

const STAGES = ['3', '4', '5', '6', '7', '8'];

const arr = (v) => Array.isArray(v) ? (v.length ? v.join(', ') : '—') : (v ?? '—');
const yn = (v) => v == null ? '—' : (v ? 'yes' : 'no');

function demoLine(d) {
  if (!d) return 'Demographics: (none)';
  return `Demographics: role="${d.role || '—'}"; tenure=${d.tenure_band || '—'}; industry=${d.industry || '—'}; `
    + `work_type=[${arr(d.work_type)}]; ai_familiarity=${d.ai_familiarity ?? '—'}/5; use_frequency=${d.ai_use_frequency || '—'}; `
    + `tools=[${arr(d.ai_tools)}]; use_cases=[${arr(d.ai_use_cases)}]; mental_model=${d.ai_mental_model || '—'}; `
    + `eval_confidence=${d.evaluation_confidence ?? '—'}/5; delegation_comfort=${d.delegation_comfort ?? '—'}/5; `
    + `top_adoption_criteria=[${arr(d.adoption_criteria_top3)}]; wont_delegate="${d.delegation_boundary || '—'}"`;
}

function surveyLine(f) {
  if (!f) return 'Survey: (none)';
  return `Survey: satisfaction=${f.satisfaction ?? '—'}/5; relevance=${f.relevance ?? '—'}; clarity=${f.clarity ?? '—'}; `
    + `theory_practice=${f.theory_practice ?? '—'}; improved_skills=${f.improved_skills ?? '—'}; likely_to_use=${f.likely_to_use ?? '—'}; `
    + `would_recommend=${yn(f.would_recommend)}; platform_rating=${f.platform_rating ?? '—'}; `
    + `before_AI_was_chat_tool=${f.ai_was_chat_tool ?? '—'}/5; after_AI_repeatable_system=${f.ai_repeatable_systems ?? '—'}/5; `
    + `aware_oversight=${f.aware_human_oversight ?? '—'}; aware_cost=${f.aware_cost_tradeoffs ?? '—'}; trust_if_inspectable=${f.trust_when_inspectable ?? '—'}; `
    + `identify_ai_tasks=${f.identify_ai_tasks ?? '—'}; identify_human_review=${f.identify_human_review ?? '—'}; `
    + `concept_used_first=${f.concept_used_first || '—'}; real_task="${f.real_task_text || '—'}"; improvement="${f.foundry_improvement_text || '—'}"`;
}

function reflLine(byStage) {
  const parts = [];
  for (const s of STAGES) {
    const r = byStage[s];
    if (!r) continue;
    const struct = r.structured && typeof r.structured === 'object'
      ? Object.entries(r.structured).map(([k, v]) => `${k}=${arr(v)}`).join(', ') : '';
    parts.push(`S${s}[clarity=${r.confidence ?? '—'},agree=${r.agreement ?? '—'}`
      + (r.transfer_text ? `,transfer="${r.transfer_text}"` : '')
      + (struct ? `,${struct}` : '') + ']');
  }
  return parts.length ? 'Reflections: ' + parts.join(' ') : 'Reflections: (none)';
}

function usageLine(u) {
  if (!u) return 'Behavior: (no usage recorded)';
  const segs = u.by_segment ? Object.entries(u.by_segment).map(([k, v]) => `${k}=${v}`).join(', ') : '';
  return `Behavior: total_tokens=${u.total_tokens ?? 0}; cost_usd=${Number(u.total_cost || 0).toFixed(3)}; calls=${u.n_calls ?? 0}; segments={${segs}}`;
}

// Build the profile text for complete records, including only `dims`.
// Returns { text, n }.
export function buildProfileText(data, dims, usageByPid = {}) {
  const want = new Set(dims && dims.length ? dims : ['demographics', 'survey', 'reflections', 'usage']);
  const completeSet = completeRecordPids(data);
  const humans = (data.participants || [])
    .filter(p => (p.kind || 'human') === 'human' && completeSet.has(p.id))
    .sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  const reflByPid = {};
  for (const r of data.stageReflections || []) (reflByPid[r.participant_id] ||= {})[String(r.stage)] = r;

  const blocks = humans.map((p, i) => {
    const cohort = data.roomNameByPid?.[p.id];
    const head = `## Participant ${i + 1}${cohort ? ` — cohort: ${cohort}` : ''}`;
    const lines = [head];
    if (want.has('demographics')) lines.push(demoLine(data.demographicsByPid?.[p.id]));
    if (want.has('survey')) lines.push(surveyLine(data.feedbackByPid?.[p.id]));
    if (want.has('reflections')) lines.push(reflLine(reflByPid[p.id] || {}));
    if (want.has('usage')) lines.push(usageLine(usageByPid[p.id]));
    return lines.join('\n');
  });
  return { text: blocks.join('\n\n'), n: humans.length };
}

// Assemble the {system, user} prompt for a skill Run. The skill is a document
// (skill.body); for older structured skills we fall back to composing from spec.
export function buildRunPrompt({ skill, theories, profileText, n, scopeLabel }) {
  let recipe = (skill.body || '').trim();
  if (!recipe) {
    const s = skill.spec || {};
    recipe = [
      s.question ? `Question: ${s.question}` : '',
      s.method ? `Method: ${s.method}` : '',
      s.output_format ? `Output format: ${s.output_format}` : '',
    ].filter(Boolean).join('\n\n') || '(no skill content)';
  }
  const lenses = (theories || []).length
    ? '\n\n## Theoretical lenses to apply\n' + theories.map(t => `### ${t.name}\n${t.body}`).join('\n\n')
    : '';
  const system =
    'You are a rigorous research analyst for the Foundry workshop platform. You analyse a set of '
    + 'consented, anonymised participant profiles and produce a grounded finding. Every claim must be '
    + 'supported by the data — cite counts and quote participants by their number (e.g. "Participant 12"). '
    + 'Do not invent data or generalise beyond what the profiles show. If the data is insufficient for '
    + 'part of the analysis, say so.' + lenses;
  const user = [
    `# Research skill: ${skill.name}`,
    `**Scope:** ${scopeLabel} · ${n} complete participant records.`,
    '',
    '## Skill instructions',
    recipe,
    '',
    '---',
    '',
    '# Participant profiles',
    profileText,
    '',
    '---',
    '',
    'Produce the finding now, following the skill instructions above.',
  ].join('\n');
  return { system, user };
}
