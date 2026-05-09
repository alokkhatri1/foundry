import { useMemo, useState } from 'react';

// Research view — shows the workshop archive at full granularity for
// post-workshop analysis. Two pivots over the same underlying data:
//
//   By participant: pick a person, expand their 9-stage timeline, read
//                   what they actually wrote (chats, preferences, skill
//                   files, DMs with coworkers, run outputs, approvals,
//                   reflections) plus token spend.
//   By stage:       pick a stage, see every participant's artifacts side
//                   by side. The cohort lens.
//
// v1 surfaces all data regardless of consent (test bed). The per-row
// consent badge tells the truth — once we wire the Researcher coworker
// in v1.5, only granted rows will be fed into synthesis or export.

const STAGE_META = [
  { id: '1', label: 'Chat',                    short: 'S1' },
  { id: '2', label: 'Preferences',             short: 'S2' },
  { id: '3', label: 'Files as context',        short: 'S3' },
  { id: '4', label: 'Files as skills',         short: 'S4' },
  { id: '5', label: 'Coworkers',               short: 'S5' },
  { id: '6', label: 'Orchestration',           short: 'S6' },
  { id: '7', label: 'Observability',           short: 'S7' },
  { id: '8', label: 'Economics',               short: 'S8' },
  { id: '9', label: 'Reflections',             short: 'S9' },
];

const CONSENT_BADGE = {
  granted:  { label: 'Consented', className: 'rv-badge is-granted' },
  declined: { label: 'Declined',  className: 'rv-badge is-declined' },
  pending:  { label: 'Pending',   className: 'rv-badge is-pending' },
};

function consentStateFor(pid, consentByPid) {
  const c = consentByPid?.[pid];
  if (!c) return 'pending';
  if (c.withdrawn_at) return 'declined';
  return c.granted ? 'granted' : 'declined';
}

function fmtTime(ts) {
  if (!ts) return '';
  const d = typeof ts === 'string' ? new Date(ts) : ts;
  return d.toLocaleString();
}

function fmtTokens(n) {
  return (n || 0).toLocaleString();
}

function fmtUsd(n) {
  if (!n) return '$0.00';
  return `$${n.toFixed(2)}`;
}

// Build a parent-name lookup so file paths can be reconstructed from a flat
// list. Used to classify which files were under knowledge/ vs skills/.
function buildPathLookup(files) {
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

// Group raw chat messages by conversation_id, attach turn order, and
// filter to conversations a given participant participated in.
function chatsForParticipant(messages, participantName) {
  const byConv = new Map();
  for (const m of messages) {
    if (!m.conversation_id) continue;
    if (!byConv.has(m.conversation_id)) byConv.set(m.conversation_id, []);
    byConv.get(m.conversation_id).push(m);
  }
  const out = [];
  for (const [cid, msgs] of byConv.entries()) {
    const hasUserTurn = msgs.some(m => m.type === 'user' && m.participant_name === participantName);
    if (!hasUserTurn) continue;
    out.push({ id: cid, messages: msgs.filter(m => m.type === 'user' || m.type === 'assistant') });
  }
  // Newest conversation first.
  out.sort((a, b) => {
    const aT = new Date(a.messages.at(-1)?.created_at || 0).getTime();
    const bT = new Date(b.messages.at(-1)?.created_at || 0).getTime();
    return bT - aT;
  });
  return out;
}

// Pair every DM in the workshop into a per-(human, ai) thread keyed by the
// AI coworker's mirror participant id. Returns threads where the given
// participant was on either side of the conversation.
function dmThreadsForParticipant(dms, participants, participantId) {
  const byPid = Object.fromEntries(participants.map(p => [p.id, p]));
  const threads = new Map();
  for (const dm of dms) {
    if (dm.from_participant_id !== participantId && dm.to_participant_id !== participantId) continue;
    const otherPid = dm.from_participant_id === participantId ? dm.to_participant_id : dm.from_participant_id;
    if (!threads.has(otherPid)) threads.set(otherPid, []);
    threads.get(otherPid).push(dm);
  }
  return [...threads.entries()].map(([otherPid, msgs]) => ({
    other: byPid[otherPid] || { id: otherPid, name: 'unknown', kind: 'human' },
    messages: msgs.sort((a, b) => new Date(a.created_at) - new Date(b.created_at)),
  }));
}

function tokensByParticipant(usage) {
  const out = {};
  for (const r of usage) {
    if (!r.participant_id) continue;
    const tk = (r.input_tokens || 0) + (r.output_tokens || 0)
      + (r.cache_creation_input_tokens || 0) + (r.cache_read_input_tokens || 0);
    if (!out[r.participant_id]) out[r.participant_id] = { tokens: 0, cost: 0, bySegment: {} };
    out[r.participant_id].tokens += tk;
    out[r.participant_id].cost += Number(r.cost_usd) || 0;
    const seg = r.segment || 'other';
    if (!out[r.participant_id].bySegment[seg]) out[r.participant_id].bySegment[seg] = { tokens: 0, cost: 0 };
    out[r.participant_id].bySegment[seg].tokens += tk;
    out[r.participant_id].bySegment[seg].cost += Number(r.cost_usd) || 0;
  }
  return out;
}

// ---- Stage panels ----

function ChatPanel({ chats }) {
  if (!chats.length) return <div className="rv-empty">No chats.</div>;
  return (
    <div className="rv-chats">
      {chats.map(c => (
        <details key={c.id} className="rv-conv">
          <summary>
            <span>{c.messages.length} messages</span>
            <span className="rv-conv-time">{fmtTime(c.messages.at(-1)?.created_at)}</span>
          </summary>
          <div className="rv-conv-body">
            {c.messages.map(m => (
              <div key={m.id} className={`rv-turn rv-turn-${m.type}`}>
                <div className="rv-turn-meta">
                  <span className="rv-turn-who">{m.type === 'user' ? (m.participant_name || 'user') : (m.label || 'assistant')}</span>
                  <span className="rv-turn-time">{fmtTime(m.created_at)}</span>
                </div>
                <div className="rv-turn-body">{m.content}</div>
              </div>
            ))}
          </div>
        </details>
      ))}
    </div>
  );
}

function PreferencesPanel({ prefs }) {
  if (!prefs?.content) return <div className="rv-empty">No preferences written.</div>;
  return (
    <div className="rv-pref">
      <div className="rv-pref-meta">Updated {fmtTime(prefs.updated_at)}</div>
      <pre className="rv-pref-body">{prefs.content}</pre>
    </div>
  );
}

function FilesPanel({ files, kind }) {
  if (!files.length) return <div className="rv-empty">No {kind} files.</div>;
  return (
    <div className="rv-files">
      {files.map(f => (
        <details key={f.id} className="rv-file">
          <summary>
            <span className="rv-file-name">{f.name}</span>
            <span className="rv-file-meta">{(f.content || '').length} chars · {fmtTime(f.updated_at || f.created_at)}</span>
          </summary>
          <pre className="rv-file-body">{f.content || ''}</pre>
        </details>
      ))}
    </div>
  );
}

function CoworkerPanel({ coworkers, dmThreads, files }) {
  const fileById = useMemo(() => Object.fromEntries(files.map(f => [f.id, f])), [files]);
  if (!coworkers.length && !dmThreads.length) return <div className="rv-empty">No coworkers built or DMed.</div>;
  return (
    <div className="rv-coworkers">
      {coworkers.map(cw => {
        const skillFiles = (cw.instruction_file_ids || []).map(id => fileById[id]).filter(Boolean);
        const knowledgeFiles = (cw.knowledge_file_ids || []).map(id => fileById[id]).filter(Boolean);
        return (
          <details key={cw.id} className="rv-coworker">
            <summary>
              <span className="rv-coworker-name">{cw.name}</span>
              <span className="rv-coworker-role">{cw.role || ''}</span>
            </summary>
            <div className="rv-coworker-body">
              {cw.role && <div><span className="rv-label">Role</span><div>{cw.role}</div></div>}
              {skillFiles.length > 0 && (
                <div><span className="rv-label">Skill files</span><ul>{skillFiles.map(f => <li key={f.id}>{f.name}</li>)}</ul></div>
              )}
              {knowledgeFiles.length > 0 && (
                <div><span className="rv-label">Knowledge files</span><ul>{knowledgeFiles.map(f => <li key={f.id}>{f.name}</li>)}</ul></div>
              )}
            </div>
          </details>
        );
      })}
      {dmThreads.length > 0 && (
        <div className="rv-dms">
          <div className="rv-dms-head">DM threads</div>
          {dmThreads.map(t => (
            <details key={t.other.id} className="rv-dm">
              <summary>
                <span>with {t.other.name}{t.other.kind === 'ai' ? ' (AI)' : ''}</span>
                <span className="rv-conv-time">{t.messages.length} messages</span>
              </summary>
              <div className="rv-dm-body">
                {t.messages.map(m => (
                  <div key={m.id} className={`rv-turn ${m.from_participant_id === t.other.id ? 'rv-turn-assistant' : 'rv-turn-user'}`}>
                    <div className="rv-turn-meta">
                      <span className="rv-turn-time">{fmtTime(m.created_at)}</span>
                    </div>
                    <div className="rv-turn-body">{m.content}</div>
                  </div>
                ))}
              </div>
            </details>
          ))}
        </div>
      )}
    </div>
  );
}

function OrchestrationPanel({ workflows, runs }) {
  if (!workflows.length && !runs.length) return <div className="rv-empty">No workflows built or run.</div>;
  return (
    <div className="rv-orch">
      {workflows.length > 0 && (
        <div>
          <div className="rv-label">Workflows authored</div>
          {workflows.map(w => (
            <details key={w.id} className="rv-wf">
              <summary>
                <span>{w.name}</span>
                <span className="rv-conv-time">{(w.steps || w.nodes || []).length} nodes · {fmtTime(w.created_at)}</span>
              </summary>
              <pre className="rv-wf-body">{JSON.stringify({ nodes: w.nodes, edges: w.edges, steps: w.steps }, null, 2)}</pre>
            </details>
          ))}
        </div>
      )}
      {runs.length > 0 && (
        <div>
          <div className="rv-label">Runs initiated</div>
          {runs.map(r => (
            <details key={r.id} className="rv-run">
              <summary>
                <span>{r.workflow_name}</span>
                <span className="rv-conv-time">{r.status} · {fmtTime(r.started_at)}</span>
              </summary>
              <div className="rv-run-body">
                {(r.step_results || []).map((s, i) => (
                  <div key={i} className="rv-step">
                    <div className="rv-step-head">
                      <span>{i + 1}. {s.name || s.type || 'step'}</span>
                      <span className="rv-conv-time">{s.status}</span>
                    </div>
                    {s.output && <pre className="rv-step-out">{typeof s.output === 'string' ? s.output : JSON.stringify(s.output, null, 2)}</pre>}
                  </div>
                ))}
              </div>
            </details>
          ))}
        </div>
      )}
    </div>
  );
}

function ApprovalsPanel({ approvals }) {
  if (!approvals.length) return <div className="rv-empty">No approval decisions.</div>;
  return (
    <table className="rv-table">
      <thead><tr><th>When</th><th>Step</th><th>Action</th><th>Comment</th></tr></thead>
      <tbody>
        {approvals.map(a => (
          <tr key={a.id}>
            <td>{fmtTime(a.resolved_at)}</td>
            <td>{a.step_name || a.step_id || ''}</td>
            <td><span className={`rv-action is-${a.action}`}>{a.action}</span></td>
            <td>{a.comment || ''}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function EconomicsPanel({ totals }) {
  if (!totals) return <div className="rv-empty">No token spend recorded.</div>;
  const segs = Object.entries(totals.bySegment).sort((a, b) => b[1].tokens - a[1].tokens);
  return (
    <div className="rv-econ">
      <div className="rv-econ-totals">
        <div><span className="rv-label">Total tokens</span><strong>{fmtTokens(totals.tokens)}</strong></div>
        <div><span className="rv-label">Total cost</span><strong>{fmtUsd(totals.cost)}</strong></div>
      </div>
      <table className="rv-table">
        <thead><tr><th>Segment</th><th>Tokens</th><th>Cost</th></tr></thead>
        <tbody>
          {segs.map(([seg, val]) => (
            <tr key={seg}>
              <td>{seg}</td>
              <td>{fmtTokens(val.tokens)}</td>
              <td>{fmtUsd(val.cost)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ReflectionsPanel({ reflections, consent }) {
  if (!reflections.length && !consent) return <div className="rv-empty">No reflections written.</div>;
  return (
    <div className="rv-refl">
      {consent && (
        <div className="rv-consent-row">
          <span className="rv-label">Research consent</span>
          <span>{consent.granted ? 'Granted' : 'Declined'} · {fmtTime(consent.granted_at)} · text v{consent.consent_text_version}</span>
        </div>
      )}
      {reflections.map(r => (
        <div key={`${r.participant_id}-${r.stage}`} className="rv-refl-row">
          <div className="rv-refl-head"><strong>Stage {r.stage}</strong> · confidence {r.confidence ?? '—'}</div>
          {r.note && <div><span className="rv-label">Note</span><div>{r.note}</div></div>}
          {r.habit && <div><span className="rv-label">Habit</span><div>{r.habit}</div></div>}
        </div>
      ))}
    </div>
  );
}

// Render the right stage panel for a given participant. The data prop is
// the loader's return value; we slice it to this participant here so the
// individual panels stay simple.
function StagePanel({ stageId, participant, data, derived }) {
  const { messages, files, coworkers, workflows, workflowRuns, approvals, stageReflections, prefsByPid, consentByPid, directMessages, participants } = data;
  const pid = participant.id;
  const name = participant.name;
  const pathFor = derived.pathFor;
  const tokenTotals = derived.tokenTotals;

  switch (stageId) {
    case '1': return <ChatPanel chats={chatsForParticipant(messages, name)} />;
    case '2': return <PreferencesPanel prefs={prefsByPid[pid]} />;
    case '3': {
      const own = files.filter(f => f.created_by === name && f.type === 'file');
      const knowledge = own.filter(f => pathFor(f.id).some(seg => seg === 'knowledge'));
      return <FilesPanel files={knowledge} kind="knowledge" />;
    }
    case '4': {
      const own = files.filter(f => f.created_by === name && f.type === 'file');
      const skills = own.filter(f => pathFor(f.id).some(seg => seg === 'skills'));
      return <FilesPanel files={skills} kind="skills" />;
    }
    case '5': {
      const ownCw = coworkers.filter(c => c.created_by === name);
      const dms = dmThreadsForParticipant(directMessages, participants, pid);
      return <CoworkerPanel coworkers={ownCw} dmThreads={dms} files={files} />;
    }
    case '6': {
      const ownWf = workflows.filter(w => w.created_by === name);
      const ownRuns = workflowRuns.filter(r => r.started_by === name);
      return <OrchestrationPanel workflows={ownWf} runs={ownRuns} />;
    }
    case '7': {
      const mine = approvals.filter(a => a.resolved_by === name);
      return <ApprovalsPanel approvals={mine} />;
    }
    case '8': return <EconomicsPanel totals={tokenTotals[pid]} />;
    case '9': {
      const mine = stageReflections.filter(r => r.participant_id === pid);
      return <ReflectionsPanel reflections={mine} consent={consentByPid[pid]} />;
    }
    default: return null;
  }
}

// ---- By-participant view ----

function ByParticipantView({ data, derived, selectedPid, onSelectPid, expandedStage, onToggleStage, onDownloadParticipant }) {
  const humans = useMemo(
    () => data.participants.filter(p => (p.kind || 'human') === 'human').sort((a, b) => a.name.localeCompare(b.name)),
    [data.participants],
  );
  const sel = humans.find(p => p.id === selectedPid) || humans[0];

  return (
    <div className="rv-split">
      <aside className="rv-list">
        {humans.map(p => {
          const state = consentStateFor(p.id, data.consentByPid);
          const badge = CONSENT_BADGE[state];
          return (
            <button
              key={p.id}
              type="button"
              className={`rv-list-row${sel?.id === p.id ? ' is-active' : ''}`}
              onClick={() => onSelectPid(p.id)}
            >
              <span className="rv-list-name">{p.name}</span>
              <span className={badge.className}>{badge.label}</span>
            </button>
          );
        })}
      </aside>
      <section className="rv-detail">
        {!sel ? <div className="rv-empty">Pick a participant.</div> : (
          <>
            <header className="rv-detail-head">
              <div>
                <h3>{sel.name}</h3>
                {sel.email && <div className="rv-detail-email">{sel.email}</div>}
              </div>
              {onDownloadParticipant && (
                <button
                  type="button"
                  className="rv-export"
                  onClick={() => onDownloadParticipant(sel)}
                  title="Download this participant's notes as Markdown"
                >Download notes (.md)</button>
              )}
            </header>
            <div className="rv-stages">
              {STAGE_META.map(s => {
                const open = expandedStage === s.id;
                return (
                  <div key={s.id} className={`rv-stage${open ? ' is-open' : ''}`}>
                    <button type="button" className="rv-stage-head" onClick={() => onToggleStage(open ? null : s.id)}>
                      <span className="rv-stage-num">{s.short}</span>
                      <span className="rv-stage-label">{s.label}</span>
                      <span className="rv-stage-chev" aria-hidden>{open ? '▾' : '▸'}</span>
                    </button>
                    {open && (
                      <div className="rv-stage-body">
                        <StagePanel stageId={s.id} participant={sel} data={data} derived={derived} />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </>
        )}
      </section>
    </div>
  );
}

// ---- By-stage view ----

function ByStageView({ data, derived, selectedStage, onSelectStage }) {
  const humans = useMemo(
    () => data.participants.filter(p => (p.kind || 'human') === 'human').sort((a, b) => a.name.localeCompare(b.name)),
    [data.participants],
  );
  return (
    <div className="rv-bystage">
      <div className="rv-stage-pills">
        {STAGE_META.map(s => (
          <button
            key={s.id}
            type="button"
            className={`rv-pill${selectedStage === s.id ? ' is-active' : ''}`}
            onClick={() => onSelectStage(s.id)}
          >
            {s.short} · {s.label}
          </button>
        ))}
      </div>
      <div className="rv-bystage-grid">
        {humans.map(p => (
          <article key={p.id} className="rv-bystage-card">
            <header className="rv-bystage-card-head">
              <strong>{p.name}</strong>
              <span className={CONSENT_BADGE[consentStateFor(p.id, data.consentByPid)].className}>
                {CONSENT_BADGE[consentStateFor(p.id, data.consentByPid)].label}
              </span>
            </header>
            <StagePanel stageId={selectedStage} participant={p} data={data} derived={derived} />
          </article>
        ))}
      </div>
    </div>
  );
}

// ---- Top-level ----

export default function ResearchView({ data, loading, onDownloadBundle, onDownloadParticipant }) {
  const [axis, setAxis] = useState('participant');
  const [selectedPid, setSelectedPid] = useState(null);
  const [expandedStage, setExpandedStage] = useState('1');
  const [selectedStage, setSelectedStage] = useState('1');

  const derived = useMemo(() => {
    if (!data) return null;
    return {
      pathFor: buildPathLookup(data.files),
      tokenTotals: tokensByParticipant(data.llmUsage),
    };
  }, [data]);

  if (loading || !data || !derived) {
    return <div className="rv-loading">Loading research data…</div>;
  }

  return (
    <div className="rv">
      <div className="rv-toolbar">
        <div className="rv-axis">
          <button type="button" className={`rv-axis-btn${axis === 'participant' ? ' is-active' : ''}`} onClick={() => setAxis('participant')}>By participant</button>
          <button type="button" className={`rv-axis-btn${axis === 'stage' ? ' is-active' : ''}`} onClick={() => setAxis('stage')}>By stage</button>
        </div>
        <button type="button" className="rv-export" onClick={onDownloadBundle}>Download all (.md)</button>
      </div>

      {axis === 'participant'
        ? <ByParticipantView data={data} derived={derived} selectedPid={selectedPid} onSelectPid={setSelectedPid} expandedStage={expandedStage} onToggleStage={setExpandedStage} onDownloadParticipant={onDownloadParticipant} />
        : <ByStageView data={data} derived={derived} selectedStage={selectedStage} onSelectStage={setSelectedStage} />
      }
    </div>
  );
}
