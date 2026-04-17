import { useState } from 'react';
import { EDUCATIONAL_CUES } from '../data/educationalCues';

const DISMISSED_KEY = 'sandbox:dismissed-cues';

function getDismissed() {
  try {
    return JSON.parse(localStorage.getItem(DISMISSED_KEY) || '[]');
  } catch { return []; }
}

function setDismissed(ids) {
  localStorage.setItem(DISMISSED_KEY, JSON.stringify(ids));
}

export default function EducationalCue({ cueId, show }) {
  const [open, setOpen] = useState(false);
  const [dismissed, setDismissedState] = useState(() => getDismissed().includes(cueId));

  const cue = EDUCATIONAL_CUES[cueId];
  if (!cue || !show || dismissed) return null;

  function handleDismiss(e) {
    e.stopPropagation();
    const ids = getDismissed();
    if (!ids.includes(cueId)) {
      const updated = [...ids, cueId];
      setDismissed(updated);
    }
    setDismissedState(true);
    setOpen(false);
  }

  function handleClose() {
    setOpen(false);
  }

  return (
    <>
      <button className="edu-cue-chip" onClick={() => setOpen(true)}>
        <span className="edu-cue-icon">i</span>
        <span className="edu-cue-label">{cue.label}</span>
      </button>

      {open && (
        <div className="edu-cue-overlay" onClick={handleClose}>
          <div className="edu-cue-modal" onClick={e => e.stopPropagation()}>
            <div className="edu-cue-modal-header">
              <h3 className="edu-cue-title">{cue.title}</h3>
              <button className="edu-cue-close" onClick={handleClose}>{'\u2715'}</button>
            </div>
            <p className="edu-cue-content">{cue.content}</p>
            {cue.tools && cue.tools.length > 0 && (
              <div className="edu-cue-tools">
                <span className="edu-cue-tools-label">Real-world tools:</span>
                {cue.tools.map((t, i) => (
                  <div key={i} className="edu-cue-tool">
                    <span className="edu-cue-tool-name">{t.name}</span>
                    {t.desc && <span className="edu-cue-tool-desc"> — {t.desc}</span>}
                  </div>
                ))}
              </div>
            )}
            <div className="edu-cue-modal-footer">
              <button className="edu-cue-dismiss" onClick={handleDismiss}>Don't show again</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
