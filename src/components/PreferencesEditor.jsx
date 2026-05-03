import { useState } from 'react';
import StageExamplePanel from './StageExamplePanel';
import { lookupStageExample } from '../data/stageExamples';

export default function PreferencesEditor({ initialContent, onSave, onClose, workshopCode }) {
  const [content, setContent] = useState(initialContent || '');
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    setSaving(true);
    await onSave(content);
    setSaving(false);
    if (onClose) onClose();
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-box" style={{ maxWidth: 640 }} onClick={e => e.stopPropagation()}>
        <h3>My Preferences</h3>
        <p style={{ fontSize: 14, color: 'var(--text-muted, #888)', marginBottom: 16, lineHeight: 1.5 }}>
          Tell the AI about yourself: your role, how you want responses, what matters to you.
          These preferences are applied to every conversation you have, across all workshops.
        </p>
        <StageExamplePanel
          stage="2"
          workshopCode={workshopCode}
          onApply={() => {
            const ex = lookupStageExample('2');
            if (ex?.artifact?.body) setContent(ex.artifact.body);
          }}
        />
        <textarea
          value={content}
          onChange={e => setContent(e.target.value)}
          placeholder="e.g., I'm a credit-ops manager working in retail lending. Be concise. Use bullet points. Use examples from Indian banking when relevant."
          rows={10}
          style={{
            width: '100%',
            padding: 12,
            border: '1px solid var(--border-color, #e0d6cc)',
            borderRadius: 8,
            fontFamily: 'inherit',
            fontSize: 14,
            lineHeight: 1.5,
            resize: 'vertical',
            background: 'var(--bg-warm, #fdf9f4)',
            color: 'var(--text-body)',
          }}
          autoFocus
        />
        <p style={{ fontSize: 12, color: 'var(--text-muted, #888)', marginTop: 8, fontStyle: 'italic' }}>
          Saved preferences follow you across workshops. You can update or clear them any time.
        </p>
        <div className="modal-actions" style={{ marginTop: 16 }}>
          <button className="modal-btn cancel" onClick={onClose}>Cancel</button>
          <button className="modal-btn primary" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}
