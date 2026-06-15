import { useState } from 'react';
import { REFLECTION_PROMPTS } from '../data/reflectionPrompts';
import { consentBreakdown, completeRecordPids } from '../utils/researchBundle';
import { buildStageWindows, stageActivity, STAGE_LABELS } from '../utils/researchUsage';
import { lbl, fmt } from '../utils/researchLabels';

const fmtTok = (n) => !n ? '—' : n < 1000 ? String(n) : `${(n / 1000).toFixed(n < 10000 ? 1 : 0)}k`;

// Scale legends (mirror StageReflection.jsx) so a rating shows its word too.
const CLARITY_LEGEND = { 1: 'Not clear at all', 2: 'Slightly clear', 3: 'Moderately clear', 4: 'Very clear', 5: 'Extremely clear' };
const AGREEMENT_LEGEND = { 1: 'Strongly disagree', 2: 'Disagree', 3: 'Neutral', 4: 'Agree', 5: 'Strongly agree' };

// Forms & responses view for the Research Bench. Shows the actual answers
// participants entered in the workshop's forms — Demographics, per-stage
// Reflections, and the End-of-workshop Survey — as spreadsheet-style tables
// (one row per participant, one column per question, full question text as the
// header). Consent-filtered. Works for a single cohort or, when the data
// carries roomNameByPid, the whole consented corpus (adds a Cohort column).

// Lifetime aggregate for a column across the displayed rows. `agg` is the
// column's declared type; returns a short summary string (or null for text /
// no data). Aggregates exactly the rows shown — so 'All cohorts' is all-time.
function aggregate(agg, key, rows) {
  const vals = rows.map(r => r.row?.[key]).filter(v => v != null && v !== '');
  if (!vals.length) return null;
  if (agg === 'mean') {
    const nums = vals.filter(v => typeof v === 'number');
    if (!nums.length) return null;
    const m = nums.reduce((a, b) => a + b, 0) / nums.length;
    return `avg ${m.toFixed(2)} · n=${nums.length}`;
  }
  if (agg === 'yesno') {
    const bools = vals.filter(v => typeof v === 'boolean');
    if (!bools.length) return null;
    const yes = bools.filter(Boolean).length;
    return `${Math.round((yes / bools.length) * 100)}% yes · n=${bools.length}`;
  }
  if (agg === 'cat' || agg === 'multi') {
    const counts = new Map();
    let denom = 0;
    for (const v of vals) {
      const items = agg === 'multi' ? (Array.isArray(v) ? v : [v]) : [v];
      if (agg === 'multi' && !items.length) continue;
      denom++;
      for (const it of items) counts.set(it, (counts.get(it) || 0) + 1);
    }
    if (!counts.size) return null;
    const [top, n] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
    return `${lbl(top)} · ${Math.round((n / denom) * 100)}%`;
  }
  return null;
}

// Full question text as column headers (verified against the form components).
const DEMO_COLS = [
  { key: 'role', label: 'What is your role or job title?' },
  { key: 'tenure_band', label: 'How long have you been in your current role?', agg: 'cat' },
  { key: 'industry', label: 'Which industry are you in?', agg: 'cat' },
  { key: 'work_type', label: 'Which best describes the type of work you do?', agg: 'multi' },
  { key: 'ai_familiarity', label: 'How familiar are you with AI tools today? (1–5)', agg: 'mean' },
  { key: 'ai_use_frequency', label: 'How often do you use AI tools right now?', agg: 'cat' },
  { key: 'ai_tools', label: 'Which AI tools have you used?', agg: 'multi' },
  { key: 'ai_use_cases', label: 'What do you usually use AI for?', agg: 'multi' },
  { key: 'ai_mental_model', label: 'Which statement best describes how you currently think about AI?', agg: 'cat' },
  { key: 'evaluation_confidence', label: 'I can usually tell when an AI answer is good enough to use. (1–5)', agg: 'mean' },
  { key: 'delegation_comfort', label: 'I feel comfortable delegating a work task to AI if I can review the output. (1–5)', agg: 'mean' },
  { key: 'adoption_criteria_top3', label: 'When deciding whether to use AI, what matters most? (top 3, ranked)', agg: 'multi' },
  { key: 'delegation_boundary', label: 'What kind of work would you not want AI to do for you? Why?' },
];

const SURVEY_COLS = [
  { key: 'satisfaction', label: 'Overall, I was satisfied with the workshop. (1–5)', agg: 'mean' },
  { key: 'relevance', label: 'The workshop content was relevant to my role or work. (1–5)', agg: 'mean' },
  { key: 'clarity', label: 'The workshop was clearly organized. (1–5)', agg: 'mean' },
  { key: 'theory_practice', label: 'The balance between explanation and hands-on practice was appropriate. (1–5)', agg: 'mean' },
  { key: 'improved_skills', label: 'The workshop improved my ability to use AI at work. (1–5)', agg: 'mean' },
  { key: 'identify_ai_tasks', label: 'I can identify tasks in my work that are suitable for AI. (1–5)', agg: 'mean' },
  { key: 'identify_human_review', label: 'I can identify tasks that should still require human review. (1–5)', agg: 'mean' },
  { key: 'likely_to_use', label: 'I am likely to use at least one Foundry concept in my real work. (1–5)', agg: 'mean' },
  { key: 'concept_used_first', label: 'Which Foundry concept are you most likely to use first?', agg: 'cat' },
  { key: 'real_task_text', label: 'What is one real task where you could imagine using Foundry?' },
  { key: 'foundry_improvement_text', label: 'What is one thing that would make Foundry easier to use?' },
  { key: 'platform_rating', label: 'The Foundry platform was easy to navigate. (1–5)', agg: 'mean' },
  { key: 'platform_reliability', label: 'The platform was reliable during the workshop. (1–5)', agg: 'mean' },
  { key: 'platform_support', label: 'The platform helped me understand AI workflows better than a lecture alone. (1–5)', agg: 'mean' },
  { key: 'ai_was_chat_tool', label: 'Before this workshop, I mostly thought of AI as a chat tool. (1–5)', agg: 'mean' },
  { key: 'ai_repeatable_systems', label: 'After this workshop, I see AI as something organized into repeatable work systems. (1–5)', agg: 'mean' },
  { key: 'aware_human_oversight', label: 'After this workshop, I feel more aware of where AI needs human oversight. (1–5)', agg: 'mean' },
  { key: 'aware_cost_tradeoffs', label: 'After this workshop, I feel more aware that AI use involves cost/resource tradeoffs. (1–5)', agg: 'mean' },
  { key: 'trust_when_inspectable', label: 'I would trust AI more when I can inspect its instructions, knowledge, and workflow steps. (1–5)', agg: 'mean' },
  { key: 'would_recommend', label: 'Would you recommend this workshop to a colleague?', agg: 'yesno' },
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
            {cols.map(c => {
              const a = c.agg ? aggregate(c.agg, c.key, rows) : null;
              return (
                <th key={c.key}>
                  {c.label}
                  {a && <div className="rf-agg">{a}</div>}
                </th>
              );
            })}
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

// Behavioral arc: per participant, activity (tokens · calls) in each stage
// window, so you see how engagement shifts as levels are revealed. Header pill
// per stage = cohort total + how many were active. Per-cohort only (stage
// reveal times are cohort-specific).
function UsageTable({ data, consented, showCohort }) {
  if (!data.stageEvents || !data.llmUsage) {
    return <div className="rf-empty">Select a single cohort to see the stage-by-stage behavioral arc (it’s anchored to that cohort’s reveal timeline).</div>;
  }
  const pidSet = new Set(consented.map(p => p.id));
  const wins = buildStageWindows(data.stageEvents);
  const { byPid, byStage } = stageActivity(data.llmUsage, wins, pidSet);
  // stages to show: those with any activity, in order.
  const stages = Object.keys(byStage).filter(s => byStage[s].calls > 0)
    .sort((a, b) => Number(a) - Number(b));
  if (!stages.length) return <div className="rf-empty">No usage recorded for this cohort.</div>;

  return (
    <div className="rf-scroll">
      <table className="rf-table">
        <thead>
          <tr>
            <th className="rf-sticky rf-sticky-1">Participant</th>
            {showCohort && <th className="rf-sticky rf-sticky-2">Cohort</th>}
            {stages.map(s => (
              <th key={s}>
                Stage {s} · {STAGE_LABELS[s] || ''}
                <div className="rf-agg">{fmtTok(byStage[s].tokens)} tok · {byStage[s].ppl.size} active</div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {consented.map((p, i) => (
            <tr key={i}>
              <td className="rf-sticky rf-sticky-1 rf-name">{p.name}</td>
              {showCohort && <td className="rf-sticky rf-sticky-2 rf-cohort">{data.roomNameByPid?.[p.id]}</td>}
              {stages.map(s => {
                const a = byPid[p.id]?.[s];
                return <td key={s}>{a ? <span className="rf-use">{fmtTok(a.tokens)}<span className="rf-use-calls"> · {a.calls} calls</span></span> : <span className="rf-muted">—</span>}</td>;
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// Readable chat transcripts: conversations + coworker DMs owned by a complete
// record, grouped and expandable. Per-cohort (the messages are loaded with the
// cohort); all-cohorts shows a note (the full traces are in the download).
function ChatsView({ data, consented }) {
  const [open, setOpen] = useState(null);
  if (!data.messages && !data.directMessages) {
    return <div className="rf-empty">Select a single cohort to read its chat transcripts. (The full traces across all cohorts are in the Download.)</div>;
  }
  const idset = new Set(consented.map(p => p.id));
  const byId = {}; const byName = {};
  for (const p of data.participants || []) { byId[p.id] = p; byName[(p.name || '').toLowerCase()] = p; }
  const byTime = (a, b) => new Date(a.created_at) - new Date(b.created_at);

  const threads = [];
  // main chats grouped by conversation, attributed to the user-turn participant
  const conv = new Map();
  for (const m of data.messages || []) {
    if (!m.conversation_id || (m.type !== 'user' && m.type !== 'assistant')) continue;
    if (!conv.has(m.conversation_id)) conv.set(m.conversation_id, []);
    conv.get(m.conversation_id).push(m);
  }
  for (const [cid, msgs] of conv) {
    const ut = msgs.find(x => x.type === 'user' && x.participant_name);
    const owner = ut && byName[ut.participant_name.toLowerCase()];
    if (!owner || !idset.has(owner.id)) continue;
    msgs.sort(byTime);
    threads.push({
      key: cid, who: owner.name, channel: 'Chat',
      turns: msgs.map(m => ({ role: m.type === 'user' ? owner.name : (m.label || 'AI'), content: m.content || '', mine: m.type === 'user' })),
    });
  }
  // coworker DMs grouped by (human, other)
  const dm = new Map();
  for (const d of data.directMessages || []) {
    const from = byId[d.from_participant_id]; const to = byId[d.to_participant_id];
    const human = from && (from.kind || 'human') === 'human' ? from : to && (to.kind || 'human') === 'human' ? to : null;
    if (!human || !idset.has(human.id)) continue;
    const other = human === from ? to : from;
    const k = `${human.id}|${other?.id || '?'}`;
    if (!dm.has(k)) dm.set(k, { key: k, who: human.name, hid: human.id, channel: `DM · ${other?.name || 'coworker'}`, otherName: other?.name || 'AI coworker', turns: [] });
    dm.get(k).turns.push(d);
  }
  for (const t of dm.values()) {
    t.turns.sort(byTime);
    t.turns = t.turns.map(d => ({ role: d.from_participant_id === t.hid ? t.who : t.otherName, content: d.content || '', mine: d.from_participant_id === t.hid }));
    threads.push(t);
  }
  threads.sort((a, b) => a.who.localeCompare(b.who) || a.channel.localeCompare(b.channel));

  if (!threads.length) return <div className="rf-empty">No chat traces for complete records in this cohort.</div>;

  return (
    <div className="rf-chats">
      <div className="rf-count" style={{ marginBottom: 8 }}>{threads.length} conversations</div>
      {threads.map(t => (
        <div key={t.key} className={`rf-thread${open === t.key ? ' is-open' : ''}`}>
          <button className="rf-thread-head" onClick={() => setOpen(open === t.key ? null : t.key)}>
            <span className="rf-thread-who">{t.who}</span>
            <span className="rf-thread-meta">{t.channel} · {t.turns.length} turns</span>
          </button>
          {open === t.key && (
            <div className="rf-thread-body">
              {t.turns.map((tn, i) => (
                <div key={i} className={`rf-turn${tn.mine ? ' is-mine' : ''}`}>
                  <div className="rf-turn-who">{tn.role}</div>
                  <div className="rf-turn-text">{tn.content}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

export default function ResearchForms({ data }) {
  const [form, setForm] = useState('demographics');
  if (!data) return <div className="rf-empty">Pick a cohort to see its form responses.</div>;

  const showCohort = !!data.roomNameByPid; // all-cohorts mode

  const completeSet = completeRecordPids(data);
  const consented = (data.participants || [])
    .filter(p => (p.kind || 'human') === 'human')
    .filter(p => completeSet.has(p.id))
    .sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  const bd = consentBreakdown(data.participants, data.consentByPid);

  if (!consented.length) {
    return <div className="rf-empty">No complete records here — only participants who finished demographics, the survey, and all their reflected stages are shown.</div>;
  }

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
        <button className={form === 'usage' ? 'is-active' : ''} onClick={() => setForm('usage')}>Usage arc</button>
        <button className={form === 'chats' ? 'is-active' : ''} onClick={() => setForm('chats')}>Chats</button>
        <span className="rf-count">
          {consented.length} complete records (of {bd.included} included){showCohort ? ' · all cohorts' : ''}
        </span>
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
                  {STAGES.map(s => {
                    const cells = reflRows.map(r => r.refl[s]).filter(Boolean);
                    const mean = (f) => {
                      const ns = cells.map(c => c[f]).filter(v => typeof v === 'number');
                      return ns.length ? (ns.reduce((a, b) => a + b, 0) / ns.length).toFixed(1) : '—';
                    };
                    return (
                      <th key={s}>
                        Stage {s} · {STAGE_NAME[s]}
                        {cells.length > 0 && (
                          <div className="rf-agg">avg clarity {mean('confidence')} · agree {mean('agreement')} · n={cells.length}</div>
                        )}
                      </th>
                    );
                  })}
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

      {form === 'usage' && <UsageTable data={data} consented={consented} showCohort={showCohort} />}

      {form === 'chats' && <ChatsView data={data} consented={consented} />}
    </div>
  );
}
