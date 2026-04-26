import { useState, useEffect } from 'react';
import RichText from './RichText';
import useFileDraft from '../hooks/useFileDraft';

export default function FileEditor({ file, onUpdateContent }) {
  const [mode, setMode] = useState('view');
  const { draft, isDirty, updateDraft, save, confirmDiscard } = useFileDraft(
    file?.id,
    file?.content,
    onUpdateContent,
  );
  // System-seeded example files are room-shared; one participant editing
  // would propagate to all 40. View-only — clone first if you want to edit.
  const readOnly = file?.createdBy === 'System';

  useEffect(() => {
    if (!isDirty) return;
    function handleBeforeUnload(e) {
      e.preventDefault();
      e.returnValue = '';
    }
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [isDirty]);

  if (!file) {
    return (
      <div className="file-editor" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', fontSize: 14 }}>
        Select a file to edit
      </div>
    );
  }

  const isEmpty = !file.content || file.content.trim() === '';

  async function switchMode(next) {
    if (next === 'view' && isDirty) {
      const ok = await confirmDiscard('You have unsaved changes. Discard them and switch to View?');
      if (!ok) return;
    }
    setMode(next);
  }

  function handleSave() {
    if (save()) setMode('view');
  }

  function handleKeyDown(e) {
    if ((e.metaKey || e.ctrlKey) && e.key === 's') {
      e.preventDefault();
      handleSave();
    }
  }

  return (
    <div className="file-editor">
      <div className="file-editor-header">
        <h3><span style={{ color: 'var(--text-muted)' }}>{'\u2666'}</span> {file.name}{isDirty && <span style={{ color: 'var(--text-muted)', fontWeight: 400, fontSize: 12, marginLeft: 8 }}>• unsaved</span>}{readOnly && <span style={{ color: 'var(--text-muted)', fontWeight: 400, fontSize: 12, marginLeft: 8 }}>• example, view only</span>}</h3>
        <div className="file-editor-modes">
          <button
            className={`file-editor-mode${mode === 'view' ? ' active' : ''}`}
            onClick={() => switchMode('view')}
          >View</button>
          {!readOnly && (
            <button
              className={`file-editor-mode${mode === 'edit' ? ' active' : ''}`}
              onClick={() => switchMode('edit')}
            >Edit</button>
          )}
          {!readOnly && mode === 'edit' && (
            <button
              className="file-editor-save"
              onClick={handleSave}
              disabled={!isDirty}
              style={{ marginLeft: 6 }}
            >Save</button>
          )}
        </div>
      </div>
      <div className="file-editor-body">
        {mode === 'view' ? (
          <div className="file-editor-view md-doc">
            {isEmpty ? (
              <p style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>This file is empty. Click Edit to add content.</p>
            ) : (
              <RichText content={file.content} />
            )}
          </div>
        ) : (
          <textarea
            value={draft}
            onChange={e => updateDraft(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Start writing..."
            spellCheck={false}
          />
        )}
      </div>
    </div>
  );
}
