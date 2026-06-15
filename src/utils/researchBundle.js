import { pseudonym } from './researchAnonymize';

// Build a Markdown research bundle from the loadAdminResearchData payload.
// One Markdown document per workshop, one H1 section per human participant,
// with all 9 stages laid out in their own subsections. Optimised for
// readability: scan the doc by eye, paste excerpts into a notebook, or
// upload the whole thing to Claude for synthesis.
//
// v1 includes every participant regardless of consent (test bed). The
// "Consent" line in each section tells the truth so downstream synthesis
// can decide what's eligible.
//
// Long content (full file bodies, full step outputs) is included verbatim
// — research wants fidelity over compactness. Code-fenced with ~~~ to
// avoid colliding with any ``` the participant may have typed.

function pathLookup(files) {
  const byId = Object.fromEntries(files.map(f => [f.id, f]));
  const cache = new Map();
  function pathFor(id) {
    if (cache.has(id)) return cache.get(id);
    const f = byId[id];
    if (!f) { cache.set(id, []); return []; }
    const p = f.parent_id ? [...pathFor(f.parent_id), f.name] : [f.name];
    cache.set(id, p);
    return p;
  }
  return pathFor;
}

function chatsForName(messages, name) {
  const byConv = new Map();
  for (const m of messages) {
    if (!m.conversation_id) continue;
    if (!byConv.has(m.conversation_id)) byConv.set(m.conversation_id, []);
    byConv.get(m.conversation_id).push(m);
  }
  const out = [];
  for (const [cid, msgs] of byConv.entries()) {
    if (!msgs.some(m => m.type === 'user' && m.participant_name === name)) continue;
    out.push({
      id: cid,
      messages: msgs.filter(m => m.type === 'user' || m.type === 'assistant')
        .sort((a, b) => new Date(a.created_at) - new Date(b.created_at)),
    });
  }
  out.sort((a, b) => new Date(a.messages[0]?.created_at || 0) - new Date(b.messages[0]?.created_at || 0));
  return out;
}

function dmsForPid(dms, participants, pid) {
  const byPid = Object.fromEntries(participants.map(p => [p.id, p]));
  const threads = new Map();
  for (const dm of dms) {
    if (dm.from_participant_id !== pid && dm.to_participant_id !== pid) continue;
    const otherPid = dm.from_participant_id === pid ? dm.to_participant_id : dm.from_participant_id;
    if (!threads.has(otherPid)) threads.set(otherPid, []);
    threads.get(otherPid).push(dm);
  }
  return [...threads.entries()].map(([otherPid, msgs]) => ({
    other: byPid[otherPid] || { id: otherPid, name: 'unknown', kind: 'human' },
    messages: msgs.sort((a, b) => new Date(a.created_at) - new Date(b.created_at)),
  }));
}

function tokensFor(usage, pid) {
  let tokens = 0, cost = 0;
  const bySegment = {};
  for (const r of usage) {
    if (r.participant_id !== pid) continue;
    const tk = (r.input_tokens || 0) + (r.output_tokens || 0)
      + (r.cache_creation_input_tokens || 0) + (r.cache_read_input_tokens || 0);
    tokens += tk;
    cost += Number(r.cost_usd) || 0;
    const seg = r.segment || 'other';
    if (!bySegment[seg]) bySegment[seg] = { tokens: 0, cost: 0 };
    bySegment[seg].tokens += tk;
    bySegment[seg].cost += Number(r.cost_usd) || 0;
  }
  return { tokens, cost, bySegment };
}

function fmtTime(ts) {
  if (!ts) return '';
  const d = typeof ts === 'string' ? new Date(ts) : ts;
  return d.toISOString().slice(0, 16).replace('T', ' ');
}

function fmtDate(ts) {
  if (!ts) return '';
  return new Date(ts).toISOString().slice(0, 10);
}

// Code-fence content with ~~~ so we don't collide with ``` the participant
// may have typed (e.g. in their skill files). Markdown renderers handle
// either fence; ~~~ is just safer for arbitrary user content.
function code(content, lang = '') {
  return `~~~${lang}\n${(content || '').replace(/\r/g, '')}\n~~~`;
}

function section(heading, body) {
  if (!body || body.trim() === '') return `${heading}\n\n_(no activity)_`;
  return `${heading}\n\n${body}`;
}

function renderChats(chats) {
  if (!chats.length) return '';
  return chats.map((c, i) => {
    const t0 = fmtTime(c.messages[0]?.created_at);
    const turns = c.messages.map(m => {
      const who = m.type === 'user' ? (m.participant_name || 'user') : (m.label || 'assistant');
      return `**${who}** _(${fmtTime(m.created_at)})_\n\n${m.content || ''}`;
    }).join('\n\n');
    return `### Conversation ${i + 1} — ${t0}\n\n${turns}`;
  }).join('\n\n---\n\n');
}

function renderPrefs(prefs) {
  if (!prefs?.content) return '';
  return `_Updated ${fmtTime(prefs.updated_at)}_\n\n${code(prefs.content)}`;
}

function renderFiles(files) {
  if (!files.length) return '';
  return files.map(f => {
    const t = fmtTime(f.updated_at || f.created_at);
    return `### ${f.name}\n_(${t})_\n\n${code(f.content || '')}`;
  }).join('\n\n');
}

function renderCoworkers(coworkers, files) {
  if (!coworkers.length) return '';
  const fileById = Object.fromEntries(files.map(f => [f.id, f]));
  return coworkers.map(cw => {
    const skills = (cw.instruction_file_ids || []).map(id => fileById[id]?.name).filter(Boolean);
    const knows = (cw.knowledge_file_ids || []).map(id => fileById[id]?.name).filter(Boolean);
    const lines = [
      `### ${cw.name}`,
      cw.role ? `- **Role**: ${cw.role}` : null,
      `- **Built**: ${fmtTime(cw.created_at)}`,
      skills.length ? `- **Skill files**: ${skills.join(', ')}` : null,
      knows.length ? `- **Knowledge files**: ${knows.join(', ')}` : null,
    ].filter(Boolean);
    return lines.join('\n');
  }).join('\n\n');
}

function renderDms(threads, selfPid) {
  if (!threads.length) return '';
  return threads.map(t => {
    const turns = t.messages.map(m => {
      const who = m.from_participant_id === selfPid ? '**self**' : `**${t.other.name}${t.other.kind === 'ai' ? ' (AI)' : ''}**`;
      return `${who} _(${fmtTime(m.created_at)})_\n\n${m.content || ''}`;
    }).join('\n\n');
    return `### DM thread — with ${t.other.name}${t.other.kind === 'ai' ? ' (AI)' : ''}\n\n${turns}`;
  }).join('\n\n---\n\n');
}

function renderWorkflows(workflows) {
  if (!workflows.length) return '';
  return workflows.map(w => {
    const steps = (w.steps || w.nodes || []).length;
    return `### ${w.name}\n_(${steps} nodes · ${fmtTime(w.created_at)})_\n\n${code(JSON.stringify({ nodes: w.nodes, edges: w.edges, steps: w.steps }, null, 2), 'json')}`;
  }).join('\n\n');
}

function renderRuns(runs) {
  if (!runs.length) return '';
  return runs.map(r => {
    const head = `### Run — ${r.workflow_name} _(${r.status} · started ${fmtTime(r.started_at)})_`;
    const steps = (r.step_results || []).map((s, i) => {
      const name = s.name || s.type || `step ${i + 1}`;
      const status = s.status || '';
      let body = '';
      if (s.output) {
        const out = typeof s.output === 'string' ? s.output : JSON.stringify(s.output, null, 2);
        body = '\n\n' + code(out);
      }
      return `**${i + 1}. ${name}** — _${status}_${body}`;
    }).join('\n\n');
    return `${head}\n\n${steps}`;
  }).join('\n\n---\n\n');
}

function renderApprovals(approvals) {
  if (!approvals.length) return '';
  const rows = approvals.map(a =>
    `| ${fmtTime(a.resolved_at)} | ${a.step_name || a.step_id || ''} | ${a.action || ''} | ${(a.comment || '').replace(/\|/g, '\\|').replace(/\n/g, ' ')} |`
  ).join('\n');
  return `| When | Step | Action | Comment |\n| --- | --- | --- | --- |\n${rows}`;
}

function renderTokens(totals) {
  if (!totals || !totals.tokens) return '';
  const segs = Object.entries(totals.bySegment).sort((a, b) => b[1].tokens - a[1].tokens);
  const segRows = segs.map(([seg, val]) => `| ${seg} | ${val.tokens.toLocaleString()} | $${val.cost.toFixed(4)} |`).join('\n');
  return [
    `**Total**: ${totals.tokens.toLocaleString()} tokens · $${totals.cost.toFixed(4)}`,
    '',
    '| Segment | Tokens | Cost |',
    '| --- | --- | --- |',
    segRows,
  ].join('\n');
}

function renderReflections(reflections) {
  if (!reflections.length) return '';
  const sorted = [...reflections].sort((a, b) => String(a.stage).localeCompare(String(b.stage)));
  return sorted.map(r => {
    const structuredBlock = renderStructured(r.stage, r.structured);
    const lines = [
      `### Stage ${r.stage}`,
      // `confidence` carries the new clarity rating (kept on the legacy
      // column so the takeaway PDF doesn't need a rename).
      r.confidence != null   ? `- **Clarity**: ${r.confidence} / 5`         : null,
      r.agreement  != null   ? `- **Agreement**: ${r.agreement} / 5`         : null,
      r.transfer_text        ? `- **Transfer to work**: ${r.transfer_text}` : null,
      structuredBlock        ? `- **Structured answers**:\n${structuredBlock}` : null,
      // Legacy fields — surface only when populated (pre-instrument rows).
      r.note  ? `- **Note (legacy)**: ${r.note}`   : null,
      r.habit ? `- **Habit (legacy)**: ${r.habit}` : null,
    ].filter(Boolean);
    return lines.join('\n');
  }).join('\n\n');
}

function consentLine(consent) {
  if (!consent) return '_pending — not yet asked or not yet submitted_';
  if (consent.withdrawn_at) return `_withdrawn ${fmtTime(consent.withdrawn_at)} (was ${consent.granted ? 'granted' : 'declined'} · text v${consent.consent_text_version})_`;
  const verb = consent.granted ? 'granted' : 'declined';
  return `${verb} · text v${consent.consent_text_version} · ${fmtTime(consent.granted_at)}`;
}

// Pretty-print enum codes as the labels participants saw. Codes that
// aren't recognised pass through verbatim (forward-compat).
const LABELS = {
  tenure_band: {
    lt_1y: 'Less than 1 year', '1_3y': '1–3 years', '3_7y': '3–7 years',
    '7_15y': '7–15 years', gt_15y: '15+ years',
  },
  industry: {
    tech: 'Technology', finance: 'Finance', healthcare: 'Healthcare',
    education: 'Education', consulting: 'Consulting',
    public_sector: 'Public sector', marketing: 'Media / Marketing',
    other: 'Other',
  },
  age_band: {
    '18_24': '18–24', '25_34': '25–34', '35_44': '35–44',
    '45_54': '45–54', '55_plus': '55+',
  },
  work_type: {
    strategy: 'Strategy / planning', operations: 'Operations',
    analysis: 'Analysis / reporting', research: 'Research',
    writing: 'Writing / communication', customer: 'Customer or client work',
    product_eng: 'Product / engineering', management: 'Management',
    other: 'Other',
  },
  ai_use_frequency: {
    never: 'Never', occasional: 'Occasionally', weekly: 'Weekly',
    daily: 'Daily', multi_daily: 'Multiple times a day',
  },
  ai_tools: {
    chatgpt: 'ChatGPT', claude: 'Claude', gemini: 'Gemini',
    copilot: 'Copilot', perplexity: 'Perplexity',
    image_gen: 'Image-generation tools', internal: 'Internal company AI tool',
    midjourney: 'Midjourney / image tools',
    other: 'Other', none: 'None yet',
  },
  ai_use_cases: {
    drafting: 'Drafting text', summarizing: 'Summarizing documents',
    brainstorm: 'Brainstorming', research: 'Research',
    data: 'Data analysis', coding: 'Coding',
    decision: 'Decision support', automation: 'Automating repeated work',
    not_yet: 'I do not use AI yet', other: 'Other',
  },
  ai_mental_model: {
    search: 'A search engine', writing: 'A writing assistant',
    productivity: 'A productivity tool', coworker: 'A coworker',
    expert: 'An expert advisor', automation: 'An automation system',
    risky: 'A risky tool that needs close supervision', unsure: 'I am not sure yet',
  },
  adoption_criteria_top3: {
    accuracy: 'Accuracy', speed: 'Speed', privacy: 'Privacy',
    ease: 'Ease of use', control: 'Control', explainability: 'Explainability',
    cost: 'Cost', quality: 'Quality of final output',
    reviewability: 'Ability to review or edit before use',
  },
  // Reflection structured option codes — one map per stage/question.
  s3_barriers: {
    wrong_application: 'It might apply the instruction incorrectly',
    forget_contents: 'I might forget what the skill contains',
    too_rigid: 'It might make the AI too rigid',
    manual_control: 'I would rather control each prompt manually',
    no_repeated_tasks: 'I do not have repeated tasks where this is useful',
    privacy: 'Privacy or company policy concerns',
    other: 'Other',
  },
  s4_barriers: {
    confidentiality: 'Confidentiality', unclear_policy: 'Unclear data policy',
    misinterpretation: 'Fear of wrong interpretation',
    too_much_effort: 'Too much effort',
    unsure_which: 'I do not know which documents are useful',
    do_not_trust: 'I do not trust the AI with files', other: 'Other',
  },
  s5_feeling: {
    saved_prompt: 'A saved prompt', specialized_assistant: 'A specialized assistant',
    junior_teammate: 'A junior teammate', sme: 'A subject-matter expert',
    workflow_component: 'A workflow component', chatbot_label: 'A chatbot with a label',
    unsure: 'I am not sure',
  },
  s6_review_point: {
    before_start: 'Before the AI starts', after_each_step: 'After each AI step',
    before_final: 'Only before the final output',
    when_uncertain: 'Only when the AI is uncertain',
    high_risk: 'Only for high-risk tasks',
    not_always: 'Human review is not always needed', other: 'Other',
  },
  s7_confidence_shift: {
    much_less: 'Much less confident', slightly_less: 'Slightly less confident',
    no_change: 'No change', slightly_more: 'Slightly more confident',
    much_more: 'Much more confident',
  },
  s7_check_first: {
    prompt: 'The original prompt', skill: 'The skill/instruction file',
    knowledge: 'The knowledge file', coworker_role: 'The coworker role',
    workflow_step: 'The workflow step where the issue appeared',
    review_point: 'The human review or approval point',
    final_output: 'The final output only', unsure: 'I am not sure',
  },
  s8_behavior_change: {
    use_less: 'I would use AI less', use_selectively: 'I would use AI more selectively',
    simpler_flows: 'I would choose simpler workflows when possible',
    quality_over: 'I would still prioritize quality over cost',
    do_not_grok: 'I do not understand the cost well enough yet',
    no_change: 'It would not change my behavior', other: 'Other',
  },
  // Workshop feedback — Q51 concept-first single-select
  concept_used_first: {
    skill: 'Skill file', knowledge: 'Knowledge file', coworker: 'AI coworker',
    workflow: 'Workflow', audit: 'Audit log', cost: 'Cost view',
    none_yet: 'None yet', other: 'Other',
  },
};

function lbl(field, code) {
  if (code === undefined || code === null || code === '') return '_unset_';
  return LABELS[field]?.[code] || code;
}

function listLbl(field, codes) {
  if (!Array.isArray(codes) || codes.length === 0) return '_none picked_';
  return codes.map(c => lbl(field, c)).join(', ');
}

function renderDemographics(d) {
  if (!d) return '_no demographics on file_';
  return [
    `- **Role**: ${(d.role || '').trim() || '_unset_'}`,
    `- **Tenure**: ${lbl('tenure_band', d.tenure_band)}`,
    `- **Industry**: ${lbl('industry', d.industry)}`,
    `- **Work type**: ${listLbl('work_type', d.work_type)}`,
    `- **AI familiarity**: ${d.ai_familiarity ?? '—'} / 5`,
    `- **AI use frequency**: ${lbl('ai_use_frequency', d.ai_use_frequency)}`,
    `- **AI tools used**: ${listLbl('ai_tools', d.ai_tools)}`,
    `- **AI use cases**: ${listLbl('ai_use_cases', d.ai_use_cases)}`,
    `- **Mental model of AI**: ${lbl('ai_mental_model', d.ai_mental_model)}`,
    `- **Evaluation confidence**: ${d.evaluation_confidence ?? '—'} / 5 (1 disagree → 5 agree)`,
    `- **Delegation comfort (with review)**: ${d.delegation_comfort ?? '—'} / 5`,
    `- **Top 3 adoption criteria**: ${
      Array.isArray(d.adoption_criteria_top3) && d.adoption_criteria_top3.length > 0
        ? d.adoption_criteria_top3.map((c, i) => `${i + 1}. ${lbl('adoption_criteria_top3', c)}`).join(' · ')
        : '_unset_'
    }`,
    `- **What they would not delegate**: ${(d.delegation_boundary || '').trim() || '_unset_'}`,
    // Legacy fields — surface only when present, so old rows with the
    // pre-instrument shape still read cleanly.
    d.age_band      ? `- **Age (legacy field)**: ${lbl('age_band', d.age_band)}`        : null,
    d.workshop_goal ? `- **Workshop goal (legacy field)**: ${d.workshop_goal.trim()}`   : null,
    `- **Submitted**: ${fmtTime(d.created_at)} · text v${d.questions_text_version || 1}`,
  ].filter(Boolean).join('\n');
}

// Stage → which label map keys to use for the structured jsonb keys.
const STAGE_STRUCTURED_KEYS = {
  '3': { barriers: 's3_barriers' },
  '4': { barriers: 's4_barriers' },
  '5': { feeling: 's5_feeling' },
  '6': { review_point: 's6_review_point' },
  '7': { confidence_shift: 's7_confidence_shift', check_first: 's7_check_first' },
  '8': { behavior_change: 's8_behavior_change' },
};
function renderStructured(stage, structured) {
  if (!structured || typeof structured !== 'object') return null;
  const map = STAGE_STRUCTURED_KEYS[String(stage)] || {};
  const lines = [];
  for (const [key, val] of Object.entries(structured)) {
    const field = map[key];
    if (!field) {
      // Unknown key — render verbatim so research can see novel data.
      lines.push(`  - ${key}: ${Array.isArray(val) ? val.join(', ') : val}`);
      continue;
    }
    if (Array.isArray(val)) lines.push(`  - ${key}: ${listLbl(field, val)}`);
    else                    lines.push(`  - ${key}: ${lbl(field, val)}`);
  }
  return lines.length > 0 ? lines.join('\n') : null;
}

function renderParticipant(p, data, pathFor) {
  const consent = data.consentByPid[p.id];
  const demographics = (data.demographicsByPid || {})[p.id];
  const myFiles = data.files.filter(f => f.created_by === p.name && f.type === 'file');
  const knowledge = myFiles.filter(f => pathFor(f.id).some(s => s === 'knowledge'));
  const skills    = myFiles.filter(f => pathFor(f.id).some(s => s === 'skills'));
  const myCw      = data.coworkers.filter(c => c.created_by === p.name);
  const myDms     = dmsForPid(data.directMessages, data.participants, p.id);
  const myWf      = data.workflows.filter(w => w.created_by === p.name);
  const myRuns    = data.workflowRuns.filter(r => r.started_by === p.name);
  const myApps    = data.approvals.filter(a => a.resolved_by === p.name);
  const tokens    = tokensFor(data.llmUsage, p.id);
  const myRefl    = data.stageReflections.filter(r => r.participant_id === p.id);
  const chats     = chatsForName(data.messages, p.name);

  const lines = [
    `# ${p.name}`,
    '',
    p.email ? `- **Email**: ${p.email}` : null,
    `- **Joined**: ${fmtTime(p.joined_at)}`,
    `- **Consent**: ${consentLine(consent)}`,
    '',
    section('## Demographics',                    renderDemographics(demographics)),
    '',
    section('## Stage 1 — Chat',                  renderChats(chats)),
    '',
    section('## Stage 2 — Preferences',           renderPrefs(data.prefsByPid[p.id])),
    '',
    section('## Stage 3 — Skill files',           renderFiles(skills)),
    '',
    section('## Stage 4 — Knowledge files',       renderFiles(knowledge)),
    '',
    section('## Stage 5a — Coworkers built',      renderCoworkers(myCw, data.files)),
    '',
    section('## Stage 5b — DM threads',           renderDms(myDms, p.id)),
    '',
    section('## Stage 6a — Workflows authored',   renderWorkflows(myWf)),
    '',
    section('## Stage 6b — Runs initiated',       renderRuns(myRuns)),
    '',
    section('## Stage 7 — Approval decisions',    renderApprovals(myApps)),
    '',
    section('## Stage 8 — Token spend',           renderTokens(tokens)),
    '',
    section('## Stage 9 — Reflections',           renderReflections(myRefl)),
  ].filter(l => l !== null);

  return lines.join('\n');
}

// One participant's section as a standalone Markdown doc — used both by
// the cohort export (concatenated under a workshop-level header) and by
// the per-participant download button on the detail header.
export function buildParticipantMarkdown(participant, data, { workshopCode, orgName } = {}) {
  const pathFor = pathLookup(data.files);
  const header = [
    `# ${participant.name}`,
    '',
    `- **Workshop**: ${orgName || 'workshop'}${workshopCode ? ` (${workshopCode})` : ''}`,
    `- **Generated**: ${fmtTime(new Date())}`,
    '',
    '---',
    '',
  ].join('\n');
  // renderParticipant emits its own H1 for the cohort export; for the
  // per-participant doc we want the H1 above (with the workshop context),
  // so strip the leading H1 line off renderParticipant's output.
  const body = renderParticipant(participant, data, pathFor).replace(/^#[^\n]*\n/, '');
  return header + body + '\n';
}

// Inclusion rule for the Research Bench: include everyone EXCEPT those who
// explicitly declined or withdrew consent. A missing consent row (joined
// before the consent step, or never reached it) counts as "not declined" and
// is included — it is NOT the same as an explicit grant, which is why the UI
// labels the count "included" and breaks it down (consented vs no-response).
export function isIncluded(consentRow) {
  return !consentRow || (consentRow.granted !== false && !consentRow.withdrawn_at);
}

// "Complete record" = a participant worth analysing: included (not declined),
// has demographics (key fields filled), submitted the end survey, AND has a
// reflection for every stage their cohort actually reached. Partial responders
// are excluded — they add noise, not signal. Threshold is lenient: cohort depth
// is read from the data (max reflected stage in that room), so a cohort that
// ended at Stage 6 only needs reflections 3–6, not a fixed 3–8.
export function completeRecordPids(data) {
  const parts = (data.participants || []).filter(p => (p.kind || 'human') === 'human');
  // participants from loadAdminResearchData have no room_id (single cohort);
  // from loadAllFormResponses they do. Bucket by room so cohort depth is per-room.
  const roomByPid = {};
  for (const p of parts) roomByPid[p.id] = p.room_id || '_single';
  const maxStageByRoom = {};
  const stagesByPid = {};
  for (const r of data.stageReflections || []) {
    const s = Number(r.stage);
    if (!(s >= 3 && s <= 8)) continue;
    (stagesByPid[r.participant_id] ||= new Set()).add(s);
    const room = roomByPid[r.participant_id];
    if (room != null) maxStageByRoom[room] = Math.max(maxStageByRoom[room] || 0, s);
  }
  const out = new Set();
  for (const p of parts) {
    if (!isIncluded(data.consentByPid?.[p.id])) continue;
    const demo = data.demographicsByPid?.[p.id];
    if (!demo || !demo.role || demo.ai_familiarity == null || !demo.ai_mental_model) continue;
    const fb = data.feedbackByPid?.[p.id];
    if (!fb || fb.satisfaction == null) continue;
    const maxStage = maxStageByRoom[roomByPid[p.id]] || 0;
    if (maxStage < 3) continue; // cohort never reflected → no full record possible
    const have = stagesByPid[p.id] || new Set();
    let ok = true;
    for (let s = 3; s <= maxStage; s++) if (!have.has(s)) { ok = false; break; }
    if (ok) out.add(p.id);
  }
  return out;
}

// Per-cohort consent tally over human participants.
export function consentBreakdown(participants, consentByPid) {
  let consented = 0, pending = 0, declined = 0;
  for (const p of participants || []) {
    if ((p.kind || 'human') !== 'human') continue;
    const c = consentByPid?.[p.id];
    if (c && (c.granted === false || c.withdrawn_at)) declined++;
    else if (c && c.granted === true) consented++;
    else pending++;
  }
  return { consented, pending, declined, included: consented + pending, total: consented + pending + declined };
}

// includedOnly: when true, drop only participants who explicitly declined or
// withdrew (see isIncluded). The admin export leaves it false (test-bed — every
// participant, the per-section consent line tells the truth). The Research
// Bench passes true so declined data never enters tables or synthesis.
export function buildResearchMarkdown(data, { workshopCode, orgName, consentedOnly = false }) {
  const pathFor = pathLookup(data.files);
  const allHumans = data.participants
    .filter(p => (p.kind || 'human') === 'human')
    .sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  // The bench (consentedOnly) restricts to complete records — partial
  // responders add noise to synthesis. The admin export keeps everyone.
  const completeSet = consentedOnly ? completeRecordPids(data) : null;
  const humans = consentedOnly ? allHumans.filter(p => completeSet.has(p.id)) : allHumans;
  const b = consentBreakdown(allHumans, data.consentByPid);
  const header = [
    `# Foundry research bundle — ${orgName || 'workshop'}`,
    '',
    `- **Workshop code**: ${workshopCode || '—'}`,
    `- **Generated**: ${fmtTime(new Date())}`,
    `- **Participants**: ${humans.length}`,
    '',
    consentedOnly
      ? `_Complete records only — ${humans.length} of ${b.included} included participants have a full record (demographics + survey + all reflected stages). Partial responders and ${b.declined} who declined are excluded._`
      : '_v1 test bed — every participant included regardless of consent. The Consent line on each section tells the truth; downstream synthesis can filter._',
    '',
    '---',
    '',
  ].join('\n');
  const body = humans.map(p => renderParticipant(p, data, pathFor)).join('\n\n---\n\n');
  const doc = header + body + '\n';
  // Bench path is anonymized: replace every participant's name with their stable
  // pseudonym across the whole document — headers, chat/DM labels, and any name
  // typed into content — so synthesis never sees real names.
  return consentedOnly ? anonymizeDoc(doc, data.participants) : doc;
}

// Replace each participant full name with their pseudonym, word-boundary,
// longest-first (so full names win over shared first names).
function anonymizeDoc(doc, participants) {
  const pairs = (participants || [])
    .filter(p => p.name && p.name.trim().length >= 3)
    .map(p => ({ name: p.name.trim(), pseu: pseudonym(p.id) }))
    .sort((a, b) => b.name.length - a.name.length);
  let out = doc;
  for (const { name, pseu } of pairs) {
    const re = new RegExp('\\b' + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'gi');
    out = out.replace(re, pseu);
  }
  return out;
}

function nameSlug(name) {
  return (name || 'participant')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'participant';
}

function triggerDownload(text, filename) {
  const blob = new Blob([text], { type: 'text/markdown' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function downloadResearchBundle(data, meta) {
  const text = buildResearchMarkdown(data, meta);
  triggerDownload(text, `foundry-research-${meta.workshopCode || 'workshop'}-${fmtDate(new Date())}.md`);
}

export function downloadParticipantNotes(participant, data, meta) {
  const text = buildParticipantMarkdown(participant, data, meta);
  const slug = nameSlug(participant.name);
  triggerDownload(text, `foundry-research-${meta.workshopCode || 'workshop'}-${slug}-${fmtDate(new Date())}.md`);
}
