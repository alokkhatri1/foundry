// Download research data as a multi-sheet Excel workbook that mirrors the bench
// Data tabs exactly — same columns/headers (Demographics, Survey via the shared
// column defs), reflections as a participant×stage matrix, usage as the
// stage-activity arc, and chats grouped by participant→stage. No LLM.
// Works for one cohort (pass opts.cohortName) or all cohorts (data.roomNameByPid).
import * as XLSX from 'xlsx';
import { isIncluded } from './researchBundle';
import { fmt } from './researchLabels';
import { DEMO_COLS, SURVEY_COLS, REFLECTION_STAGES, STAGE_NAME } from './researchColumns';
import { engagementSummary, buildStageWindows, activeStageAt, stageActivity, STAGE_LABELS } from './researchUsage';
import { pseudonym, makeRedactor } from './researchAnonymize';

const consentStatus = (c) => (c && c.granted === true && !c.withdrawn_at) ? 'consented'
  : (c && (c.granted === false || c.withdrawn_at)) ? 'declined' : 'no response';

export function downloadConsentedData(data, usageByPid = {}, traces = null, opts = {}) {
  const cohortOf = (pid) => data.roomNameByPid?.[pid] || opts.cohortName || '—';
  const redact = makeRedactor((data.participants || []).map(p => p.name).filter(Boolean));
  const idCols = (p) => ({ Cohort: cohortOf(p.id), Participant: pseudonym(p.id), Consent: consentStatus(data.consentByPid?.[p.id]) });
  const includedPid = (pid) => isIncluded(data.consentByPid?.[pid]);

  const included = (data.participants || [])
    .filter(p => (p.kind || 'human') === 'human' && includedPid(p.id))
    .sort((a, b) => cohortOf(a.id).localeCompare(cohortOf(b.id)) || (a.name || '').localeCompare(b.name || ''));

  const reflByPid = {};
  for (const r of data.stageReflections || []) (reflByPid[r.participant_id] ||= {})[String(r.stage)] = r;

  // Demographics + Survey — same columns/headers as the bench tables.
  const colRows = (cols, lookup) => included.map(p => {
    const row = { ...idCols(p) };
    const src = lookup(p) || {};
    for (const c of cols) row[c.label] = redact(fmt(src[c.key]));
    return row;
  });
  const demoRows = colRows(DEMO_COLS, p => data.demographicsByPid?.[p.id]);
  const surveyRows = colRows(SURVEY_COLS, p => data.feedbackByPid?.[p.id]);

  // Reflections — participant × stage matrix (mirrors the bench Reflections tab).
  const reflCell = (r) => {
    if (!r) return '';
    const parts = [`clarity ${r.confidence ?? '—'} · agree ${r.agreement ?? '—'}`];
    if (r.transfer_text) parts.push(`“${redact(r.transfer_text)}”`);
    const st = r.structured && typeof r.structured === 'object'
      ? Object.entries(r.structured).map(([k, v]) => `${k}: ${fmt(v)}`).join(', ') : '';
    if (st) parts.push(st);
    return parts.join(' | ');
  };
  const reflRows = included.map(p => {
    const row = { ...idCols(p) };
    const byStage = reflByPid[p.id] || {};
    for (const s of REFLECTION_STAGES) row[`Stage ${s} · ${STAGE_NAME[s]}`] = reflCell(byStage[s]);
    return row;
  });

  // Usage — stage-activity arc (mirrors the Usage arc tab) when the stage
  // timeline + raw usage are available (per-cohort); otherwise an aggregate.
  let usageRows;
  if (data.stageEvents && data.llmUsage) {
    const wins = buildStageWindows(data.stageEvents);
    const { byPid, byStage } = stageActivity(data.llmUsage, wins, new Set(included.map(p => p.id)));
    const stages = Object.keys(byStage).filter(s => byStage[s].calls > 0).sort((a, b) => Number(a) - Number(b));
    usageRows = included.map(p => {
      const row = { ...idCols(p) };
      for (const s of stages) {
        const a = byPid[p.id]?.[s];
        row[`Stage ${s} · ${STAGE_LABELS[s] || ''}`] = a ? `${a.tokens} tok / ${a.calls} calls` : '';
      }
      return row;
    });
  } else {
    usageRows = included.map(p => {
      const u = usageByPid[p.id]; const s = engagementSummary(u) || {};
      const segs = u?.by_segment ? Object.entries(u.by_segment).map(([k, v]) => `${k}=${v}`).join('; ') : '';
      return {
        ...idCols(p),
        'Total tokens': u?.total_tokens ?? 0, 'Cost (USD)': u ? Number(u.total_cost || 0).toFixed(4) : 0,
        'Calls': u?.n_calls ?? 0, 'Engagement style': s.style || '', 'Capabilities used': s.breadth ?? 0,
        'Segment breakdown (tokens)': segs,
      };
    });
  }

  // Chats — one row per turn, with a Stage column; ordered participant→stage→conversation→turn.
  const chatRows = traces ? buildChatRows(traces, data, includedPid, cohortOf, redact) : [];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(demoRows), 'Demographics');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(reflRows), 'Reflections');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(surveyRows), 'Survey');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(usageRows), 'Usage');
  if (chatRows.length) XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(chatRows), 'Chats');

  const d = new Date();
  const stamp = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const slug = opts.cohortName ? '-' + opts.cohortName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') : '';
  XLSX.writeFile(wb, `foundry-consented-data${slug}-${stamp}.xlsx`);
  return included.length;
}

function buildChatRows(traces, data, includedPid, cohortOf, redact = (t) => t) {
  const byId = {}; const byRoomName = {};
  for (const p of data.participants || []) {
    byId[p.id] = p;
    byRoomName[`${p.room_id || ''}|${(p.name || '').toLowerCase()}`] = p;
  }
  // stage windows per room (events carry room_id)
  const evByRoom = {};
  for (const e of data.stageEvents || []) (evByRoom[e.room_id || '_'] ||= []).push(e);
  const winsByRoom = {};
  for (const [rid, evs] of Object.entries(evByRoom)) winsByRoom[rid] = buildStageWindows(evs);
  const stageOf = (rid, ts) => {
    const wins = winsByRoom[rid] || winsByRoom['_'];
    return wins && ts ? activeStageAt(new Date(ts).getTime(), wins) : '1';
  };
  const stageLabel = (s) => `Stage ${s} · ${STAGE_LABELS[s] || ''}`;
  const rows = [];

  // main chats
  const conv = new Map();
  for (const m of traces.messages || []) {
    if (!m.conversation_id || (m.type !== 'user' && m.type !== 'assistant')) continue;
    const key = `${m.room_id}|${m.conversation_id}`;
    if (!conv.has(key)) conv.set(key, []);
    conv.get(key).push(m);
  }
  for (const msgs of conv.values()) {
    const ut = msgs.find(x => x.type === 'user' && x.participant_name);
    if (!ut) continue;
    const owner = byRoomName[`${msgs[0].room_id || ''}|${ut.participant_name.toLowerCase()}`]
      || byRoomName[`|${ut.participant_name.toLowerCase()}`];
    if (!owner || !includedPid(owner.id)) continue;
    msgs.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
    const stage = stageOf(msgs[0].room_id, msgs[0].created_at);
    const pseu = pseudonym(owner.id);
    msgs.forEach((m, i) => rows.push({
      Cohort: cohortOf(owner.id), Participant: pseu, Stage: stageLabel(stage), Channel: 'Chat',
      Conversation: m.conversation_id, Turn: i + 1,
      Role: m.type === 'user' ? pseu : (m.label || 'AI'),
      Content: redact(m.content || ''), Timestamp: m.created_at, _s: Number(stage),
    }));
  }
  // coworker DMs
  const threads = new Map();
  for (const dm of traces.directMessages || []) {
    const from = byId[dm.from_participant_id]; const to = byId[dm.to_participant_id];
    const human = from && (from.kind || 'human') === 'human' ? from : to && (to.kind || 'human') === 'human' ? to : null;
    if (!human || !includedPid(human.id)) continue;
    const other = human === from ? to : from;
    const key = `${human.id}|${other?.id || '?'}`;
    if (!threads.has(key)) threads.set(key, { human, other, msgs: [] });
    threads.get(key).msgs.push(dm);
  }
  for (const t of threads.values()) {
    t.msgs.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
    const stage = stageOf(t.msgs[0].room_id, t.msgs[0].created_at);
    const pseu = pseudonym(t.human.id);
    const otherName = t.other && (t.other.kind || 'human') === 'human' ? pseudonym(t.other.id) : (t.other?.name || 'AI coworker');
    t.msgs.forEach((dm, i) => rows.push({
      Cohort: cohortOf(t.human.id), Participant: pseu, Stage: stageLabel(stage),
      Channel: `Coworker DM · ${otherName}`,
      Conversation: `DM · ${otherName}`, Turn: i + 1,
      Role: dm.from_participant_id === t.human.id ? pseu : otherName,
      Content: redact(dm.content || ''), Timestamp: dm.created_at, _s: Number(stage),
    }));
  }

  rows.sort((a, b) => a.Cohort.localeCompare(b.Cohort) || a.Participant.localeCompare(b.Participant)
    || a._s - b._s || String(a.Conversation).localeCompare(String(b.Conversation)) || a.Turn - b.Turn);
  rows.forEach(r => delete r._s);
  return rows;
}
