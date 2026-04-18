import { useState } from 'react';

export default function JoinScreen({ user, isAdmin, onJoin, onSignOut, onAdminDashboard }) {
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [joining, setJoining] = useState(false);

  const userName = user?.user_metadata?.full_name || user?.email?.split('@')[0] || 'Participant';

  async function handleJoin() {
    if (!code.trim()) { setError('Please enter a workshop code.'); return; }
    setError('');
    setJoining(true);
    const result = await onJoin(userName, code.trim().toUpperCase(), user?.id);
    if (result?.error) {
      const msg = result.error === 'not_found'
        ? 'Workshop code not found.'
        : result.error === 'deprecated'
        ? 'This workshop has ended.'
        : 'Could not join workshop.';
      setError(msg);
      setJoining(false);
    }
  }

  return (
    <div className="landing">
      <div className="landing-content" style={{ flexDirection: 'column', alignItems: 'center', gap: 32 }}>
        <div style={{ textAlign: 'center' }}>
          <div className="landing-brand" style={{ justifyContent: 'center', marginBottom: 16 }}>
            <div className="landing-logo">F</div>
            <span className="landing-logo-text">Foundry</span>
          </div>
          <h1 className="landing-title" style={{ fontSize: 36, textAlign: 'center' }}>
            Welcome, <span className="landing-highlight">{userName}</span>
          </h1>
        </div>

        <div className="landing-card" style={{ maxWidth: 380, width: '100%' }}>
          <h2 className="landing-card-title">Join a Workshop</h2>
          <p className="landing-card-desc">Enter the code provided by your facilitator.</p>

          <div className="landing-field">
            <label>Workshop Code</label>
            <input
              type="text"
              value={code}
              onChange={e => setCode(e.target.value.toUpperCase())}
              placeholder="Enter code"
              onKeyDown={e => e.key === 'Enter' && handleJoin()}
              autoFocus
              style={{ textAlign: 'center', letterSpacing: 2, fontSize: 18, fontWeight: 700 }}
            />
          </div>

          {error && <div className="landing-error">{error}</div>}

          <button className="landing-join-btn" onClick={handleJoin} disabled={!code.trim() || joining}>
            {joining ? 'Joining...' : 'Join Workshop'}
          </button>

          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 16 }}>
            {isAdmin && (
              <button className="landing-admin-link" onClick={onAdminDashboard}>Admin Dashboard</button>
            )}
            <button className="landing-admin-link" onClick={onSignOut} style={{ marginLeft: 'auto' }}>Sign Out</button>
          </div>
        </div>
      </div>
    </div>
  );
}
