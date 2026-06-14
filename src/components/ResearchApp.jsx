import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '../supabase';
import useSupabase from '../hooks/useSupabase';
import { handleAuthCallback } from '../utils/authCallback';
import { buildResearchMarkdown } from '../utils/researchBundle';
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

// Modal editor for a single skill/theory.
function ItemEditor({ initial, onSave, onCancel }) {
  const [name, setName] = useState(initial?.name || '');
  const [yearTag, setYearTag] = useState(initial?.year_tag || '');
  const [body, setBody] = useState(initial?.body || '');
  const [busy, setBusy] = useState(false);
  const kind = initial.kind;
  return (
    <div className="rb-overlay" onClick={onCancel}>
      <div className="rb-modal" onClick={e => e.stopPropagation()}>
        <div className="rb-modal-head">
          <strong>{initial.id ? 'Edit' : 'New'} {KIND_LABEL[kind]}</strong>
          <button className="rb-btn rb-btn-ghost" onClick={onCancel}>Cancel</button>
        </div>
        <div className="rb-field">
          <label>Name</label>
          <input value={name} onChange={e => setName(e.target.value)} placeholder={kind === 'skill' ? 'e.g. Satisfaction driver analysis' : 'e.g. Algorithm aversion'} />
        </div>
        <div className="rb-field">
          <label>Year / version (optional)</label>
          <input value={yearTag} onChange={e => setYearTag(e.target.value)} placeholder="2026" />
        </div>
        <div className="rb-field">
          <label>{kind === 'skill' ? 'Analysis recipe' : 'Theory / framework'}</label>
          <textarea rows={12} value={body} onChange={e => setBody(e.target.value)}
            placeholder={kind === 'skill'
              ? 'Describe how the bench should analyze. e.g. "Cluster the delegation-boundary free-text into a taxonomy; report counts and representative quotes."'
              : 'Summarize the framework and how to apply it as a lens.'} />
        </div>
        <button className="rb-btn" disabled={busy || !name.trim()} onClick={async () => {
          setBusy(true);
          await onSave({ id: initial.id, name: name.trim(), body, kind, yearTag: yearTag.trim() });
          setBusy(false);
        }}>Save</button>
      </div>
    </div>
  );
}

// Sidebar library of skills + theories. `items` is the full library; edits go
// through sb then call onReload so the parent's copy (used by chat) refreshes.
function LibraryPanel({ sb, items, onReload }) {
  const [editing, setEditing] = useState(null); // {kind, id?, ...} or null
  const byKind = (k) => items.filter(i => i.kind === k);

  async function save(item) {
    await sb.saveResearchItem(item);
    setEditing(null);
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
          <button className="rb-lib-name" title={it.body} onClick={() => setEditing(it)}>
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
      {section('skill', 'Research skills')}
      {section('theory', 'Research theories')}
      {editing && (
        <ItemEditor initial={editing} onSave={save} onCancel={() => setEditing(null)} />
      )}
    </div>
  );
}

// The authorized bench: pick a cohort, load its consent-filtered bundle into
// context, manage the skills/theories library (Phase 4), and chat (Phase 5).
function Bench({ sb }) {
  const [cohorts, setCohorts] = useState([]);
  const [cohortId, setCohortId] = useState('');
  const [bundle, setBundle] = useState(null);   // { text, consented, total, tokens, cohort, data }
  const [loadingBundle, setLoadingBundle] = useState(false);
  const [library, setLibrary] = useState([]);
  const [view, setView] = useState('data');     // 'data' | 'chat'

  const reloadLibrary = useCallback(() => { sb.loadResearchLibrary().then(setLibrary); }, [sb]);
  useEffect(() => { sb.loadAllCohorts().then(setCohorts); reloadLibrary(); }, [sb, reloadLibrary]);

  const loadCohort = useCallback(async (id) => {
    setCohortId(id);
    setBundle(null);
    if (!id) return;
    setLoadingBundle(true);
    const cohort = cohorts.find(c => c.id === id);
    const data = await sb.loadAdminResearchData(id);
    const total = (data.participants || []).filter(p => (p.kind || 'human') === 'human').length;
    const consented = (data.participants || [])
      .filter(p => (p.kind || 'human') === 'human')
      .filter(p => {
        const c = data.consentByPid?.[p.id];
        return c && c.granted === true && !c.withdrawn_at;
      }).length;
    const text = buildResearchMarkdown(data, {
      workshopCode: cohort?.code, orgName: cohort?.org_name, consentedOnly: true,
    });
    setBundle({ text, consented, total, tokens: estTokens(text), cohort, data });
    setLoadingBundle(false);
  }, [sb, cohorts]);

  return (
    <div className="rb-bench">
      <aside className="rb-sidebar">
        <div className="rb-field">
          <label>Cohort</label>
          <select value={cohortId} onChange={e => loadCohort(e.target.value)}>
            <option value="">Select a cohort…</option>
            {cohorts.map(c => (
              <option key={c.id} value={c.id}>
                {c.org_name} · {c.code}{c.environment !== 'production' ? ' (dev)' : ''}
              </option>
            ))}
          </select>
        </div>

        {loadingBundle && <div className="rb-muted rb-field">Loading cohort data…</div>}
        {bundle && (
          <div className="rb-bundle-stats">
            <div><strong>{bundle.consented}</strong> of {bundle.total} participants consented</div>
            <div className="rb-muted">{bundle.tokens.toLocaleString()} tokens in context</div>
            {bundle.tokens > 150000 && (
              <div className="rb-warn">Large context — synthesis will be slow and costly.</div>
            )}
            {bundle.consented === 0 && (
              <div className="rb-warn">No consented participants — nothing to synthesize.</div>
            )}
          </div>
        )}

        <LibraryPanel sb={sb} items={library} onReload={reloadLibrary} />
      </aside>

      <main className="rb-main">
        {!bundle && <p className="rb-muted">Pick a cohort to see its form responses and chat with the data.</p>}
        {bundle && bundle.consented === 0 && (
          <p className="rb-muted">No consented participants in this cohort.</p>
        )}
        {bundle && bundle.consented > 0 && (
          <>
            <div className="rb-viewtabs">
              <button className={view === 'data' ? 'is-active' : ''} onClick={() => setView('data')}>Data</button>
              <button className={view === 'chat' ? 'is-active' : ''} onClick={() => setView('chat')}>Chat</button>
            </div>
            {view === 'data'
              ? <ResearchForms data={bundle.data} />
              : <Chat sb={sb} bundle={bundle} library={library} />}
          </>
        )}
      </main>
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
  const [totalConsented, setTotalConsented] = useState(null); // corpus size, all cohorts
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
      const [isAdmin, allowed] = await Promise.all([
        sb.checkIsAdmin(user.id),
        sb.checkResearchAccess(user.email),
      ]);
      resolvedForUser.current = user.id;
      setAccess(isAdmin || allowed ? 'yes' : 'no');
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

  // Corpus size — total consented participants across all cohorts. Loaded once
  // access is granted.
  useEffect(() => {
    if (access === 'yes') sb.loadTotalConsented().then(setTotalConsented);
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
            <button className="rb-btn" onClick={() => sb.signInWithGoogle()}>Sign in with Google</button>
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
          {totalConsented != null && (
            <span className="rb-corpus" title="Total consented participants across all cohorts">
              {totalConsented.toLocaleString()} consented participants
            </span>
          )}
          <span>{email}</span>
          <button className="rb-btn rb-btn-ghost" onClick={() => sb.signOut()}>Sign out</button>
        </div>
      </header>
      <Bench sb={sb} />
    </div>
  );
}
