import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '../supabase';
import useSupabase from '../hooks/useSupabase';
import { handleAuthCallback } from '../utils/authCallback';
import { buildResearchMarkdown, consentBreakdown, completeRecordPids } from '../utils/researchBundle';
import { buildProfileText, buildRunPrompt } from '../utils/researchProfiles';
import { fetchGithubText } from '../utils/fetchSource';
import { SEED_THEORIES, SEED_SKILLS } from '../data/researchSeed';
import { callClaudeProxy } from '../utils/claudeFetch';
import { computeCost, formatUsd } from '../utils/llmCost';
import ResearchForms from './ResearchForms';
import './ResearchApp.css';

// Rough token estimate for the context-size guardrail (~4 chars/token).
const estTokens = (s) => Math.ceil((s || '').length / 4);

// Opus for synthesis quality over the large cohort bundle. NOTE: confirm this
// model id is enabled on the Anthropic account at deploy — the proxy forwards
// it verbatim. Cost is priced in llmCost.js under the same key.
const BENCH_MODEL = 'claude-opus-4-8';
const BENCH_MAX_TOKENS = 8192;

function joinText(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.filter(b => b.type === 'text').map(b => b.text).join('\n');
  return '';
}

// Assemble the system prompt: a standing instruction + the library (theories
// as lenses, skills as method), then the cohort bundle as its own cached
// block (large + stable across turns → cache_read on follow-ups).
function buildSystem(bundle, library) {
  const theories = library.filter(i => i.kind === 'theory');
  const skills = library.filter(i => i.kind === 'skill');
  const lens = theories.length
    ? '\n\n## Theoretical lenses\n' + theories.map(t => `### ${t.name}\n${t.body}`).join('\n\n')
    : '';
  const method = skills.length
    ? '\n\n## Analysis skills (method)\n' + skills.map(s => `### ${s.name}\n${s.body}`).join('\n\n')
    : '';
  const instruction =
    'You are a research analyst for the Foundry workshop platform. You answer questions about a ' +
    'single workshop cohort using the consent-filtered research data provided below. Apply the ' +
    'analysis skills as method and the theoretical lenses as framing. Ground every claim in the ' +
    'data — cite participant names and quote their own words. When the data is insufficient to ' +
    'answer, say so plainly rather than speculating.' + lens + method;
  return [
    { type: 'text', text: instruction },
    { type: 'text', text: '\n\n## Cohort research data\n' + bundle.text, cache_control: { type: 'ephemeral' } },
  ];
}

function Chat({ sb, bundle, library }) {
  const [messages, setMessages] = useState([]); // {role, content}
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [spend, setSpend] = useState(0);

  // Reset the conversation when the cohort changes.
  useEffect(() => { setMessages([]); setError(null); setSpend(0); }, [bundle.cohort?.id]);

  async function send() {
    const q = input.trim();
    if (!q || busy) return;
    if (bundle.tokens > 150000 &&
        !window.confirm(`This cohort is ~${bundle.tokens.toLocaleString()} tokens of context. Each question will be slow and costly. Continue?`)) {
      return;
    }
    setError(null);
    const next = [...messages, { role: 'user', content: q }];
    setMessages(next);
    setInput('');
    setBusy(true);
    try {
      const res = await callClaudeProxy(supabase, {
        model: BENCH_MODEL,
        max_tokens: BENCH_MAX_TOKENS,
        system: buildSystem(bundle, library),
        messages: next.map(m => ({ role: m.role, content: m.content })),
      }, { timeoutMs: 600000 });
      const data = await res.json();
      if (!res.ok || data.error) {
        throw new Error(data.error?.message || data.error || `Request failed (${res.status})`);
      }
      const text = joinText(data.content) || '(empty response)';
      setMessages(m => [...m, { role: 'assistant', content: text }]);
      if (data.usage) {
        const cost = computeCost(data.usage, data.model || BENCH_MODEL);
        setSpend(s => s + cost);
        sb.logResearchUsage({
          segment: 'research_bench', segmentRefId: bundle.cohort?.id,
          model: data.model || BENCH_MODEL, usage: data.usage, costUsd: cost,
        });
      }
    } catch (err) {
      setError(err?.message || 'Request failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rb-chat">
      <div className="rb-chat-log">
        {messages.length === 0 && (
          <p className="rb-muted">
            Ask anything about <strong>{bundle.cohort?.org_name}</strong>. e.g. “Why did the
            dissatisfied heavy users rate low? Read it through algorithm aversion.”
          </p>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`rb-msg rb-msg-${m.role}`}>
            <div className="rb-msg-who">{m.role === 'user' ? 'You' : 'Analyst'}</div>
            <div className="rb-msg-body">{m.content}</div>
          </div>
        ))}
        {busy && <div className="rb-msg rb-msg-assistant"><div className="rb-msg-who">Analyst</div><div className="rb-msg-body rb-muted">Thinking…</div></div>}
        {error && <div className="rb-error rb-chat-err">{error}</div>}
      </div>
      <div className="rb-chat-input">
        <textarea
          rows={2}
          value={input}
          placeholder="Ask a question about this cohort…"
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) send(); }}
        />
        <div className="rb-chat-actions">
          <span className="rb-muted">{spend > 0 ? `Session: ${formatUsd(spend)}` : '⌘↵ to send'}</span>
          <button className="rb-btn" onClick={send} disabled={busy || !input.trim()}>Send</button>
        </div>
      </div>
    </div>
  );
}

const KIND_LABEL = { skill: 'Skill', theory: 'Theory' };

// Modal editor. Both skills and theories are documents: paste text, pull from
// a public GitHub file, or upload a .md/.txt. The document IS the content — a
// skill's prose carries the analysis recipe; a theory's carries the framework.
function ItemEditor({ initial, onSave, onCancel }) {
  const kind = initial.kind;
  const sp = initial?.spec || {};
  const [name, setName] = useState(initial?.name || '');
  const [yearTag, setYearTag] = useState(initial?.year_tag || '');
  const [body, setBody] = useState(initial?.body || '');
  const [sourceType, setSourceType] = useState(sp.source_type || 'paste'); // paste | github | upload
  const [sourceUrl, setSourceUrl] = useState(sp.source_url || '');
  const [fetching, setFetching] = useState(false);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);

  async function pullGithub() {
    setFetching(true); setErr(null);
    try { setBody(await fetchGithubText(sourceUrl)); }
    catch (e) { setErr(e.message); }
    setFetching(false);
  }
  function onFile(e) {
    const f = e.target.files?.[0];
    if (!f) return;
    const r = new FileReader();
    r.onload = () => { setBody(String(r.result || '')); setSourceUrl(f.name); };
    r.onerror = () => setErr('Could not read that file.');
    r.readAsText(f);
  }
  async function save() {
    setBusy(true);
    await onSave({
      id: initial.id, name: name.trim(), kind, yearTag: yearTag.trim(),
      body, spec: { source_type: sourceType, source_url: sourceUrl },
    });
    setBusy(false);
  }

  const noun = kind === 'skill' ? 'analysis recipe' : 'framework / theory';
  return (
    <div className="rb-overlay" onClick={onCancel}>
      <div className="rb-modal" onClick={e => e.stopPropagation()}>
        <div className="rb-modal-head">
          <strong>{initial.id ? 'Edit' : 'New'} {KIND_LABEL[kind]}</strong>
          <button className="rb-btn rb-btn-ghost" onClick={onCancel}>Cancel</button>
        </div>
        <div className="rb-field">
          <label>Name</label>
          <input value={name} onChange={e => setName(e.target.value)}
            placeholder={kind === 'skill' ? 'e.g. Perception shift analysis' : 'e.g. Algorithm aversion'} />
        </div>
        <div className="rb-field">
          <label>Year / version (optional)</label>
          <input value={yearTag} onChange={e => setYearTag(e.target.value)} placeholder="2026" />
        </div>

        <div className="rb-field">
          <label>Source</label>
          <div className="rb-dims">
            {['paste', 'github', 'upload'].map(s => (
              <button key={s} type="button" className={`rb-dim${sourceType === s ? ' is-on' : ''}`}
                onClick={() => setSourceType(s)}>
                {s === 'paste' ? 'Paste' : s === 'github' ? 'GitHub link' : 'Upload file'}
              </button>
            ))}
          </div>
        </div>

        {sourceType === 'github' && (
          <div className="rb-field rb-src-row">
            <input value={sourceUrl} onChange={e => setSourceUrl(e.target.value)}
              placeholder="https://github.com/org/repo/blob/main/skills/perception-shift.md" />
            <button className="rb-btn rb-btn-ghost" disabled={fetching || !sourceUrl.trim()} onClick={pullGithub}>
              {fetching ? 'Pulling…' : 'Pull'}
            </button>
          </div>
        )}
        {sourceType === 'upload' && (
          <div className="rb-field">
            <input type="file" accept=".md,.txt,text/markdown,text/plain" onChange={onFile} />
            {sourceUrl && <span className="rb-muted"> {sourceUrl}</span>}
          </div>
        )}

        {err && <div className="rb-error">{err}</div>}

        <div className="rb-field">
          <label>{noun} {sourceType !== 'paste' ? '(fetched — editable)' : ''}</label>
          <textarea rows={12} value={body} onChange={e => setBody(e.target.value)}
            placeholder={kind === 'skill'
              ? 'The skill document: describe the analysis to run — question, method, and how to present the finding.'
              : 'The framework: summarize it, cite it, and say when to apply it as a lens.'} />
        </div>
        <button className="rb-btn" disabled={busy || !name.trim() || !body.trim()} onClick={save}>Save</button>
      </div>
    </div>
  );
}

// Sidebar library of skills + theories. `items` is the full library; edits go
// through sb then call onReload. onRun(skill) opens the Run flow.
function LibraryPanel({ sb, items, onReload, onRun }) {
  const [editing, setEditing] = useState(null); // {kind, id?, ...} or null
  const [seeding, setSeeding] = useState(false);
  const byKind = (k) => items.filter(i => i.kind === k);

  async function save(item) {
    await sb.saveResearchItem(item);
    setEditing(null);
    onReload();
  }

  async function seed() {
    setSeeding(true);
    for (const t of SEED_THEORIES) await sb.saveResearchItem({ name: t.name, kind: 'theory', body: t.body, spec: { source_type: 'seed' } });
    for (const s of SEED_SKILLS) await sb.saveResearchItem({ name: s.name, kind: 'skill', body: s.body, spec: { source_type: 'seed' } });
    setSeeding(false);
    onReload();
  }

  const section = (kind, title) => (
    <div className="rb-lib-section">
      <div className="rb-lib-head">
        <span>{title}</span>
        <button className="rb-lib-add" onClick={() => setEditing({ kind })}>+ Add</button>
      </div>
      {byKind(kind).length === 0 && <div className="rb-muted rb-lib-empty">None yet</div>}
      {byKind(kind).map(it => (
        <div key={it.id} className="rb-lib-item">
          {kind === 'skill' && (
            <button className="rb-lib-run" title="Run this skill" onClick={() => onRun(it)}>▶</button>
          )}
          <button className="rb-lib-name" title={(it.body || '').slice(0, 200)} onClick={() => setEditing(it)}>
            {it.name}{it.year_tag ? ` · ${it.year_tag}` : ''}
          </button>
          <button className="rb-lib-del" title="Delete"
            onClick={async () => { await sb.deleteResearchItem(it.id); onReload(); }}>×</button>
        </div>
      ))}
    </div>
  );

  return (
    <div className="rb-field">
      <label>Library</label>
      {items.length === 0 && (
        <button className="rb-btn rb-seed" disabled={seeding} onClick={seed}>
          {seeding ? 'Seeding…' : 'Seed starter library'}
        </button>
      )}
      {section('skill', 'Research skills')}
      {section('theory', 'Research theories')}
      {editing && <ItemEditor initial={editing} onSave={save} onCancel={() => setEditing(null)} />}
    </div>
  );
}

// Run a skill: choose scope + which theory lenses, see the estimate, execute,
// and save the result as a Finding.
function RunModal({ sb, skill, theories, cohorts, currentCohort, onClose, onSaved }) {
  const [scope, setScope] = useState(currentCohort?.id || 'all');
  const [picked, setPicked] = useState(() => new Set(theories.map(t => t.id)));
  const [phase, setPhase] = useState('config'); // config | running | done | error
  const [result, setResult] = useState(null);    // { body, cost, n }
  const [error, setError] = useState(null);

  const toggle = (id) => setPicked(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const scopeLabel = scope === 'all' ? 'All cohorts' : (cohorts.find(c => c.id === scope)?.org_name || 'cohort');

  async function run() {
    setPhase('running'); setError(null);
    try {
      const data = scope === 'all' ? await sb.loadAllFormResponses() : await sb.loadAdminResearchData(scope);
      const usageByPid = await sb.loadUsageByParticipant();
      const { text, n } = buildProfileText(data, null, usageByPid); // full profile; the skill doc decides what to use
      if (!n) { setError('No complete records in this scope.'); setPhase('error'); return; }
      const lenses = theories.filter(t => picked.has(t.id));
      const { system, user } = buildRunPrompt({ skill, theories: lenses, profileText: text, n, scopeLabel });
      const res = await callClaudeProxy(supabase, {
        model: BENCH_MODEL, max_tokens: BENCH_MAX_TOKENS,
        system: [{ type: 'text', text: system }],
        messages: [{ role: 'user', content: user }],
      }, { timeoutMs: 600000 });
      const d = await res.json();
      if (!res.ok || d.error) throw new Error(d.error?.message || d.error || `Request failed (${res.status})`);
      const body = (d.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n') || '(empty)';
      const cost = d.usage ? computeCost(d.usage, d.model || BENCH_MODEL) : 0;
      if (d.usage) sb.logResearchUsage({ segment: 'research_run', model: d.model || BENCH_MODEL, usage: d.usage, costUsd: cost });
      const title = `${skill.name} — ${scopeLabel}`;
      await sb.saveResearchFinding({ title, skillId: skill.id, skillName: skill.name, scope, scopeLabel, body, model: d.model || BENCH_MODEL, costUsd: cost });
      setResult({ body, cost, n });
      setPhase('done');
      onSaved();
    } catch (err) {
      setError(err?.message || 'Run failed'); setPhase('error');
    }
  }

  return (
    <div className="rb-overlay" onClick={phase === 'running' ? undefined : onClose}>
      <div className="rb-modal rb-modal-wide" onClick={e => e.stopPropagation()}>
        <div className="rb-modal-head">
          <strong>Run · {skill.name}</strong>
          <button className="rb-btn rb-btn-ghost" disabled={phase === 'running'} onClick={onClose}>Close</button>
        </div>

        {(phase === 'config' || phase === 'running' || phase === 'error') && (
          <>
            <div className="rb-field">
              <label>Scope</label>
              <select value={scope} onChange={e => setScope(e.target.value)} disabled={phase === 'running'}>
                <option value="all">All cohorts (lifetime)</option>
                {cohorts.map(c => <option key={c.id} value={c.id}>{c.org_name} · {c.code}</option>)}
              </select>
            </div>
            <div className="rb-field">
              <label>Theory lenses to apply</label>
              <div className="rb-dims">
                {theories.length === 0 && <span className="rb-muted">No theories in the library yet.</span>}
                {theories.map(t => (
                  <button key={t.id} type="button" className={`rb-dim${picked.has(t.id) ? ' is-on' : ''}`}
                    disabled={phase === 'running'} onClick={() => toggle(t.id)}>{t.name}</button>
                ))}
              </div>
            </div>
            <div className="rb-muted rb-run-note">
              Runs Opus over complete records only — full profiles (form + usage); the skill document steers the analysis.
            </div>
            {error && <div className="rb-error">{error}</div>}
            <button className="rb-btn" disabled={phase === 'running'} onClick={run}>
              {phase === 'running' ? 'Running… (this can take a minute)' : 'Run'}
            </button>
          </>
        )}

        {phase === 'done' && result && (
          <>
            <div className="rb-muted rb-run-note">Saved to Findings · {result.n} records · {formatUsd(result.cost)}</div>
            <div className="rb-finding-body">{result.body}</div>
            <button className="rb-btn" onClick={onClose}>Done</button>
          </>
        )}
      </div>
    </div>
  );
}

// Admin-only allowlist manager for the research portal. Granting access here
// only lets someone into the research portal — it does NOT make them an admin
// (the admin dashboard stays gated by the separate `admins` table). RLS
// enforces that only admins can edit this list.
function AccessManager({ sb, user, onClose }) {
  const [rows, setRows] = useState(null);
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const reload = useCallback(() => { sb.loadResearchAccess().then(setRows); }, [sb]);
  useEffect(() => { reload(); }, [reload]);

  async function add() {
    const e = email.trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) { setErr('Enter a valid email'); return; }
    setBusy(true); setErr(null);
    const { error } = await sb.addResearchAccess(e, user?.id);
    setBusy(false);
    if (error) { setErr(error.message); return; }
    setEmail(''); reload();
  }

  return (
    <div className="rb-overlay" onClick={onClose}>
      <div className="rb-modal" onClick={e => e.stopPropagation()}>
        <div className="rb-modal-head">
          <strong>Research portal access</strong>
          <button className="rb-btn rb-btn-ghost" onClick={onClose}>Close</button>
        </div>
        <p className="rb-muted" style={{ fontSize: 13, margin: '4px 0 16px' }}>
          These people can sign into the research portal. This does <strong>not</strong> grant admin access. Admins are always allowed.
        </p>
        <div className="rb-src-row rb-field">
          <input type="email" placeholder="name@org.com" value={email}
            onChange={e => setEmail(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') add(); }} />
          <button className="rb-btn" disabled={busy} onClick={add}>Add</button>
        </div>
        {err && <div className="rb-error">{err}</div>}
        <div className="rb-access-list">
          {rows === null && <div className="rb-muted">Loading…</div>}
          {rows && rows.length === 0 && <div className="rb-muted">No one added yet.</div>}
          {rows && rows.map(r => (
            <div key={r.email} className="rb-lib-item">
              <span className="rb-lib-name" style={{ cursor: 'default' }}>{r.email}</span>
              <button className="rb-lib-del" title="Remove"
                onClick={async () => { await sb.removeResearchAccess(r.email); reload(); }}>×</button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// The accumulating insight repo — every skill Run is saved here.
function FindingsView({ sb, findings, onReload }) {
  const [open, setOpen] = useState(null);
  if (!findings.length) {
    return <p className="rb-muted">No findings yet. Run a skill from the Library to produce one.</p>;
  }
  return (
    <div className="rb-findings">
      {findings.map(f => (
        <div key={f.id} className={`rb-finding${open === f.id ? ' is-open' : ''}`}>
          <div className="rb-finding-head" onClick={() => setOpen(open === f.id ? null : f.id)}>
            <div>
              <div className="rb-finding-title">{f.title}</div>
              <div className="rb-muted rb-finding-meta">
                {f.scope_label} · {f.created_at ? new Date(f.created_at).toLocaleDateString() : ''}
                {f.cost_usd != null ? ` · ${formatUsd(Number(f.cost_usd))}` : ''}
              </div>
            </div>
            <button className="rb-lib-del" title="Delete"
              onClick={async (e) => { e.stopPropagation(); await sb.deleteResearchFinding(f.id); onReload(); }}>×</button>
          </div>
          {open === f.id && <div className="rb-finding-body">{f.body}</div>}
        </div>
      ))}
    </div>
  );
}

// The authorized bench: pick a cohort, load its consent-filtered bundle into
// context, manage the skills/theories library, run skills, and chat.
function Bench({ sb }) {
  const [cohorts, setCohorts] = useState([]);
  const [cohortId, setCohortId] = useState('');
  const [bundle, setBundle] = useState(null);   // { text, consented, total, tokens, cohort, data }
  const [loadingBundle, setLoadingBundle] = useState(false);
  const [library, setLibrary] = useState([]);
  const [findings, setFindings] = useState([]);
  const [runSkill, setRunSkill] = useState(null); // skill being run, or null
  const [view, setView] = useState('data');       // 'data' | 'chat' | 'findings'

  const reloadLibrary = useCallback(() => { sb.loadResearchLibrary().then(setLibrary); }, [sb]);
  const reloadFindings = useCallback(() => { sb.loadResearchFindings().then(setFindings); }, [sb]);
  useEffect(() => { sb.loadAllCohorts().then(setCohorts); reloadLibrary(); reloadFindings(); }, [sb, reloadLibrary, reloadFindings]);

  const theories = library.filter(i => i.kind === 'theory');

  const loadCohort = useCallback(async (id) => {
    setCohortId(id);
    setBundle(null);
    if (!id) return;
    setLoadingBundle(true);
    if (id === '__all__') {
      // Corpus-wide Data view. No chat here — a single cohort's bundle fits
      // context; all cohorts together would not. Data-only by design.
      const data = await sb.loadAllFormResponses();
      setView('data');
      setBundle({ allCohorts: true, breakdown: consentBreakdown(data.participants, data.consentByPid),
        complete: completeRecordPids(data).size, data, cohort: { org_name: 'All cohorts' } });
      setLoadingBundle(false);
      return;
    }
    const cohort = cohorts.find(c => c.id === id);
    const data = await sb.loadAdminResearchData(id);
    const breakdown = consentBreakdown(data.participants, data.consentByPid);
    const complete = completeRecordPids(data).size;
    const text = buildResearchMarkdown(data, {
      workshopCode: cohort?.code, orgName: cohort?.org_name, consentedOnly: true,
    });
    setBundle({ text, breakdown, complete, tokens: estTokens(text), cohort, data });
    setLoadingBundle(false);
  }, [sb, cohorts]);

  return (
    <div className="rb-bench">
      <aside className="rb-sidebar">
        <div className="rb-field">
          <label>Cohort</label>
          <select value={cohortId} onChange={e => loadCohort(e.target.value)}>
            <option value="">Select a cohort…</option>
            <option value="__all__">★ All consented cohorts (data only)</option>
            {cohorts.map(c => (
              <option key={c.id} value={c.id}>
                {c.org_name} · {c.code}{c.environment !== 'production' ? ' (dev)' : ''}
              </option>
            ))}
          </select>
        </div>

        {loadingBundle && <div className="rb-muted rb-field">Loading cohort data…</div>}

        <LibraryPanel sb={sb} items={library} onReload={reloadLibrary} onRun={setRunSkill} />
      </aside>

      <main className="rb-main">
        <div className="rb-viewtabs">
          <button className={view === 'data' ? 'is-active' : ''} onClick={() => setView('data')}>Data</button>
          {bundle && !bundle.allCohorts && (
            <button className={view === 'chat' ? 'is-active' : ''} onClick={() => setView('chat')}>Chat</button>
          )}
          <button className={view === 'findings' ? 'is-active' : ''} onClick={() => setView('findings')}>
            Findings{findings.length ? ` (${findings.length})` : ''}
          </button>
        </div>

        {view === 'findings'
          ? <FindingsView sb={sb} findings={findings} onReload={reloadFindings} />
          : !bundle
            ? <p className="rb-muted">Pick a cohort to see its form responses and chat — or open Findings.</p>
            : bundle.complete === 0
              ? <p className="rb-muted">No complete records in this cohort — partial responders are hidden.</p>
              : (view === 'chat' && !bundle.allCohorts)
                ? <Chat sb={sb} bundle={bundle} library={library} />
                : <ResearchForms data={bundle.data} />}
      </main>

      {runSkill && (
        <RunModal sb={sb} skill={runSkill} theories={theories} cohorts={cohorts}
          currentCohort={bundle && !bundle.allCohorts ? bundle.cohort : null}
          onClose={() => setRunSkill(null)} onSaved={reloadFindings} />
      )}
    </div>
  );
}

// Standalone Research Bench. Lives on research.foundry.alokkhatri.com (see
// main.jsx + environment.isResearchHost). Reuses the platform's Supabase auth
// and the JWT-verified claude-proxy, but brings its own gate — AuthGate is
// wired to the workshop UX (join codes, stages) and isn't reusable here.
//
// Access: admins implicitly pass; everyone else must be on the research_access
// allowlist (added by an admin from the dashboard). The allowlist check is
// wired in Phase 2; for now the gate is admin-only.
export default function ResearchApp() {
  const sb = useSupabase();
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  // Tri-state mirrors AuthGate so a network blip shows retry, not a hard "no".
  const [access, setAccess] = useState('unknown'); // 'unknown' | 'yes' | 'no' | 'error'
  const [accessError, setAccessError] = useState(null);
  const [isAdmin, setIsAdmin] = useState(false);   // gates the Access manager button
  const [accessOpen, setAccessOpen] = useState(false);
  const [corpus, setCorpus] = useState(null); // {included, consented, pending, declined} all cohorts
  // The auth id we've already resolved access for. Supabase fires
  // onAuthStateChange on tab focus / token refresh; without this guard we'd
  // re-check (flipping access to 'unknown') on every such event, which
  // unmounts the Bench and wipes the researcher's cohort + chat in progress.
  const resolvedForUser = useRef(null);

  const resolveAccess = useCallback(async (user, { force = false } = {}) => {
    if (!user) { resolvedForUser.current = null; setAccess('no'); return; }
    if (!force && resolvedForUser.current === user.id) return; // already settled for this user
    setAccess('unknown');
    setAccessError(null);
    try {
      const [admin, allowed] = await Promise.all([
        sb.checkIsAdmin(user.id),
        sb.checkResearchAccess(user.email),
      ]);
      resolvedForUser.current = user.id;
      setIsAdmin(admin);
      setAccess(admin || allowed ? 'yes' : 'no');
    } catch (err) {
      console.error('[research] access check failed:', err);
      resolvedForUser.current = null; // allow retry
      setAccess('error');
      setAccessError(err?.message || 'Access check failed');
    }
  }, [sb]);

  useEffect(() => {
    let mounted = true;
    async function init() {
      await handleAuthCallback();
      const { data: { session: s } } = await supabase.auth.getSession();
      if (!mounted) return;
      setSession(s);
      await resolveAccess(s?.user);
      setLoading(false);
    }
    init();
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, s) => {
      if (!mounted) return;
      setSession(s);
      resolveAccess(s?.user);
      setLoading(false);
    });
    return () => { mounted = false; subscription.unsubscribe(); };
  }, [resolveAccess]);

  // Corpus consent tally across all cohorts. Loaded once access is granted.
  useEffect(() => {
    if (access === 'yes') sb.loadCorpusConsent().then(setCorpus);
  }, [access, sb]);

  // --- Loading ---
  if (loading) {
    return (
      <div className="rb-root">
        <div className="rb-center">
          <div className="rb-wordmark">Foundry <span>Research</span></div>
        </div>
      </div>
    );
  }

  // --- Not signed in ---
  if (!session) {
    return (
      <div className="rb-root">
        <div className="rb-center">
          <div className="rb-card">
            <div className="rb-wordmark">Foundry <span>Research</span></div>
            <div className="rb-sub">Talk to your workshop research data</div>
            <h2>Sign in to continue</h2>
            <p>Access is granted by a Foundry admin. Sign in with the Google account you were invited with.</p>
            <button className="rb-btn" onClick={() => sb.signInWithGoogle(window.location.origin + window.location.pathname)}>Sign in with Google</button>
          </div>
        </div>
      </div>
    );
  }

  const email = session.user?.email || '';

  // --- Signed in, access check failed (let them retry) ---
  if (access === 'error') {
    return (
      <div className="rb-root">
        <div className="rb-center">
          <div className="rb-card">
            <div className="rb-wordmark">Foundry <span>Research</span></div>
            <h2>Couldn’t verify access</h2>
            <p className="rb-error">{accessError}</p>
            <button className="rb-btn" onClick={() => resolveAccess(session.user, { force: true })}>Retry</button>
            <div style={{ marginTop: 14 }}>
              <button className="rb-btn rb-btn-ghost" onClick={() => sb.signOut()}>Sign out</button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // --- Signed in but not authorized ---
  if (access !== 'yes') {
    return (
      <div className="rb-root">
        <div className="rb-center">
          <div className="rb-card">
            <div className="rb-wordmark">Foundry <span>Research</span></div>
            <h2>No access yet</h2>
            <p><strong>{email}</strong> isn’t on the research allowlist. Ask a Foundry admin to grant you access, then reload.</p>
            <button className="rb-btn rb-btn-ghost" onClick={() => sb.signOut()}>Sign out</button>
          </div>
        </div>
      </div>
    );
  }

  // --- Authorized: the bench (placeholder until later phases) ---
  return (
    <div className="rb-root">
      <header className="rb-topbar">
        <div className="rb-wordmark">Foundry <span>Research</span></div>
        <div className="rb-topbar-user">
          {corpus != null && (
            <span className="rb-corpus"
              title={`${corpus.consented} explicitly consented · ${corpus.pending} no response · ${corpus.declined} declined (excluded)`}>
              {corpus.included.toLocaleString()} included participants
            </span>
          )}
          <span>{email}</span>
          {isAdmin && (
            <button className="rb-btn rb-btn-ghost" onClick={() => setAccessOpen(true)}>Access</button>
          )}
          <button className="rb-btn rb-btn-ghost" onClick={() => sb.signOut()}>Sign out</button>
        </div>
      </header>
      <Bench sb={sb} />
      {accessOpen && <AccessManager sb={sb} user={session.user} onClose={() => setAccessOpen(false)} />}
    </div>
  );
}
