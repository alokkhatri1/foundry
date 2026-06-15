// Download all consented data as a multi-sheet Excel workbook (Demographics /
// Reflections / Survey / Usage). No LLM — pure client-side export of the data
// the researcher is allowed to use (included = everyone except explicit
// declines/withdrawals). Reuses the bundled `xlsx` dependency.
import * as XLSX from 'xlsx';
import { isIncluded } from './researchBundle';
import { lbl, fmt } from './researchLabels';
import { engagementSummary, STAGE_LABELS } from './researchUsage';

const consentStatus = (c) => (c && c.granted === true && !c.withdrawn_at) ? 'consented'
  : (c && (c.granted === false || c.withdrawn_at)) ? 'declined' : 'no response';

function idCols(p, data) {
  return {
    Cohort: data.roomNameByPid?.[p.id] || '—',
    Participant: p.name || '—',
    Consent: consentStatus(data.consentByPid?.[p.id]),
  };
}

export function downloadConsentedData(data, usageByPid = {}) {
  const included = (data.participants || [])
    .filter(p => (p.kind || 'human') === 'human' && isIncluded(data.consentByPid?.[p.id]))
    .sort((a, b) => (data.roomNameByPid?.[a.id] || '').localeCompare(data.roomNameByPid?.[b.id] || '')
      || (a.name || '').localeCompare(b.name || ''));

  const reflByPid = {};
  for (const r of data.stageReflections || []) (reflByPid[r.participant_id] ||= {})[String(r.stage)] = r;

  // --- Demographics sheet ---
  const demoRows = included.map(p => {
    const d = data.demographicsByPid?.[p.id] || {};
    return {
      ...idCols(p, data),
      Role: d.role || '',
      Tenure: lbl(d.tenure_band),
      Industry: lbl(d.industry),
      'Work type': fmt(d.work_type),
      'AI familiarity (1-5)': d.ai_familiarity ?? '',
      'AI use frequency': lbl(d.ai_use_frequency),
      'AI tools used': fmt(d.ai_tools),
      'AI use cases': fmt(d.ai_use_cases),
      'Mental model of AI': lbl(d.ai_mental_model),
      'Eval confidence (1-5)': d.evaluation_confidence ?? '',
      'Delegation comfort (1-5)': d.delegation_comfort ?? '',
      'Top adoption criteria': fmt(d.adoption_criteria_top3),
      'Would not delegate (why)': d.delegation_boundary || '',
    };
  });

  // --- Survey sheet ---
  const surveyRows = included.map(p => {
    const f = data.feedbackByPid?.[p.id] || {};
    return {
      ...idCols(p, data),
      Satisfaction: f.satisfaction ?? '', Relevance: f.relevance ?? '', Clarity: f.clarity ?? '',
      'Theory/practice balance': f.theory_practice ?? '', 'Improved skills': f.improved_skills ?? '',
      'Can identify AI tasks': f.identify_ai_tasks ?? '', 'Can identify review needs': f.identify_human_review ?? '',
      'Likely to use': f.likely_to_use ?? '', 'Would recommend': f.would_recommend == null ? '' : (f.would_recommend ? 'Yes' : 'No'),
      'Platform: easy to navigate': f.platform_rating ?? '', 'Platform: reliable': f.platform_reliability ?? '',
      'Platform: aided understanding': f.platform_support ?? '',
      'Before: AI was chat tool': f.ai_was_chat_tool ?? '', 'After: AI repeatable system': f.ai_repeatable_systems ?? '',
      'Aware: human oversight': f.aware_human_oversight ?? '', 'Aware: cost tradeoffs': f.aware_cost_tradeoffs ?? '',
      'Trust if inspectable': f.trust_when_inspectable ?? '',
      'Concept used first': lbl(f.concept_used_first),
      'Real task for Foundry': f.real_task_text || '',
      'What would make it easier': f.foundry_improvement_text || '',
      'Most valuable (legacy)': f.most_valuable || '',
    };
  });

  // --- Reflections sheet (long: one row per participant-stage) ---
  const reflRows = [];
  for (const p of included) {
    const byStage = reflByPid[p.id] || {};
    for (const s of Object.keys(byStage).sort((a, b) => Number(a) - Number(b))) {
      const r = byStage[s];
      const struct = r.structured && typeof r.structured === 'object'
        ? Object.entries(r.structured).map(([k, v]) => `${k}: ${fmt(v)}`).join(' · ') : '';
      reflRows.push({
        ...idCols(p, data),
        Stage: s, 'Stage name': STAGE_LABELS[s] || '',
        'Clarity (1-5)': r.confidence ?? '', 'Agreement (1-5)': r.agreement ?? '',
        'Transfer text': r.transfer_text || '', 'Structured answers': struct,
      });
    }
  }

  // --- Usage sheet (derived behavioral signal) ---
  const usageRows = included.map(p => {
    const u = usageByPid[p.id];
    const s = engagementSummary(u) || {};
    const segs = u?.by_segment ? Object.entries(u.by_segment).map(([k, v]) => `${k}=${v}`).join('; ') : '';
    return {
      ...idCols(p, data),
      'Total tokens': u?.total_tokens ?? 0,
      'Cost (USD)': u ? Number(u.total_cost || 0).toFixed(4) : 0,
      'Calls': u?.n_calls ?? 0,
      'Engagement style': s.style || '',
      'Capabilities used': s.breadth ?? 0,
      'Segment breakdown (tokens)': segs,
    };
  });

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(demoRows), 'Demographics');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(reflRows), 'Reflections');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(surveyRows), 'Survey');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(usageRows), 'Usage');

  const d = new Date();
  const stamp = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  XLSX.writeFile(wb, `foundry-consented-data-${stamp}.xlsx`);
  return included.length;
}
