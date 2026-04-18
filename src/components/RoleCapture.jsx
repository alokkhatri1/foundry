import { useState } from 'react';

export default function RoleCapture({ onSave }) {
  const [role, setRole] = useState('');
  const [saving, setSaving] = useState(false);

  async function handleSubmit() {
    const trimmed = role.trim();
    if (!trimmed) return;
    setSaving(true);
    await onSave(trimmed);
    setSaving(false);
  }

  return (
    <div className="modal-overlay">
      <div className="modal-box" style={{ maxWidth: 520 }}>
        <h3>Tell us about your role</h3>
        <p style={{ fontSize: 14, color: 'var(--text-muted, #888)', marginBottom: 16, lineHeight: 1.5 }}>
          What's your role in your organization? This helps the platform understand where you'd fit in a strategic delegation — so when the workshop reaches its closing exercise, you'll see yourself in the map.
        </p>
        <input
          type="text"
          value={role}
          onChange={e => setRole(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') handleSubmit(); }}
          placeholder="e.g., Credit Manager, Product Lead, ICU Nurse, Head of Legal"
          style={{
            width: '100%',
            padding: 12,
            border: '1px solid var(--border-color, #e0d6cc)',
            borderRadius: 8,
            fontSize: 15,
            fontFamily: 'inherit',
            background: 'var(--bg-warm, #fdf9f4)',
            color: 'var(--text-body)',
          }}
          autoFocus
        />
        <p style={{ fontSize: 12, color: 'var(--text-muted, #888)', marginTop: 8, fontStyle: 'italic' }}>
          You can change this later. It's stored to your account across all workshops.
        </p>
        <div className="modal-actions" style={{ marginTop: 16 }}>
          <button
            className="landing-join-btn"
            style={{ width: '100%', padding: '12px 24px' }}
            onClick={handleSubmit}
            disabled={!role.trim() || saving}
          >
            {saving ? 'Saving...' : 'Continue'}
          </button>
        </div>
      </div>
    </div>
  );
}
