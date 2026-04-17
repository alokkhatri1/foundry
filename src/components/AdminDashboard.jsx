import { useState, useEffect } from 'react';

export default function AdminDashboard({ sb, user, onBack }) {
  const [workshops, setWorkshops] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');
  const [newOrg, setNewOrg] = useState('');
  const [creating, setCreating] = useState(false);
  const [selectedWorkshop, setSelectedWorkshop] = useState(null);
  const [participants, setParticipants] = useState([]);

  useEffect(() => {
    loadWorkshops();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function loadWorkshops() {
    setLoading(true);
    const data = await sb.loadAdminWorkshops(user.id);
    setWorkshops(data);
    setLoading(false);
  }

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

  async function handleSelectWorkshop(workshop) {
    setSelectedWorkshop(workshop);
    const data = await sb.loadWorkshopParticipants(workshop.id);
    setParticipants(data);
  }

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
          <button className="admin-btn-secondary" onClick={onBack}>Back to Workshop</button>
          <button className="admin-btn-secondary" onClick={() => sb.signOut()}>Sign Out</button>
        </div>
      </div>

      <div className="admin-body">
        {/* Workshop detail */}
        {selectedWorkshop ? (
          <div className="admin-detail">
            <button className="admin-back-btn" onClick={() => setSelectedWorkshop(null)}>{'\u2190'} All Workshops</button>
            <div className="admin-detail-header">
              <div>
                <h2 className="admin-detail-name">{selectedWorkshop.org_name}</h2>
                <div className="admin-detail-meta">
                  Created {new Date(selectedWorkshop.created_at).toLocaleDateString()}
                </div>
              </div>
              <div className="admin-code-display">
                <div className="admin-code-label">Workshop Code</div>
                <div className="admin-code-value">{selectedWorkshop.code}</div>
              </div>
            </div>

            <div className="admin-section">
              <h3 className="admin-section-title">Participants ({participants.length})</h3>
              {participants.length === 0 ? (
                <p className="admin-empty">No participants yet. Share the code to get started.</p>
              ) : (
                <div className="admin-participants">
                  {participants.map(p => (
                    <div key={p.id} className="admin-participant">
                      <span className="admin-participant-dot" style={{ background: p.online ? 'var(--accent-system)' : 'var(--border-color)' }} />
                      <span className="admin-participant-name">{p.name}</span>
                      <span className="admin-participant-time">Joined {new Date(p.joined_at).toLocaleDateString()}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        ) : (
          <>
            {/* Workshop list */}
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
                <p>No workshops yet.</p>
                <button className="landing-join-btn" style={{ width: 'auto', padding: '10px 24px', marginTop: 12 }} onClick={() => setShowCreate(true)}>
                  Create your first workshop
                </button>
              </div>
            ) : (
              <div className="admin-grid">
                {workshops.map(w => (
                  <div key={w.id} className="admin-workshop-card" onClick={() => handleSelectWorkshop(w)}>
                    <div className="admin-workshop-name">{w.org_name}</div>
                    <div className="admin-workshop-code">{w.code}</div>
                    <div className="admin-workshop-date">{new Date(w.created_at).toLocaleDateString()}</div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>

      {/* Create modal */}
      {showCreate && (
        <div className="modal-overlay" onClick={() => setShowCreate(false)}>
          <div className="modal-box" onClick={e => e.stopPropagation()}>
            <h3>Create Workshop</h3>
            <p style={{ fontSize: 14, color: 'var(--text-muted)', marginBottom: 16 }}>
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
              <label>Organization (optional)</label>
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
