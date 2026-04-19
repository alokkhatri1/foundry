import { useState, useEffect, useCallback } from 'react';
import { STAGE_ORDER, STAGE_META, stageReached, nextStage } from './RevealAt';

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
  const [workshops, setWorkshops] = useState([]);
  const [stats, setStats] = useState({});
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');
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
    if (!newName.trim()) return;
    setCreating(true);
    const result = await sb.createWorkshop(newName.trim(), newOrg.trim() || newName.trim(), user.id);
    if (result) {
      setShowCreate(false);
      setNewName('');
      setNewOrg('');
      await loadWorkshops();
    }
    setCreating(false);
  }

  async function handleDelete(workshopId) {
    if (!confirm('Delete this workshop and all its data? This cannot be undone.')) return;
    await sb.deleteWorkshop(workshopId);
    if (selected?.id === workshopId) setSelected(null);
    setMenuOpen(false);
    await loadWorkshops();
  }

  async function handleDeprecate(workshopId) {
    if (!confirm('Deprecate this workshop? Participants will be moved to an ended screen. Data is preserved read-only as a past workshop.')) return;
    await sb.deprecateWorkshop(workshopId);
    if (selected?.id === workshopId) setSelected(prev => prev ? { ...prev, deprecated_at: new Date().toISOString() } : prev);
    setMenuOpen(false);
    await loadWorkshops();
  }

  async function handleReveal(toStage) {
    if (!selected) return;
    const fromStage = selected.current_stage || '1';
    if (!confirm(`Reveal Stage ${toStage} (${STAGE_META[toStage]?.label}) to all participants? This is one-way — reveal is monotonic.`)) return;
    await sb.revealStage(selected.id, toStage, fromStage, user.id);
    setSelected(prev => prev ? { ...prev, current_stage: toStage } : prev);
    await loadWorkshops();
  }

  async function handleSelect(workshop) {
    setSelected(workshop);
    setDetailTab('stages');
    setMenuOpen(false);
    const [p, c, a] = await Promise.all([
      sb.loadWorkshopParticipants(workshop.id),
      sb.loadWorkshopContent(workshop.id),
      sb.loadWorkshopActivity(workshop.id),
    ]);
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
  const active = workshops.filter(w => !w.deprecated_at);
  const past = workshops.filter(w => w.deprecated_at);
  const fileCount = selected ? (content.files?.filter(f => f.type === 'file').length || 0) : 0;
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
                  <div className="admin-stat-num">{participants.length}</div>
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
                  <div className="admin-stat-num">{content.coworkers?.length || 0}</div>
                  <div className="admin-stat-label">Coworkers</div>
                </div>
                <div className="admin-stat">
                  <div className="admin-stat-num">{content.workflows?.length || 0}</div>
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
                  <p className="admin-tab-intro">
                    Reveal is monotonic — once a stage is revealed, it stays revealed. Sub-stages reveal in order. Current stage:{' '}
                    <strong>{selected.current_stage || '1'}</strong>
                  </p>
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
                  {participants.length === 0 ? (
                    <p className="admin-empty">No participants yet. Share the code to get started.</p>
                  ) : (
                    <div className="admin-participants">
                      {participants.map(p => (
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
                    <h3 className="admin-content-title">Coworkers ({content.coworkers?.length || 0})</h3>
                    {(content.coworkers || []).map(cw => (
                      <div key={cw.id} className="admin-content-item">
                        <span className="admin-content-avatar" style={{ background: cw.color || '#4a7fb5' }}>{cw.avatar?.startsWith('icon:') ? '?' : (cw.avatar || '?')}</span>
                        <div>
                          <div className="admin-content-name">{cw.name}</div>
                          <div className="admin-content-meta">{cw.role?.slice(0, 60) || 'No role'}{cw.role?.length > 60 ? '...' : ''}</div>
                        </div>
                        {cw.created_by && <span className="admin-content-by">by {cw.created_by}</span>}
                      </div>
                    ))}
                    {(content.coworkers || []).length === 0 && <p className="admin-empty">No coworkers created yet.</p>}
                  </div>

                  <div className="admin-content-section">
                    <h3 className="admin-content-title">Files ({fileCount} files, {folderCount} folders)</h3>
                    {(content.files || []).filter(f => f.type === 'file').map(f => (
                      <div key={f.id} className="admin-content-item">
                        <span style={{ fontSize: 14, opacity: 0.5 }}>{'\uD83D\uDCC4'}</span>
                        <div className="admin-content-name">{f.name}</div>
                      </div>
                    ))}
                    {fileCount === 0 && <p className="admin-empty">No files created yet.</p>}
                  </div>

                  <div className="admin-content-section">
                    <h3 className="admin-content-title">Workflows ({content.workflows?.length || 0})</h3>
                    {(content.workflows || []).map(wf => (
                      <div key={wf.id} className="admin-content-item">
                        <span style={{ fontSize: 14, opacity: 0.5 }}>{'\uD83D\uDD04'}</span>
                        <div>
                          <div className="admin-content-name">{wf.name}</div>
                          <div className="admin-content-meta">{wf.steps?.length || 0} steps</div>
                        </div>
                      </div>
                    ))}
                    {(content.workflows || []).length === 0 && <p className="admin-empty">No workflows created yet.</p>}
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
              A unique code will be generated for participants to join.
            </p>
            <div className="landing-field" style={{ marginBottom: 12 }}>
              <label>Workshop Name</label>
              <input
                type="text" value={newName} onChange={e => setNewName(e.target.value)}
                placeholder="e.g., AI Coworkers Workshop" autoFocus
                onKeyDown={e => e.key === 'Enter' && handleCreate()}
              />
            </div>
            <div className="landing-field" style={{ marginBottom: 16 }}>
              <label>Organization</label>
              <input
                type="text" value={newOrg} onChange={e => setNewOrg(e.target.value)}
                placeholder="e.g., Apex Bank"
              />
            </div>
            <div className="modal-actions">
              <button className="modal-btn cancel" onClick={() => setShowCreate(false)}>Cancel</button>
              <button className="landing-join-btn" style={{ width: 'auto', padding: '10px 24px' }} onClick={handleCreate} disabled={!newName.trim() || creating}>
                {creating ? 'Creating...' : 'Create Workshop'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
