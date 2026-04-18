import { useState, useEffect, useCallback } from 'react';

export default function AdminDashboard({ sb, user, onBack }) {
  const [workshops, setWorkshops] = useState([]);
  const [stats, setStats] = useState({});
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');
  const [newOrg, setNewOrg] = useState('');
  const [seedContent, setSeedContent] = useState(true);
  const [creating, setCreating] = useState(false);
  const [selected, setSelected] = useState(null);
  const [participants, setParticipants] = useState([]);
  const [onlineUsers, setOnlineUsers] = useState([]);
  const [content, setContent] = useState({});
  const [activity, setActivity] = useState([]);
  const [detailTab, setDetailTab] = useState('participants');
  const [copied, setCopied] = useState(null);

  const loadWorkshops = useCallback(async () => {
    setLoading(true);
    const data = await sb.loadAdminWorkshops(user.id);
    setWorkshops(data);
    // Load stats for each workshop
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
      if (seedContent) await sb.seedWorkshopContent(result.id);
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
    await loadWorkshops();
  }

  async function handleDeprecate(workshopId) {
    if (!confirm('Deprecate this workshop? Participants will be moved to an ended screen. Data is preserved read-only as a past workshop.')) return;
    await sb.deprecateWorkshop(workshopId);
    if (selected?.id === workshopId) setSelected(null);
    await loadWorkshops();
  }

  async function handleSelect(workshop) {
    setSelected(workshop);
    setDetailTab('participants');
    const [p, c, a] = await Promise.all([
      sb.loadWorkshopParticipants(workshop.id),
      sb.loadWorkshopContent(workshop.id),
      sb.loadWorkshopActivity(workshop.id),
    ]);
    setParticipants(p);
    setContent(c);
    setActivity(a);
    // Subscribe to presence
    const unsub = sb.subscribeToWorkshopPresence(workshop.id, setOnlineUsers);
    return unsub;
  }

  function copyCode(code) {
    navigator.clipboard.writeText(code);
    setCopied(code);
    setTimeout(() => setCopied(null), 2000);
  }

  const onlineNames = new Set(onlineUsers.map(u => u.name));

  // ===== Detail view =====
  if (selected) {
    const st = stats[selected.id] || {};
    const fileCount = content.files?.filter(f => f.type === 'file').length || 0;
    const folderCount = content.files?.filter(f => f.type === 'folder').length || 0;

    return (
      <div className="admin-dash">
        <div className="admin-header">
          <div className="admin-header-left">
            <div className="landing-logo" style={{ width: 32, height: 32, fontSize: 16 }}>F</div>
            <div>
              <h1 className="admin-title">{selected.org_name}</h1>
              <span className="admin-email">{user.email}</span>
            </div>
          </div>
          <div className="admin-header-right">
            <button className="admin-btn-secondary" onClick={onBack}>Enter Workshop</button>
            <button className="admin-btn-secondary" onClick={() => sb.signOut()}>Sign Out</button>
          </div>
        </div>

        <div className="admin-body">
          <button className="admin-back-btn" onClick={() => setSelected(null)}>{'\u2190'} All Workshops</button>

          <div className="admin-detail-top">
            <div>
              <h2 className="admin-detail-name">{selected.org_name}</h2>
              <div className="admin-detail-meta">Created {new Date(selected.created_at).toLocaleDateString()}</div>
            </div>
            <div className="admin-code-box" onClick={() => copyCode(selected.code)}>
              <div className="admin-code-label">Workshop Code</div>
              <div className="admin-code-value">{selected.code}</div>
              <div className="admin-code-copy">{copied === selected.code ? 'Copied!' : 'Click to copy'}</div>
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

          {/* Tabs */}
          <div className="admin-tabs">
            {['participants', 'content', 'activity'].map(tab => (
              <button key={tab} className={`admin-tab${detailTab === tab ? ' active' : ''}`} onClick={() => setDetailTab(tab)}>
                {tab.charAt(0).toUpperCase() + tab.slice(1)}
              </button>
            ))}
          </div>

          {/* Tab content */}
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
              {/* Coworkers */}
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

              {/* Files */}
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

              {/* Workflows */}
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
      </div>
    );
  }

  // ===== Workshop list =====
  return (
    <div className="admin-dash">
      <div className="admin-header">
        <div className="admin-header-left">
          <div className="landing-logo" style={{ width: 32, height: 32, fontSize: 16 }}>F</div>
          <div>
            <h1 className="admin-title">Admin Dashboard</h1>
            <span className="admin-email">{user.email}</span>
          </div>
        </div>
        <div className="admin-header-right">
          <button className="admin-btn-secondary" onClick={onBack}>Enter Workshop</button>
          <button className="admin-btn-secondary" onClick={() => sb.signOut()}>Sign Out</button>
        </div>
      </div>

      <div className="admin-body">
        <div className="admin-list-header">
          <h2 className="admin-list-title">Your Workshops</h2>
          <button className="landing-join-btn" style={{ width: 'auto', padding: '10px 24px' }} onClick={() => setShowCreate(true)}>
            + New Workshop
          </button>
        </div>

        {loading ? (
          <p className="admin-empty">Loading...</p>
        ) : workshops.length === 0 ? (
          <div className="admin-empty-state">
            <p style={{ fontSize: 16, marginBottom: 8 }}>No workshops yet.</p>
            <p style={{ fontSize: 14, color: 'var(--text-muted)', marginBottom: 16 }}>Create your first workshop to get started.</p>
            <button className="landing-join-btn" style={{ width: 'auto', padding: '10px 24px' }} onClick={() => setShowCreate(true)}>
              Create Workshop
            </button>
          </div>
        ) : (
          <>
            {workshops.filter(w => !w.deprecated_at).length > 0 && (
              <div className="admin-grid">
                {workshops.filter(w => !w.deprecated_at).map(w => {
                  const s = stats[w.id] || {};
                  return (
                    <div key={w.id} className="admin-workshop-card">
                      <div className="admin-card-top" onClick={() => handleSelect(w)}>
                        <div className="admin-workshop-name">{w.org_name}</div>
                        <div className="admin-workshop-code-display" onClick={e => { e.stopPropagation(); copyCode(w.code); }}>
                          {w.code}
                          <span className="admin-copy-hint">{copied === w.code ? 'Copied!' : 'Copy'}</span>
                        </div>
                      </div>
                      <div className="admin-card-stats" onClick={() => handleSelect(w)}>
                        <span>{s.participants || 0} participants</span>
                        <span>{s.files || 0} files</span>
                        <span>{s.coworkers || 0} coworkers</span>
                      </div>
                      <div className="admin-card-footer">
                        <span className="admin-workshop-date">{new Date(w.created_at).toLocaleDateString()}</span>
                        <div style={{ display: 'flex', gap: 8 }}>
                          <button className="admin-delete-btn" onClick={e => { e.stopPropagation(); handleDeprecate(w.id); }}>Deprecate</button>
                          <button className="admin-delete-btn" onClick={e => { e.stopPropagation(); handleDelete(w.id); }}>Delete</button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {workshops.filter(w => w.deprecated_at).length > 0 && (
              <div style={{ marginTop: 40 }}>
                <h2 className="admin-list-title" style={{ opacity: 0.7 }}>Past Workshops</h2>
                <div className="admin-grid">
                  {workshops.filter(w => w.deprecated_at).map(w => {
                    const s = stats[w.id] || {};
                    return (
                      <div key={w.id} className="admin-workshop-card" style={{ opacity: 0.75 }}>
                        <div className="admin-card-top" onClick={() => handleSelect(w)}>
                          <div className="admin-workshop-name">{w.org_name}</div>
                          <div className="admin-workshop-code-display">{w.code}</div>
                        </div>
                        <div className="admin-card-stats" onClick={() => handleSelect(w)}>
                          <span>{s.participants || 0} participants</span>
                          <span>{s.files || 0} files</span>
                          <span>{s.coworkers || 0} coworkers</span>
                        </div>
                        <div className="admin-card-footer">
                          <span className="admin-workshop-date">Delivered {new Date(w.deprecated_at).toLocaleDateString()}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </>
        )}
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
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, color: 'var(--text-body)', marginBottom: 16, cursor: 'pointer' }}>
              <input type="checkbox" checked={seedContent} onChange={e => setSeedContent(e.target.checked)} />
              Include starter content (files, coworkers, workflow)
            </label>
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
