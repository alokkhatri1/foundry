import { useState } from 'react';

export default function SetupScreen({ onSetup }) {
  const [orgName, setOrgName] = useState('My Organization');
  const [apiKey, setApiKey] = useState(import.meta.env.VITE_ANTHROPIC_API_KEY || '');

  return (
    <div className="setup-screen">
      <div className="setup-hero">
        <div className="setup-hero-left">
          <h1 className="setup-title">
            Foundry
          </h1>
          <p className="setup-subtitle">
            Design, build, and run workflows with AI agents, tools, and human review —
            all in one place.
          </p>

          <div className="setup-form">
            <div className="setup-field">
              <label>Organization Name</label>
              <input
                type="text"
                value={orgName}
                onChange={e => setOrgName(e.target.value)}
                placeholder="e.g., Acme Corp, Your Company"
              />
            </div>

            <div className="setup-field">
              <label>Anthropic API Key</label>
              <input
                type="password"
                value={apiKey}
                onChange={e => setApiKey(e.target.value)}
                placeholder="sk-ant-..."
              />
              <span className="setup-field-note">Required for AI features. Stays in your browser.</span>
            </div>

            <div className="setup-buttons">
              <button
                className="setup-btn-primary"
                disabled={!orgName.trim()}
                onClick={() => onSetup(orgName.trim(), true, apiKey.trim())}
              >
                Start with Example Content
                <span className="btn-arrow">&#x2197;</span>
              </button>
              <button
                className="setup-btn-secondary"
                disabled={!orgName.trim()}
                onClick={() => onSetup(orgName.trim(), false, apiKey.trim())}
              >
                Start Empty
              </button>
            </div>
          </div>

          <div className="setup-trust">
            <span>Built for <strong>workshops</strong> and <strong>live demos</strong> — learn the six-layer agentic architecture hands-on.</span>
          </div>
        </div>

        <div className="setup-hero-right">
          <div className="setup-visual">
            <div className="visual-card vc-1">
              <div className="vc-dot agent"></div>
              <span>Agent analyzes case</span>
            </div>
            <div className="visual-card vc-2">
              <div className="vc-dot approval"></div>
              <span>Human approves</span>
            </div>
            <div className="visual-card vc-3">
              <div className="vc-dot system"></div>
              <span>System acts</span>
            </div>
            <div className="visual-label">AI advises. Humans decide. Systems act.</div>
          </div>
        </div>
      </div>
    </div>
  );
}
