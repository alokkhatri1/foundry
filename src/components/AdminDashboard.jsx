import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { STAGE_ORDER, STAGE_META, stageReached, nextStage } from './RevealAt';
import { useConfirm } from './ConfirmDialog';
import { computeScorecard, LEVELS, LEVEL_COLORS } from '../utils/graduationScorecard';
import { buildTree } from '../utils/treeUtils';
import ResearchView from './ResearchView';
import { downloadResearchBundle, downloadParticipantNotes } from '../utils/researchBundle';

// Per-participant credit allocation editor. Small inline row above the
// stage list — big enough to notice, small enough not to steal focus from
// the reveal flow. 1000 credits = $0.50 at current rates; facilitators
// running dry-runs often want to bump this so no one hits the cap.
function AdminCreditAllocation({ value, onSave, deprecated }) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => { setDraft(String(value)); }, [value]);
  const dirty = String(value) !== draft.trim();
  return (
    <div className="admin-credit-row">
      <div className="admin-credit-label">
        <span className="admin-credit-label-title">Credits per participant</span>
        <span className="admin-credit-label-hint">1000 credits ≈ $0.50. Apply to this workshop only.</span>
      </div>
      <input
        type="number"
        min="0"
        step="100"
        className="admin-credit-input"
        value={draft}
        onChange={e => setDraft(e.target.value)}
        disabled={deprecated}
      />
      <button
        className="admin-credit-save"
        onClick={() => onSave(draft)}
        disabled={!dirty || deprecated}
      >Save</button>
    </div>
  );
}

function WorkshopRow({ w, selected, onSelect, copied, onCopy, stats, dim }) {
  const stageLabel = w.deprecated_at
    ? 'Delivered'
    : `Stage ${w.current_stage || '1'}`;
  const count = stats?.participants || 0;
  return (
    <button
      type="button"
      className={`admin-rail-row${selected ? ' active' : ''}${dim ? ' dim' : ''}`}
      onClick={onSelect}
    >
      <div className="admin-rail-row-main">
        <span className="admin-rail-row-name">{w.org_name}</span>
        <span
          className="admin-rail-row-code"
          onClick={e => { e.stopPropagation(); onCopy(w.code); }}
          title="Click to copy"
        >
          {copied === w.code ? 'Copied' : w.code}
        </span>
      </div>
      <div className="admin-rail-row-meta">
        <span className={`admin-stage-badge${w.deprecated_at ? ' dep' : ''}`}>
          {stageLabel}
        </span>
        <span className="admin-rail-row-count">{count} {count === 1 ? 'participant' : 'participants'}</span>
      </div>
    </button>
  );
}

// Scaled feedback questions, shared between the per-cohort summary
// (FeedbackResponses) and the per-participant card on the participants tab.
const SCORE_FIELDS = [
  { key: 'satisfaction',         label: 'Satisfaction' },
  { key: 'relevance',            label: 'Relevance' },
  { key: 'clarity',              label: 'Clarity' },
  { key: 'trainer_knowledge',    label: 'Trainer content clarity' },
  { key: 'trainer_delivery',     label: 'Trainer pacing' },
  { key: 'trainer_engagement',   label: 'Workshop content' },
  { key: 'materials_quality',    label: 'Slides & content' },
  { key: 'theory_practice',      label: 'Explain / practice mix' },
  { key: 'improved_skills',      label: 'Improved skills' },
  { key: 'can_apply',            label: 'Can apply' },
  { key: 'platform_rating',      label: 'Platform ease' },
  { key: 'platform_reliability', label: 'Platform reliability' },
  { key: 'platform_support',     label: 'Platform support' },
];

export default function AdminDashboard({ sb, user, onBack, onEnterWorkshop }) {
  const confirm = useConfirm();
  const [workshops, setWorkshops] = useState([]);
  const [stats, setStats] = useState({});
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [newOrg, setNewOrg] = useState('');
  const [creating, setCreating] = useState(false);
  const [selected, setSelected] = useState(null);
  const [participants, setParticipants] = useState([]);
  const [onlineUsers, setOnlineUsers] = useState([]);
  const [content, setContent] = useState({});
  const [activity, setActivity] = useState([]);
  const [feedback, setFeedback] = useState([]);
  const [usage, setUsage] = useState([]);
  const [scorecardData, setScorecardData] = useState(null);
  // Research data is heavy (full message bodies, full DM threads) so it
  // lazy-loads only when the admin opens the Research tab. Keyed by
  // workshop id so switching workshops invalidates the cache.
  const [researchData, setResearchData] = useState(null);
  const [researchLoading, setResearchLoading] = useState(false);
  const researchLoadedRef = useRef({ workshopId: null });
  const [expandedPid, setExpandedPid] = useState(null);
  const [detailTab, setDetailTab] = useState('stages');
  const [copied, setCopied] = useState(null);
  const [menuOpen, setMenuOpen] = useState(false);
  // Tracks the most-recently requested workshop selection so stale parallel
  // loads from earlier clicks can self-cancel — see handleSelect below.
  const selectionTokenRef = useRef(null);

  const loadWorkshops = useCallback(async () => {
    setLoading(true);
    const data = await sb.loadAdminWorkshops(user.id);
    setWorkshops(data);
    const s = {};
    await Promise.all(data.map(async w => {
      s[w.id] = await sb.loadWorkshopStats(w.id);
    }));
    setStats(s);
    setLoading(false);
  }, [sb, user.id]);

  useEffect(() => { loadWorkshops(); }, [loadWorkshops]);

  async function handleCreate() {
    const org = newOrg.trim();
    if (!org) return;
    setCreating(true);
    const result = await sb.createWorkshop(org, org, user.id);
    if (result) {
      setShowCreate(false);
      setNewOrg('');
      await loadWorkshops();
    }
    setCreating(false);
  }

  async function handleDelete(workshopId) {
    const ok = await confirm({
      title: 'Delete workshop',
      message: 'Delete this workshop and all its data? This cannot be undone.',
      confirmLabel: 'Delete',
      danger: true,
    });
    if (!ok) return;
    await sb.deleteWorkshop(workshopId);
    if (selected?.id === workshopId) setSelected(null);
    setMenuOpen(false);
    await loadWorkshops();
  }

  async function handleDeprecate(workshopId) {
    const ok = await confirm({
      title: 'Deprecate workshop',
      message: 'Participants will be moved to an ended screen. Data is preserved read-only as a past workshop.',
      confirmLabel: 'Deprecate',
    });
    if (!ok) return;
    await sb.deprecateWorkshop(workshopId);
    if (selected?.id === workshopId) setSelected(prev => prev ? { ...prev, deprecated_at: new Date().toISOString() } : prev);
    setMenuOpen(false);
    await loadWorkshops();
  }

  async function handleReveal(toStage) {
    if (!selected) return;
    const fromStage = selected.current_stage || '1';
    const ok = await confirm({
      title: `Reveal Stage ${toStage}`,
      message: `Reveal Stage ${toStage} (${STAGE_META[toStage]?.label}) to all participants?`,
      confirmLabel: 'Reveal',
    });
    if (!ok) return;
    await sb.revealStage(selected.id, toStage, fromStage, user.id);
    setSelected(prev => prev ? { ...prev, current_stage: toStage } : prev);
    await loadWorkshops();
  }

  // Roll the room back one notch in the stage arc. Facilitator-only safety
  // net for "I clicked Reveal too early." Realtime push to participants
  // hides the un-revealed tabs immediately; their data is preserved
  // server-side, just no longer reachable from the UI until re-revealed.
  async function handleUnreveal() {
    if (!selected) return;
    const current = selected.current_stage || '1';
    const idx = STAGE_ORDER.indexOf(current);
    if (idx <= 0) return;
    const target = STAGE_ORDER[idx - 1];
    const ok = await confirm({
      title: 'Hide latest stage',
      message: `Roll back from Stage ${current} (${STAGE_META[current]?.label}) to Stage ${target} (${STAGE_META[target]?.label})? Participants will lose access to the Stage ${current} surface immediately. Their data is preserved.`,
      confirmLabel: 'Hide',
      danger: true,
    });
    if (!ok) return;
    await sb.unrevealStage(selected.id, target, current, user.id);
    setSelected(prev => prev ? { ...prev, current_stage: target } : prev);
    await loadWorkshops();
  }

  // Walk forward from the current stage to the last one, writing each reveal
  // as its own stage_events row so the audit trail still records the
  // intermediate jumps. Useful for dry-runs / internal reviews where the
  // facilitator doesn't want to click through one at a time.
  async function handleRevealAll() {
    if (!selected) return;
    const lastStage = STAGE_ORDER[STAGE_ORDER.length - 1];
    let cursor = selected.current_stage || '1';
    if (cursor === lastStage) {
      alert('All stages are already revealed.');
      return;
    }
    const remaining = [];
    let walker = nextStage(cursor);
    while (walker) { remaining.push(walker); walker = nextStage(walker); }
    const ok = await confirm({
      title: 'Reveal all remaining stages',
      message: `Reveal all ${remaining.length} remaining stages to every participant now? This skips the pacing. Use only for dry-runs.`,
      confirmLabel: 'Reveal all',
    });
    if (!ok) return;
    // Build per-transition audit rows but commit rooms.current_stage once.
    // Sequential per-stage writes sent N realtime updates to every client
    // (N = remaining stages); with ~35 clients the cumulative fanout locked
    // up the participant UIs during the 2026-04-23 session.
    const transitions = [];
    let trailCursor = cursor;
    for (const s of remaining) {
      transitions.push({ from: trailCursor, to: s });
      trailCursor = s;
    }
    await sb.revealAllStages(selected.id, transitions, lastStage, user.id);
    setSelected(prev => prev ? { ...prev, current_stage: lastStage } : prev);
    await loadWorkshops();
  }

  // Admin can grow the per-participant credit allocation on the fly — useful
  // when the cohort is deeper into the workshop than the initial budget
  // supported, or for dry-runs that need unlimited exploration. The update
  // broadcasts to every participant client via the rooms realtime sub.
  async function handleUpdateCreditAllocation(newAllocation) {
    if (!selected) return;
    const clamped = Math.max(0, Math.floor(Number(newAllocation) || 0));
    const ok = await sb.setCreditAllocation(selected.id, clamped);
    if (!ok) return;
    setSelected(prev => prev ? { ...prev, credit_allocation: clamped } : prev);
    await loadWorkshops();
  }

  async function handleSelect(workshop) {
    setSelected(workshop);
    setDetailTab('stages');
    setMenuOpen(false);
    setScorecardData(null);
    setUsage([]);
    setExpandedPid(null);
    setResearchData(null);
    researchLoadedRef.current = { workshopId: null };
    const requestedId = workshop.id;
    selectionTokenRef.current = requestedId;
    const [p, c, a, sc, fb, uz] = await Promise.all([
      sb.loadWorkshopParticipants(workshop.id),
      sb.loadWorkshopContent(workshop.id),
      sb.loadWorkshopActivity(workshop.id),
      sb.loadAdminScorecardData(workshop.id),
      sb.loadAllFeedback(workshop.id),
      sb.loadAdminWorkshopUsage(workshop.id),
    ]);
    // Guard against rapid-fire clicks: if the admin clicked a different
    // workshop while these loads were in flight, the selection token has
    // moved on and we must not overwrite the newer selection's data with
    // this stale result. Matches the 04-23 "I clicked B but A's data
    // flashed first" symptom.
    if (selectionTokenRef.current !== requestedId) return;
    setParticipants(p);
    setContent(c);
    setActivity(a);
    setScorecardData(sc);
    setFeedback(fb || []);
    setUsage(uz || []);
    const unsub = sb.subscribeToWorkshopPresence(workshop.id, setOnlineUsers);
    return unsub;
  }

  function copyCode(code) {
    navigator.clipboard.writeText(code);
    setCopied(code);
    setTimeout(() => setCopied(null), 2000);
  }

  const onlineNames = new Set(onlineUsers.map(u => u.name));
  // Coworkers have mirror rows in participants (kind='ai') for DM routing.
  // Those are bookkeeping, not people — filter them out of the admin view.
  const humanParticipants = participants.filter(p => (p.kind || 'human') === 'human');
  // Starter seed + platform-assistant output is stamped with synthetic
  // authors (System / Platform Assistant). The admin view reports what
  // the cohort actually built, so those get filtered out across Files,
  // Coworkers, and Workflows. Anything with no author is treated as
  // system scaffolding too — participant creations always carry a name.
  const SYSTEM_AUTHORS = new Set(['System', 'Platform Assistant']);
  const isParticipantAuthored = (item) => {
    const author = item?.created_by || item?.createdBy;
    return !!author && !SYSTEM_AUTHORS.has(author);
  };
  const participantFiles = (content.files || []).filter(f => f.type === 'file' && isParticipantAuthored(f));
  const participantCoworkers = (content.coworkers || []).filter(isParticipantAuthored);
  const participantWorkflows = (content.workflows || []).filter(isParticipantAuthored);
  const active = workshops.filter(w => !w.deprecated_at);
  const past = workshops.filter(w => w.deprecated_at);
  const fileCount = participantFiles.length;
  const folderCount = selected ? (content.files?.filter(f => f.type === 'folder').length || 0) : 0;

  // Compute the overall scorecard level for every human participant in the
  // selected workshop. Reuses the same rubric the participants see at
  // graduation; we just pivot the data per-participant on the admin side.
  // Memoised on the loaded scorecardData so re-renders don't re-walk every
  // workflow run.
  const participantLevels = useMemo(() => {
    if (!scorecardData) return {};
    const fileTree = buildTree(scorecardData.flatFiles || []);
    const out = {};
    for (const p of (scorecardData.participants || [])) {
      if ((p.kind || 'human') !== 'human') continue;
      const msgCount = scorecardData.messageCounts?.[p.name] || 0;
      const conversations = msgCount > 0
        ? [{ kind: 'chat', messages: Array.from({ length: msgCount }, () => ({ type: 'user' })) }]
        : [];
      const userPreferences = p.auth_user_id ? (scorecardData.prefsMap?.[p.auth_user_id] || '') : '';
      const card = computeScorecard({
        userName: p.name,
        conversations,
        coworkers: scorecardData.coworkers,
        workflows: scorecardData.workflows,
        workflowRuns: scorecardData.workflowRuns,
        flatFiles: scorecardData.flatFiles,
        approvals: scorecardData.approvals,
        participants: scorecardData.participants,
        tools: scorecardData.tools,
        fileTree,
        userPreferences,
      });
      out[p.id] = card.overallLevel;
    }
    return out;
  }, [scorecardData]);

  // Index feedback rows by participant_name so each per-person card can
  // pull its submitter's responses (or display a "not submitted" note).
  const feedbackByName = useMemo(() => {
    const map = new Map();
    for (const f of (feedback || [])) {
      if (f.participant_name) map.set(f.participant_name, f);
    }
    return map;
  }, [feedback]);

  // Sum input + output + cache tokens per participant id. Cost is summed
  // alongside so the card can show both raw token volume and dollar spend.
  const tokensByPid = useMemo(() => {
    const out = {};
    for (const r of (usage || [])) {
      const pid = r.participant_id;
      if (!pid) continue;
      const tokens = (r.input_tokens || 0) + (r.output_tokens || 0)
        + (r.cache_creation_input_tokens || 0) + (r.cache_read_input_tokens || 0);
      if (!out[pid]) out[pid] = { tokens: 0, cost: 0 };
      out[pid].tokens += tokens;
      out[pid].cost += Number(r.cost_usd) || 0;
    }
    return out;
  }, [usage]);

  // Sum a participant's 13 scaled feedback scores into a single
  // out-of-65 total. Returns null when the participant hasn't submitted
  // (any null/undefined score collapses the total to "—" so a partial
  // row doesn't get shown as a misleading low number).
  const FEEDBACK_MAX = SCORE_FIELDS.length * 5;
  const totalScoreFor = (fb) => {
    if (!fb) return null;
    let sum = 0;
    for (const f of SCORE_FIELDS) {
      const v = Number(fb[f.key]);
      if (!Number.isFinite(v)) return null;
      sum += v;
    }
    return sum;
  };

  // Leaderboard sort: tokens used desc as the primary axis — engagement
  // is the headline signal facilitators look at first. Ties break by
  // rated-first → avg score desc → alphabetical, so heavy users with
  // strong feedback bubble above heavy users with no feedback.
  const sortedPeople = useMemo(() => {
    const enriched = humanParticipants.map(p => {
      const fb = feedbackByName.get(p.name);
      const tk = tokensByPid[p.id] || { tokens: 0, cost: 0 };
      const totalScore = totalScoreFor(fb);
      const avgScore = totalScore !== null ? totalScore / SCORE_FIELDS.length : null;
      return { p, fb, tk, totalScore, avgScore };
    });
    enriched.sort((a, b) => {
      if (a.tk.tokens !== b.tk.tokens) return b.tk.tokens - a.tk.tokens;
      const aRated = a.avgScore !== null;
      const bRated = b.avgScore !== null;
      if (aRated !== bRated) return aRated ? -1 : 1;
      if (aRated && a.avgScore !== b.avgScore) return b.avgScore - a.avgScore;
      return (a.p.name || '').localeCompare(b.p.name || '');
    });
    return enriched;
  }, [humanParticipants, feedbackByName, tokensByPid]);

  // Lazy-load the research dataset the first time the admin opens the
  // Research tab on this workshop. Subsequent tab switches reuse the
  // cached payload; switching workshops clears it via handleSelect.
  useEffect(() => {
    if (detailTab !== 'research') return;
    if (!selected) return;
    if (researchLoadedRef.current.workshopId === selected.id) return;
    let cancelled = false;
    setResearchLoading(true);
    sb.loadAdminResearchData(selected.id).then(d => {
      if (cancelled) return;
      if (researchLoadedRef.current.workshopId === selected.id) return;
      researchLoadedRef.current = { workshopId: selected.id };
      setResearchData(d);
      setResearchLoading(false);
    }).catch(err => {
      if (cancelled) return;
      console.error('[admin] loadAdminResearchData:', err);
      setResearchLoading(false);
    });
    return () => { cancelled = true; };
  }, [detailTab, selected, sb]);

  function handleDownloadResearchBundle() {
    if (!researchData || !selected) return;
    downloadResearchBundle(researchData, {
      workshopId: selected.id,
      workshopCode: selected.code,
      orgName: selected.org_name,
    });
  }

  function handleDownloadParticipantNotes(participant) {
    if (!researchData || !selected || !participant) return;
    downloadParticipantNotes(participant, researchData, {
      workshopId: selected.id,
      workshopCode: selected.code,
      orgName: selected.org_name,
    });
  }

  // Per-participant engagement counters — what they actually built and
  // sent during the workshop. Lives next to the level + feedback on the
  // participants tab so the facilitator sees the whole person at a glance.
  const engagementByName = useMemo(() => {
    const out = {};
    const files = content.files || [];
    const cws = content.coworkers || [];
    const wfs = content.workflows || [];
    const runs = scorecardData?.workflowRuns || [];
    const msgCounts = scorecardData?.messageCounts || {};
    for (const p of humanParticipants) {
      out[p.name] = {
        messages: msgCounts[p.name] || 0,
        coworkers: cws.filter(c => c.created_by === p.name).length,
        files: files.filter(f => f.type === 'file' && f.created_by === p.name).length,
        workflows: wfs.filter(w => w.created_by === p.name).length,
        runs: runs.filter(r => r.startedBy === p.name).length,
      };
    }
    return out;
  }, [humanParticipants, content, scorecardData]);

  return (
    <div className="admin-shell">
      {/* Top bar */}
      <div className="admin-topbar">
        <div className="admin-topbar-left">
          <div className="landing-logo" style={{ width: 28, height: 28, fontSize: 14 }}>F</div>
          <div className="admin-topbar-ident">
            <span className="admin-topbar-title">Admin</span>
            <span className="admin-topbar-email">{user.email}</span>
          </div>
        </div>
        <div className="admin-topbar-right">
          <button className="admin-btn-ghost" onClick={() => sb.signOut()}>Sign Out</button>
        </div>
      </div>

      <div className="admin-split">
        {/* Left rail */}
        <aside className="admin-rail">
          <div className="admin-rail-header">
            <span className="admin-rail-title">Workshops</span>
            <button className="admin-rail-new" onClick={() => setShowCreate(true)}>+ New</button>
          </div>

          {loading && <div className="admin-rail-empty">Loading…</div>}

          {!loading && workshops.length === 0 && (
            <div className="admin-rail-empty">
              No workshops yet.
              <br />
              <button className="admin-inline-link" onClick={() => setShowCreate(true)}>Create the first one.</button>
            </div>
          )}

          {active.length > 0 && (
            <div className="admin-rail-section">
              <div className="admin-rail-group-label">Active</div>
              {active.map(w => (
                <WorkshopRow
                  key={w.id}
                  w={w}
                  selected={selected?.id === w.id}
                  onSelect={() => handleSelect(w)}
                  copied={copied}
                  onCopy={copyCode}
                  stats={stats[w.id]}
                />
              ))}
            </div>
          )}

          {past.length > 0 && (
            <div className="admin-rail-section">
              <div className="admin-rail-group-label">Past</div>
              {past.map(w => (
                <WorkshopRow
                  key={w.id}
                  w={w}
                  selected={selected?.id === w.id}
                  onSelect={() => handleSelect(w)}
                  copied={copied}
                  onCopy={copyCode}
                  stats={stats[w.id]}
                  dim
                />
              ))}
            </div>
          )}
        </aside>

        {/* Main pane */}
        <main className="admin-main">
          {!selected ? (
            <div className="admin-main-empty">
              <div className="admin-main-empty-title">Select a workshop</div>
              <div className="admin-main-empty-desc">
                Pick one from the left, or{' '}
                <button className="admin-inline-link" onClick={() => setShowCreate(true)}>create a new one</button>
                .
              </div>
            </div>
          ) : (
            <div className="admin-detail">
              {/* Header */}
              <div className="admin-detail-head">
                <div className="admin-detail-titles">
                  <h2>{selected.org_name}</h2>
                  <div className="admin-detail-sub">
                    <span
                      className="admin-detail-code"
                      onClick={() => copyCode(selected.code)}
                      title="Click to copy"
                    >
                      {copied === selected.code ? 'Copied' : selected.code}
                    </span>
                    <span className="admin-detail-sub-sep">·</span>
                    Created {new Date(selected.created_at).toLocaleDateString()}
                    {selected.deprecated_at && (
                      <>
                        <span className="admin-detail-sub-sep">·</span>
                        <span className="admin-detail-sub-dep">Delivered {new Date(selected.deprecated_at).toLocaleDateString()}</span>
                      </>
                    )}
                  </div>
                </div>
                <div className="admin-detail-actions">
                  {/* Enter the selected workshop directly as a participant —
                      bypasses the JoinScreen / typing the code. Works on
                      live and deprecated workshops alike (deprecated rooms
                      still render in read-only mode for audit purposes). */}
                  {onEnterWorkshop && (
                    <button
                      className="admin-btn-primary"
                      onClick={() => onEnterWorkshop(selected.code)}
                    >
                      Enter as participant
                    </button>
                  )}
                  <div className="admin-menu-wrap">
                    <button
                      className="admin-btn-ghost"
                      onClick={() => setMenuOpen(m => !m)}
                      aria-label="Workshop actions"
                    >
                      •••
                    </button>
                    {menuOpen && (
                      <div className="admin-menu" onClick={e => e.stopPropagation()}>
                        {!selected.deprecated_at && (
                          <button className="admin-menu-item" onClick={() => handleDeprecate(selected.id)}>
                            Deprecate
                          </button>
                        )}
                        <button className="admin-menu-item danger" onClick={() => handleDelete(selected.id)}>
                          Delete
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Stats bar */}
              <div className="admin-stats-bar">
                <div className="admin-stat">
                  <div className="admin-stat-num">{humanParticipants.length}</div>
                  <div className="admin-stat-label">Participants</div>
                </div>
                <div className="admin-stat">
                  <div className="admin-stat-num">{onlineUsers.length}</div>
                  <div className="admin-stat-label">Online</div>
                </div>
                <div className="admin-stat">
                  <div className="admin-stat-num">{fileCount}</div>
                  <div className="admin-stat-label">Files</div>
                </div>
                <div className="admin-stat">
                  <div className="admin-stat-num">{participantCoworkers.length}</div>
                  <div className="admin-stat-label">Coworkers</div>
                </div>
                <div className="admin-stat">
                  <div className="admin-stat-num">{participantWorkflows.length}</div>
                  <div className="admin-stat-label">Workflows</div>
                </div>
              </div>

              {/* Workshop-level signal: how the room landed */}
              <WorkshopRecap
                feedback={feedback}
                humanParticipants={humanParticipants}
              />
              <EngagementCurve
                humanParticipants={humanParticipants}
                tokensByPid={tokensByPid}
              />

              {/* Sub-tabs */}
              <div className="admin-tabs">
                {['stages', 'participants', 'content', 'research', 'feedback'].map(tab => (
                  <button
                    key={tab}
                    className={`admin-tab${detailTab === tab ? ' active' : ''}`}
                    onClick={() => setDetailTab(tab)}
                  >
                    {tab.charAt(0).toUpperCase() + tab.slice(1)}
                  </button>
                ))}
              </div>

              {/* Tab content */}
              {detailTab === 'stages' && (
                <div className="admin-tab-content">
                  <AdminCreditAllocation
                    value={selected.credit_allocation ?? 1000}
                    onSave={handleUpdateCreditAllocation}
                    deprecated={!!selected.deprecated_at}
                  />
                  <div className="admin-stage-header">
                    <p className="admin-tab-intro" style={{ margin: 0 }}>
                      Reveal is monotonic: once a stage is revealed, it stays revealed. Sub-stages reveal in order. Current stage:{' '}
                      <strong>{selected.current_stage || '1'}</strong>
                    </p>
                    {!selected.deprecated_at && nextStage(selected.current_stage || '1') && (
                      <button
                        className="admin-stage-reveal-all"
                        onClick={handleRevealAll}
                        title="Reveal every remaining stage at once. Intended for dry-runs, not live facilitation."
                      >
                        Reveal All
                      </button>
                    )}
                  </div>
                  <div className="admin-stage-list">
                    {STAGE_ORDER.map(s => {
                      const meta = STAGE_META[s];
                      const current = selected.current_stage || '1';
                      const isRevealed = stageReached(current, s);
                      const isCurrent = current === s;
                      const canReveal = s === nextStage(current);
                      const isDeprecated = !!selected.deprecated_at;
                      return (
                        <div
                          key={s}
                          className={`admin-stage-row${isCurrent ? ' current' : ''}${isRevealed ? ' revealed' : ''}`}
                        >
                          <span className={`admin-stage-pill${isRevealed ? ' on' : ''}`}>{s}</span>
                          <div className="admin-stage-text">
                            <div className="admin-stage-label">{meta?.label || s}</div>
                            <div className="admin-stage-desc">{meta?.description}</div>
                          </div>
                          <div className="admin-stage-status">
                            {isCurrent ? 'Current' : isRevealed ? 'Revealed' : canReveal ? '' : 'Locked'}
                          </div>
                          {canReveal && !isDeprecated && (
                            <button className="admin-stage-reveal" onClick={() => handleReveal(s)}>
                              Reveal
                            </button>
                          )}
                          {/* Hide button on the current stage — rolls back
                              one notch. Stage 1 has no predecessor, so it
                              never gets one. */}
                          {isCurrent && !isDeprecated && STAGE_ORDER.indexOf(s) > 0 && (
                            <button className="admin-stage-unreveal" onClick={handleUnreveal} title="Roll back one stage">
                              Hide
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                  {selected.deprecated_at && (
                    <p className="admin-tab-note">This workshop is deprecated. Stages cannot be revealed further.</p>
                  )}
                </div>
              )}

              {detailTab === 'participants' && (
                <div className="admin-tab-content">
                  {humanParticipants.length === 0 ? (
                    <p className="admin-empty">No participants yet. Share the code to get started.</p>
                  ) : (
                    <div className="admin-leaderboard">
                      {sortedPeople.map(({ p, fb, tk, totalScore, avgScore }, idx) => {
                        const lvl = participantLevels[p.id];
                        const eng = engagementByName[p.name] || {};
                        const isOpen = expandedPid === p.id;
                        return (
                          <div key={p.id} className={`admin-person-card${isOpen ? ' is-open' : ''}`}>
                            <button
                              type="button"
                              className="admin-person-row"
                              onClick={() => setExpandedPid(isOpen ? null : p.id)}
                              aria-expanded={isOpen}
                            >
                              <span className="admin-person-rank">{idx + 1}</span>
                              <span className="admin-participant-dot" style={{ background: onlineNames.has(p.name) ? 'var(--accent-system)' : 'var(--border-color)' }} />
                              <div className="admin-participant-ident">
                                <span className="admin-participant-name">{p.name}</span>
                                {p.email && <span className="admin-participant-email">{p.email}</span>}
                              </div>
                              {scorecardData && typeof lvl === 'number' && (
                                <span
                                  className="admin-participant-grade"
                                  style={{ background: LEVEL_COLORS[lvl], color: lvl === 0 ? 'var(--text-muted)' : '#fff' }}
                                  title="Graduation scorecard — overall level"
                                >
                                  {LEVELS[lvl]}
                                </span>
                              )}
                              <span className="admin-person-row-stat">
                                <span className="l">Avg</span>
                                <span className="v">{avgScore !== null ? avgScore.toFixed(1) : '—'}</span>
                              </span>
                              <span className="admin-person-row-stat">
                                <span className="l">Tokens</span>
                                <span className="v">{tk.tokens.toLocaleString()}</span>
                              </span>
                              <span className="admin-person-row-chevron" aria-hidden>{isOpen ? '▾' : '▸'}</span>
                            </button>

                            {isOpen && (
                              <div className="admin-person-detail">
                                <div className="admin-person-headline">
                                  <div className="admin-person-headline-stat">
                                    <span className="l">Total score</span>
                                    <span className="v">
                                      {totalScore !== null ? `${totalScore} / ${FEEDBACK_MAX}` : '—'}
                                    </span>
                                    {avgScore !== null && (
                                      <span className="sub">avg {avgScore.toFixed(1)} / 5</span>
                                    )}
                                  </div>
                                  <div className="admin-person-headline-stat">
                                    <span className="l">Tokens used</span>
                                    <span className="v">{tk.tokens.toLocaleString()}</span>
                                    {tk.cost > 0 && (
                                      <span className="sub">${tk.cost.toFixed(2)}</span>
                                    )}
                                  </div>
                                  <div className="admin-person-headline-stat">
                                    <span className="l">Status</span>
                                    <span className="v">{onlineNames.has(p.name) ? 'Online' : 'Offline'}</span>
                                  </div>
                                  <div className="admin-person-headline-stat">
                                    <span className="l">Joined</span>
                                    <span className="v">{new Date(p.joined_at).toLocaleDateString()}</span>
                                  </div>
                                </div>

                                <div className="admin-person-section">
                                  <div className="admin-person-section-label">Engagement</div>
                                  <div className="admin-person-stats">
                                    <div className="admin-person-stat"><span className="v">{eng.messages || 0}</span><span className="l">messages</span></div>
                                    <div className="admin-person-stat"><span className="v">{eng.coworkers || 0}</span><span className="l">coworkers</span></div>
                                    <div className="admin-person-stat"><span className="v">{eng.files || 0}</span><span className="l">files</span></div>
                                    <div className="admin-person-stat"><span className="v">{eng.workflows || 0}</span><span className="l">workflows</span></div>
                                    <div className="admin-person-stat"><span className="v">{eng.runs || 0}</span><span className="l">runs</span></div>
                                  </div>
                                </div>

                                <div className="admin-person-section">
                                  <div className="admin-person-section-label">Feedback</div>
                                  {fb ? (
                                    <div className="admin-person-feedback">
                                      <div className="admin-person-scores">
                                        {SCORE_FIELDS.map(f => (
                                          <div key={f.key} className="admin-person-score">
                                            <span className="l">{f.label}</span>
                                            <span className="v">{fb[f.key] ?? '—'}</span>
                                          </div>
                                        ))}
                                      </div>
                                      <div className="admin-person-binary">
                                        Recommend: <strong>{fb.would_recommend === true ? 'Yes' : fb.would_recommend === false ? 'No' : '—'}</strong>
                                        {' · '}
                                        Duration ok: <strong>{fb.duration_appropriate === true ? 'Yes' : fb.duration_appropriate === false ? 'No' : '—'}</strong>
                                      </div>
                                      {fb.most_valuable && (<div className="admin-person-text"><span className="l">Most valuable</span><div>{fb.most_valuable}</div></div>)}
                                      {fb.future_topics && (<div className="admin-person-text"><span className="l">Future topics</span><div>{fb.future_topics}</div></div>)}
                                      {fb.improvement_notes && (<div className="admin-person-text"><span className="l">Suggestions</span><div>{fb.improvement_notes}</div></div>)}
                                    </div>
                                  ) : (
                                    <div className="admin-person-feedback-empty">Hasn't submitted feedback yet.</div>
                                  )}
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              {detailTab === 'content' && (
                <div className="admin-tab-content">
                  <div className="admin-content-section">
                    <h3 className="admin-content-title">Coworkers ({participantCoworkers.length})</h3>
                    {participantCoworkers.map(cw => (
                      <div key={cw.id} className="admin-content-item">
                        <span className="admin-content-avatar" style={{ background: cw.color || '#4a7fb5' }}>{cw.avatar?.startsWith('icon:') ? '?' : (cw.avatar || '?')}</span>
                        <div>
                          <div className="admin-content-name">{cw.name}</div>
                          <div className="admin-content-meta">{cw.role?.slice(0, 60) || 'No role'}{cw.role?.length > 60 ? '...' : ''}</div>
                        </div>
                        {cw.created_by && <span className="admin-content-by">by {cw.created_by}</span>}
                      </div>
                    ))}
                    {participantCoworkers.length === 0 && <p className="admin-empty">No coworkers built by participants yet.</p>}
                  </div>

                  <div className="admin-content-section">
                    <h3 className="admin-content-title">Files ({fileCount} files, {folderCount} folders)</h3>
                    {participantFiles.map(f => (
                      <div key={f.id} className="admin-content-item">
                        <span style={{ fontSize: 14, opacity: 0.5 }}>{'\uD83D\uDCC4'}</span>
                        <div>
                          <div className="admin-content-name">{f.name}</div>
                          {f.created_by && <div className="admin-content-meta">by {f.created_by}</div>}
                        </div>
                      </div>
                    ))}
                    {fileCount === 0 && <p className="admin-empty">No files uploaded by participants yet.</p>}
                  </div>

                  <div className="admin-content-section">
                    <h3 className="admin-content-title">Workflows ({participantWorkflows.length})</h3>
                    {participantWorkflows.map(wf => (
                      <div key={wf.id} className="admin-content-item">
                        <span style={{ fontSize: 14, opacity: 0.5 }}>{'\uD83D\uDD04'}</span>
                        <div>
                          <div className="admin-content-name">{wf.name}</div>
                          <div className="admin-content-meta">{wf.steps?.length || 0} steps{wf.created_by ? ` · by ${wf.created_by}` : ''}</div>
                        </div>
                      </div>
                    ))}
                    {participantWorkflows.length === 0 && <p className="admin-empty">No workflows built by participants yet.</p>}
                  </div>
                </div>
              )}

              {detailTab === 'research' && (
                <div className="admin-tab-content">
                  <ResearchView
                    data={researchData}
                    loading={researchLoading}
                    onDownloadBundle={handleDownloadResearchBundle}
                    onDownloadParticipant={handleDownloadParticipantNotes}
                  />
                </div>
              )}

              {detailTab === 'feedback' && (
                <div className="admin-tab-content">
                  <FeedbackResponses rows={feedback} />
                </div>
              )}
            </div>
          )}
        </main>
      </div>

      {/* Create modal */}
      {showCreate && (
        <div className="modal-overlay" onClick={() => setShowCreate(false)}>
          <div className="modal-box" style={{ maxWidth: 440 }} onClick={e => e.stopPropagation()}>
            <h3>Create Workshop</h3>
            <p style={{ fontSize: 14, color: 'var(--text-muted)', marginBottom: 20 }}>
              A unique code will be generated for participants to join. The organization name appears under the Foundry logo for everyone in the room.
            </p>
            <div className="landing-field" style={{ marginBottom: 16 }}>
              <label>Organization</label>
              <input
                type="text" value={newOrg} onChange={e => setNewOrg(e.target.value)}
                placeholder="e.g., Apex Bank" autoFocus
                onKeyDown={e => e.key === 'Enter' && handleCreate()}
              />
            </div>
            <div className="modal-actions">
              <button className="modal-btn cancel" onClick={() => setShowCreate(false)}>Cancel</button>
              <button className="landing-join-btn" style={{ width: 'auto', padding: '10px 24px' }} onClick={handleCreate} disabled={!newOrg.trim() || creating}>
                {creating ? 'Creating...' : 'Create Workshop'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Workshop Recap — five headline numbers compressing "how the room landed"
// into one strip. NPS is a -100..+100 collapse of would_recommend (no
// passives — this isn't a 0-10 scale, just promoter % minus detractor %).
// Trainer is a composite of the three trainer-specific scores so it reads
// as a single brand metric.
function WorkshopRecap({ feedback, humanParticipants }) {
  const responseCount = feedback.length;
  const totalCount = humanParticipants.length;
  const responseRate = totalCount > 0 ? Math.round((responseCount / totalCount) * 100) : 0;

  let promoters = 0, detractors = 0, recommendRows = 0;
  for (const f of feedback) {
    if (f.would_recommend === true) { promoters++; recommendRows++; }
    else if (f.would_recommend === false) { detractors++; recommendRows++; }
  }
  const nps = recommendRows > 0
    ? Math.round((promoters / recommendRows) * 100 - (detractors / recommendRows) * 100)
    : null;

  const avgOf = (field) => {
    const vals = feedback.map(r => Number(r[field])).filter(v => Number.isFinite(v));
    return vals.length > 0 ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
  };
  const avgSatisfaction = avgOf('satisfaction');
  const avgImproved = avgOf('improved_skills');
  // Trainer composite reflects only trainer-skill columns (clarity +
  // pacing) — trainer_engagement now holds workshop-content rating, so
  // mixing it back in would muddy the Recap tile.
  const trainerComposite = (() => {
    const parts = ['trainer_knowledge', 'trainer_delivery'].map(avgOf).filter(v => v !== null);
    if (parts.length === 0) return null;
    return parts.reduce((a, b) => a + b, 0) / parts.length;
  })();

  const fmtScore = (v) => v === null ? '—' : v.toFixed(1);
  const fmtNps = (v) => v === null ? '—' : (v > 0 ? `+${v}` : `${v}`);

  return (
    <div className="admin-recap">
      <div className="admin-recap-eyebrow">Workshop recap</div>
      <div className="admin-recap-stats">
        <div className="admin-recap-stat is-headline">
          <span className="admin-recap-stat-label">NPS</span>
          <span className="admin-recap-stat-value">{fmtNps(nps)}</span>
          <span className="admin-recap-stat-hint">{recommendRows ? `${recommendRows} responded` : 'No responses yet'}</span>
        </div>
        <div className="admin-recap-stat">
          <span className="admin-recap-stat-label">Satisfaction</span>
          <span className="admin-recap-stat-value">{fmtScore(avgSatisfaction)}</span>
          <span className="admin-recap-stat-hint">of 5</span>
        </div>
        <div className="admin-recap-stat">
          <span className="admin-recap-stat-label">Improved skills</span>
          <span className="admin-recap-stat-value">{fmtScore(avgImproved)}</span>
          <span className="admin-recap-stat-hint">of 5</span>
        </div>
        <div className="admin-recap-stat">
          <span className="admin-recap-stat-label">Trainer</span>
          <span className="admin-recap-stat-value">{fmtScore(trainerComposite)}</span>
          <span className="admin-recap-stat-hint">composite of 5</span>
        </div>
        <div className="admin-recap-stat">
          <span className="admin-recap-stat-label">Response rate</span>
          <span className="admin-recap-stat-value">{`${responseRate}%`}</span>
          <span className="admin-recap-stat-hint">{`${responseCount} of ${totalCount}`}</span>
        </div>
      </div>
    </div>
  );
}

// Engagement curve — sorted token usage across the cohort. Tells you at
// a glance whether 5 power users carried the room or it moved together.
// The eyebrow line summarises the gap explicitly so the bars are
// supporting evidence, not the only signal.
function EngagementCurve({ humanParticipants, tokensByPid }) {
  const list = humanParticipants.map(p => ({
    name: p.name,
    tokens: (tokensByPid[p.id] || { tokens: 0 }).tokens,
  }));
  list.sort((a, b) => b.tokens - a.tokens);

  const total = list.reduce((a, b) => a + b.tokens, 0);
  const max = list.length > 0 ? list[0].tokens : 0;
  if (list.length === 0 || max === 0) return null;

  const mid = Math.floor(list.length / 2);
  const median = list.length % 2 === 0 && list.length > 0
    ? (list[mid - 1].tokens + list[mid].tokens) / 2
    : list[mid].tokens;

  const top20Count = Math.max(1, Math.floor(list.length * 0.2));
  const top20 = list.slice(0, top20Count).reduce((a, b) => a + b.tokens, 0);
  const bottom20 = list.slice(-top20Count).reduce((a, b) => a + b.tokens, 0);
  const top20Pct = total > 0 ? Math.round((top20 / total) * 100) : 0;
  const bottom20Pct = total > 0 ? Math.round((bottom20 / total) * 100) : 0;

  return (
    <div className="admin-engagement">
      <div className="admin-engagement-head">
        <span className="admin-recap-eyebrow">Engagement curve</span>
        <span className="admin-engagement-meta">
          Top 20% used <strong>{top20Pct}%</strong> of tokens · Bottom 20% used <strong>{bottom20Pct}%</strong> · Median <strong>{Math.round(median).toLocaleString()}</strong>
        </span>
      </div>
      <div className="admin-engagement-bars" role="img" aria-label={`${list.length} participants ranked by token usage`}>
        {list.map((s, i) => (
          <div
            key={`${s.name}-${i}`}
            className="admin-engagement-bar"
            style={{ height: `${Math.max(2, (s.tokens / max) * 100)}%` }}
            title={`${s.name}: ${s.tokens.toLocaleString()} tokens`}
          />
        ))}
      </div>
    </div>
  );
}

// Renders cohort feedback in two parts: a summary strip with response count
// and average score per scaled question, then a list of individual rows
// (most recent first) including any free-text answers. Anonymous-feeling but
// still attributable so the trainer can reach out on specific responses.
// SCORE_FIELDS is declared at module scope above so the per-participant
// card on the participants tab can pull from the same list.
function FeedbackResponses({ rows }) {
  if (!rows || rows.length === 0) {
    return <p className="admin-feedback-empty">No feedback submitted yet.</p>;
  }

  // Cohort averages — mean of each scale field across submitted rows.
  const summary = SCORE_FIELDS.map(f => {
    const vals = rows.map(r => Number(r[f.key])).filter(v => !isNaN(v));
    const avg = vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : 0;
    return { ...f, avg };
  });
  const yesShare = (key) => {
    const vals = rows.map(r => r[key]).filter(v => v === true || v === false);
    if (vals.length === 0) return null;
    return Math.round((vals.filter(v => v === true).length / vals.length) * 100);
  };
  const durationYes = yesShare('duration_appropriate');
  const recommendYes = yesShare('would_recommend');

  return (
    <>
      <div className="admin-feedback-summary">
        <div className="admin-feedback-stat">
          <div className="admin-feedback-stat-label">Responses</div>
          <div className="admin-feedback-stat-value">{rows.length}</div>
        </div>
        {summary.map(s => (
          <div key={s.key} className="admin-feedback-stat">
            <div className="admin-feedback-stat-label">{s.label}</div>
            <div className="admin-feedback-stat-value">{s.avg.toFixed(1)}</div>
          </div>
        ))}
        {durationYes !== null && (
          <div className="admin-feedback-stat">
            <div className="admin-feedback-stat-label">Duration ok</div>
            <div className="admin-feedback-stat-value">{durationYes}%</div>
          </div>
        )}
        {recommendYes !== null && (
          <div className="admin-feedback-stat">
            <div className="admin-feedback-stat-label">Would recommend</div>
            <div className="admin-feedback-stat-value">{recommendYes}%</div>
          </div>
        )}
      </div>

      <div className="admin-feedback-list">
        {rows.map(r => (
          <div key={r.id} className="admin-feedback-row">
            <div className="admin-feedback-who">
              <span className="admin-feedback-name">{r.participant_name || 'Anonymous'}</span>
              <span className="admin-feedback-when">{r.created_at ? new Date(r.created_at).toLocaleString() : ''}</span>
            </div>
            <div className="admin-feedback-scores">
              {SCORE_FIELDS.map(f => (
                <div key={f.key} className="admin-feedback-score-cell">
                  {f.label}: <strong>{r[f.key] ?? '—'}</strong>
                </div>
              ))}
              <div className="admin-feedback-score-cell">
                Duration ok: <strong>{r.duration_appropriate === true ? 'Yes' : r.duration_appropriate === false ? 'No' : '—'}</strong>
              </div>
              <div className="admin-feedback-score-cell">
                Recommend: <strong>{r.would_recommend === true ? 'Yes' : r.would_recommend === false ? 'No' : '—'}</strong>
              </div>
            </div>
            {r.most_valuable && (
              <>
                <div className="admin-feedback-text-label">Most valuable</div>
                <div className="admin-feedback-text">{r.most_valuable}</div>
              </>
            )}
            {r.future_topics && (
              <>
                <div className="admin-feedback-text-label">Future topics</div>
                <div className="admin-feedback-text">{r.future_topics}</div>
              </>
            )}
            {r.improvement_notes && (
              <>
                <div className="admin-feedback-text-label">Suggestions</div>
                <div className="admin-feedback-text">{r.improvement_notes}</div>
              </>
            )}
          </div>
        ))}
      </div>
    </>
  );
}
