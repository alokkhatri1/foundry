import { useState } from 'react';

const DEFAULT_CODE = 'alok';

export default function RoomScreen({ onJoin }) {
  const [name, setName] = useState('');
  const [code, setCode] = useState(DEFAULT_CODE);
  const [error, setError] = useState('');

  function handleJoin() {
    if (!name.trim()) { setError('Please enter your name.'); return; }
    if (!code.trim()) { setError('Please enter the workshop code.'); return; }
    setError('');
    onJoin(name.trim(), code.trim());
  }

  return (
    <div className="setup-screen">
      <div className="cl-center-layout" style={{ maxWidth: 480 }}>
        <div className="cl-welcome" style={{ paddingBottom: 40 }}>
          <div className="cl-welcome-icon">F</div>
          <h2 className="cl-welcome-title">Foundry</h2>
          <p className="cl-welcome-desc">
            Enter your name and the workshop code to join.
          </p>
        </div>

        <div style={{ width: '100%', maxWidth: 360 }}>
          <div className="setup-field" style={{ marginBottom: 16 }}>
            <label>Your Name</label>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="e.g., Ramesh Sharma"
              onKeyDown={e => e.key === 'Enter' && handleJoin()}
              autoFocus
            />
          </div>

          <div className="setup-field" style={{ marginBottom: 20 }}>
            <label>Workshop Code</label>
            <input
              type="text"
              value={code}
              onChange={e => setCode(e.target.value)}
              placeholder="e.g., alok"
              onKeyDown={e => e.key === 'Enter' && handleJoin()}
            />
          </div>

          {error && <div className="room-error" style={{ marginBottom: 16 }}>{error}</div>}

          <button
            className="setup-btn-primary"
            disabled={!name.trim() || !code.trim()}
            onClick={handleJoin}
            style={{ width: '100%', justifyContent: 'center' }}
          >
            Join Workshop
            <span className="btn-arrow">&#x2197;</span>
          </button>
        </div>
      </div>
    </div>
  );
}
