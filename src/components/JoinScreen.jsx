import { useState } from 'react';
import './FoundryLanding.css';

// Code-entry screen shown after Google sign-in but before joining a
// workshop. Visual language mirrors the marketing landing (cream +
// peach + Fraunces) so the participant sees the same brand voice
// from sign-in through the workshop. Behavior is unchanged: a single
// text input, Enter or button click hands the code up to App.handleJoin.
function ArrowIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <line x1="7" y1="17" x2="17" y2="7" />
      <polyline points="7 7 17 7 17 17" />
    </svg>
  );
}

export default function JoinScreen({ user, isAdmin, adminStatus, adminError, onRetryAdminCheck, onJoin, onSignOut, onAdminDashboard }) {
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [joining, setJoining] = useState(false);

  const userName = user?.user_metadata?.full_name || user?.email?.split('@')[0] || 'Participant';

  async function handleJoin() {
    if (!code.trim()) { setError('Please enter a workshop code.'); return; }
    setError('');
    setJoining(true);
    // Defense in depth: if onJoin throws (e.g. any sb.* call in the join
    // chain rejects), we must still clear the spinner and show something
    // actionable — otherwise the button sits on "Joining…" forever and
    // the user thinks the app is dead.
    try {
      const result = await onJoin(userName, code.trim().toUpperCase(), user?.id, user?.email);
      if (result?.error) {
        const msg = result.error === 'not_found'
          ? 'Workshop code not found.'
          : result.error === 'deprecated'
          ? 'This workshop has ended.'
          : result.message
          ? `Could not join workshop: ${result.message}`
          : 'Could not join workshop. Please try again.';
        setError(msg);
        setJoining(false);
      }
    } catch (err) {
      console.error('[join] unexpected error:', err);
      setError('Something went wrong joining the workshop. Please try again.');
      setJoining(false);
    }
  }

  return (
    <div className="foundry-join">
      <div className="fj-stage">
        <div className="fj-wordmark">
          <span className="fj-wordmark-name">Foundry</span>
          <span className="fj-wordmark-by">
            {' '}by{' '}
            <a href="https://alokkhatri.com" target="_blank" rel="noopener noreferrer">Alok Khatri</a>
          </span>
        </div>
        <h2 className="fj-welcome">Welcome, <span className="fj-welcome-name">{userName}</span></h2>

        <div className="fj-card">
          <h3 className="fj-card-title">Join a Workshop</h3>
          <p className="fj-card-desc">Enter the code provided by your facilitator.</p>

          <div className="fj-field">
            <label>Workshop Code</label>
            <input
              type="text"
              value={code}
              onChange={e => setCode(e.target.value.toUpperCase())}
              placeholder="Enter code"
              onKeyDown={e => e.key === 'Enter' && handleJoin()}
              autoFocus
            />
          </div>

          {error && <div className="fj-error">{error}</div>}

          <button className="fj-cta" onClick={handleJoin} disabled={!code.trim() || joining}>
            {joining ? 'Joining…' : 'Join Workshop'}
            <span className="fj-cta-arrow"><ArrowIcon /></span>
          </button>

          <div className="fj-card-footer">
            {isAdmin && (
              <button className="fj-link" onClick={onAdminDashboard}>Admin Dashboard</button>
            )}
            {adminStatus === 'error' && (
              <button
                className="fj-link fj-link-error"
                onClick={onRetryAdminCheck}
                title={adminError || 'Admin check failed'}
              >
                Admin check failed — Retry
              </button>
            )}
            <button className="fj-link fj-link-end" onClick={onSignOut}>Sign Out</button>
          </div>
        </div>
      </div>
    </div>
  );
}
