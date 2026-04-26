import { useState, useEffect, useCallback, useRef } from 'react';
import { STAGE_ORDER, STAGE_META, stageReached, nextStage } from './RevealAt';
import { useConfirm } from './ConfirmDialog';

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

export default function AdminDashboard({ sb, user, onBack }) {
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
      message: `Reveal all ${remaining.length} remaining stages to every participant now? This skips the pacing — use only for dry-runs.`,
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
    const requestedId = workshop.id;
    selectionTokenRef.current = requestedId;
    const [p, c, a] = await Promise.all([
      sb.loadWorkshopParticipants(workshop.id),
      sb.loadWorkshopContent(workshop.id),
      sb.loadWorkshopActivity(workshop.id),
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
          <button className="admin-btn-ghost" onClick={onBack}>Enter Workshop</button>
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
                Pick one from the left — or{' '}
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

              {/* Sub-tabs */}
              <div className="admin-tabs">
                {['stages', 'participants', 'content', 'activity'].map(tab => (
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
                      Reveal is monotonic — once a stage is revealed, it stays revealed. Sub-stages reveal in order. Current stage:{' '}
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
                    <p className="admin-tab-note">This workshop is deprecated — stages cannot be revealed further.</p>
                  )}
                </div>
              )}

              {detailTab === 'participants' && (
                <div className="admin-tab-content">
                  {humanParticipants.length === 0 ? (
                    <p className="admin-empty">No participants yet. Share the code to get started.</p>
                  ) : (
                    <div className="admin-participants">
                      {humanParticipants.map(p => (
                        <div key={p.id} className="admin-participant">
                          <span className="admin-participant-dot" style={{ background: onlineNames.has(p.name) ? 'var(--accent-system)' : 'var(--border-color)' }} />
                          <span className="admin-participant-name">{p.name}</span>
                          <span className="admin-participant-status">{onlineNames.has(p.name) ? 'Online' : 'Offline'}</span>
                          <span className="admin-participant-time">Joined {new Date(p.joined_at).toLocaleDateString()}</span>
                        </div>
                      ))}
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

              {detailTab === 'activity' && (
                <div className="admin-tab-content">
                  {activity.length === 0 ? (
                    <p className="admin-empty">No activity yet.</p>
                  ) : (
                    <div className="admin-activity">
                      {activity.map(a => (
                        <div key={a.id} className="admin-activity-item">
                          <span className="admin-activity-time">{new Date(a.created_at).toLocaleTimeString()}</span>
                          <span className="admin-activity-user">{a.participant_name || a.label || 'System'}</span>
                          <span className="admin-activity-content">{a.content?.slice(0, 80) || a.type}{a.content?.length > 80 ? '...' : ''}</span>
                        </div>
                      ))}
                    </div>
                  )}
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
