import { useState } from 'react';
import RichText from './RichText';

export default function FileEditor({ file, onUpdateContent }) {
  const [mode, setMode] = useState('view');

  if (!file) {
    return (
      <div className="file-editor" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', fontSize: 14 }}>
        Select a file to edit
      </div>
    );
  }

  const isEmpty = !file.content || file.content.trim() === '';

  return (
    <div className="file-editor">
      <div className="file-editor-header">
        <h3><span style={{ color: 'var(--text-muted)' }}>{'\u2666'}</span> {file.name}</h3>
        <div className="file-editor-modes">
          <button
            className={`file-editor-mode${mode === 'view' ? ' active' : ''}`}
            onClick={() => setMode('view')}
          >View</button>
          <button
            className={`file-editor-mode${mode === 'edit' ? ' active' : ''}`}
            onClick={() => setMode('edit')}
          >Edit</button>
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
            value={file.content || ''}
            onChange={e => onUpdateContent(file.id, e.target.value)}
            placeholder="Start writing..."
            spellCheck={false}
          />
        )}
      </div>
    </div>
  );
}
