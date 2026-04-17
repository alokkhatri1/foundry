import { useState } from 'react';

const DEFAULT_CODE = 'alok';

const FEATURES = [
  { icon: '\uD83D\uDCAC', title: 'Chat with AI', desc: 'Build and manage your platform through natural language' },
  { icon: '\uD83E\uDDD1\u200D\uD83D\uDCBB', title: 'AI Coworkers', desc: 'Create specialists with instructions, knowledge, and tools' },
  { icon: '\uD83D\uDD04', title: 'Workflows', desc: 'Automate multi-step processes with human-in-the-loop approval' },
];

export default function RoomScreen({ onJoin }) {
  const [name, setName] = useState('');
  const [code, setCode] = useState(DEFAULT_CODE);
  const [error, setError] = useState('');
  const [joining, setJoining] = useState(false);

  async function handleJoin() {
    if (!name.trim()) { setError('Please enter your name.'); return; }
    if (!code.trim()) { setError('Please enter the workshop code.'); return; }
    setError('');
    setJoining(true);
    await onJoin(name.trim(), code.trim());
  }

  return (
    <div className="landing">
      <div className="landing-content">
        {/* Left — branding + features */}
        <div className="landing-left">
          <div className="landing-brand">
            <div className="landing-logo">F</div>
            <span className="landing-logo-text">Foundry</span>
          </div>

          <h1 className="landing-title">
            Build AI teams that<br />
            <span className="landing-highlight">work together</span>
          </h1>

          <p className="landing-subtitle">
            Create AI coworkers, give them knowledge and instructions, wire them into workflows — all through conversation.
          </p>

          <div className="landing-features">
            {FEATURES.map(f => (
              <div key={f.title} className="landing-feature">
                <span className="landing-feature-icon">{f.icon}</span>
                <div>
                  <div className="landing-feature-title">{f.title}</div>
                  <div className="landing-feature-desc">{f.desc}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Right — join form */}
        <div className="landing-right">
          <div className="landing-card">
            <h2 className="landing-card-title">Join Workshop</h2>
            <p className="landing-card-desc">Enter your name and the workshop code to get started.</p>

            <div className="landing-field">
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

            <div className="landing-field">
              <label>Workshop Code</label>
              <input
                type="text"
                value={code}
                onChange={e => setCode(e.target.value)}
                placeholder="e.g., alok"
                onKeyDown={e => e.key === 'Enter' && handleJoin()}
              />
            </div>

            {error && <div className="landing-error">{error}</div>}

            <button
              className="landing-join-btn"
              disabled={!name.trim() || !code.trim() || joining}
              onClick={handleJoin}
            >
              {joining ? 'Joining...' : 'Join Workshop'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
