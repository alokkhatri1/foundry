// Build a JSONL research bundle from the loadAdminResearchData payload.
// One JSON object per line, one record per human participant, with their
// stage-by-stage artifacts nested inside. Designed to be slurped into a
// notebook or piped through an external LLM pass.
//
// v1 includes everyone (test bed); each record carries its consent state
// so downstream pipelines can filter to consented rows when this becomes
// real research.

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
      conversation_id: cid,
      messages: msgs
        .filter(m => m.type === 'user' || m.type === 'assistant')
        .map(m => ({ role: m.type, who: m.participant_name || m.label, text: m.content, at: m.created_at })),
    });
  }
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
    other: byPid[otherPid] ? { id: otherPid, name: byPid[otherPid].name, kind: byPid[otherPid].kind } : { id: otherPid, name: 'unknown' },
    messages: msgs
      .sort((a, b) => new Date(a.created_at) - new Date(b.created_at))
      .map(m => ({ from: m.from_participant_id === pid ? 'self' : 'other', text: m.content, at: m.created_at })),
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

export function buildResearchBundle(data, { workshopId, workshopCode, orgName }) {
  const pathFor = pathLookup(data.files);
  const lines = [];
  for (const p of data.participants) {
    if ((p.kind || 'human') !== 'human') continue;
    const consent = data.consentByPid[p.id];
    const myFiles = data.files.filter(f => f.created_by === p.name && f.type === 'file');
    const knowledge = myFiles
      .filter(f => pathFor(f.id).some(s => s === 'knowledge'))
      .map(f => ({ name: f.name, content: f.content || '', updated_at: f.updated_at, created_at: f.created_at }));
    const skills = myFiles
      .filter(f => pathFor(f.id).some(s => s === 'skills'))
      .map(f => ({ name: f.name, content: f.content || '', updated_at: f.updated_at, created_at: f.created_at }));

    const record = {
      participant: { id: p.id, name: p.name, email: p.email, joined_at: p.joined_at },
      workshop: { id: workshopId, code: workshopCode, org_name: orgName },
      consent: consent
        ? { granted: !!consent.granted, scope: consent.scope, text_version: consent.consent_text_version, granted_at: consent.granted_at, withdrawn_at: consent.withdrawn_at }
        : { granted: null, status: 'pending' },
      stages: {
        '1_chat':         chatsForName(data.messages, p.name),
        '2_preferences':  data.prefsByPid[p.id] ? { content: data.prefsByPid[p.id].content, updated_at: data.prefsByPid[p.id].updated_at } : null,
        '3_knowledge':    knowledge,
        '4_skills':       skills,
        '5_coworkers':    data.coworkers.filter(c => c.created_by === p.name),
        '5_dms':          dmsForPid(data.directMessages, data.participants, p.id),
        '6_workflows':    data.workflows.filter(w => w.created_by === p.name),
        '6_runs':         data.workflowRuns.filter(r => r.started_by === p.name),
        '7_approvals':    data.approvals.filter(a => a.resolved_by === p.name),
        '8_tokens':       tokensFor(data.llmUsage, p.id),
        '9_reflections':  data.stageReflections.filter(r => r.participant_id === p.id),
      },
    };
    lines.push(JSON.stringify(record));
  }
  return lines.join('\n') + '\n';
}

export function downloadResearchBundle(data, meta) {
  const text = buildResearchBundle(data, meta);
  const blob = new Blob([text], { type: 'application/x-ndjson' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `foundry-research-${meta.workshopCode || 'workshop'}-${new Date().toISOString().slice(0, 10)}.jsonl`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
