import { useState, useEffect, useMemo } from 'react';
import RichText from './RichText';
import useFileDraft from '../hooks/useFileDraft';

// Walk the tree to find the chain of nodes from root to target. Used by
// the editor sub-strip to render the path crumb (workspace / dept / leaf
// / file) and to derive the parent folder's flavor for the colored dot.
function buildPath(tree, targetId) {
  if (!tree || !targetId) return null;
  const path = [];
  function walk(node) {
    if (node.id === targetId) { path.push(node); return true; }
    if (node.children) {
      for (const c of node.children) {
        if (walk(c)) { path.unshift(node); return true; }
      }
    }
    return false;
  }
  walk(tree);
  return path.length > 0 ? path : null;
}

export default function FileEditor({ file, fileTree, onUpdateContent, onClose }) {
  const filePath = useMemo(
    () => (fileTree && file?.id ? buildPath(fileTree, file.id) : null),
    [fileTree, file?.id],
  );
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

  // Parent folder name drives the flavor dot (knowledge=green, skills=blue).
  // filePath is the array buildPath() returns: [root, dept, leaf, file].
  const parentFlavor = useMemo(() => {
    if (!filePath || filePath.length < 2) return null;
    const parent = filePath[filePath.length - 2];
    if (parent?.name === 'knowledge') return 'knowledge';
    if (parent?.name === 'skills') return 'skills';
    return null;
  }, [filePath]);

  if (!file) {
    return (
      <div className="fl-editor">
        <div className="fl-editor-empty">
          <div className="fl-editor-empty-eyebrow">Editor</div>
          <p className="fl-editor-empty-title">Select a file to view or edit.</p>
          <p className="fl-editor-empty-desc">
            Files in <span className="fl-em-knowledge">knowledge</span> become reference material for AI coworkers.
            Files in <span className="fl-em-skills">skills</span> become reusable instructions — like a job aid for a new hire.
          </p>
          <span className="fl-editor-empty-hint">Pick a file from the workspace</span>
        </div>
      </div>
    );
  }

  // Word + line stats for the sub-strip — drives off the live draft when
  // editing, the saved content when viewing, so the count tracks what the
  // user is actually looking at.
  const measured = mode === 'edit' ? draft : (file.content || '');
  const lineCount = measured.split('\n').length;
  const wordCount = measured.trim().split(/\s+/).filter(Boolean).length;

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
    <div className="fl-editor">
      <div className="fl-editor-head">
        <div className="fl-editor-head-left">
          {onClose && (
            <button className="fl-editor-close" onClick={onClose} aria-label="Close">{'←'}</button>
          )}
          <div className="fl-editor-title">
            {parentFlavor && <span className={`fl-editor-flavor-dot is-${parentFlavor}`} aria-hidden />}
            <span className="fl-editor-title-name">{file.name}</span>
            {isDirty && <span className="fl-editor-flag fl-editor-flag-dirty">unsaved</span>}
            {readOnly && <span className="fl-editor-flag fl-editor-flag-readonly">example · view only</span>}
          </div>
        </div>
        <div className="fl-editor-head-right">
          <div className="fl-editor-modes">
            <button
              className={`fl-editor-mode${mode === 'view' ? ' is-active' : ''}`}
              onClick={() => switchMode('view')}
            >View</button>
            {!readOnly && (
              <button
                className={`fl-editor-mode${mode === 'edit' ? ' is-active' : ''}`}
                onClick={() => switchMode('edit')}
              >Edit</button>
            )}
          </div>
          {!readOnly && mode === 'edit' && (
            <button
              className="fl-editor-save"
              onClick={handleSave}
              disabled={!isDirty}
            >
              Save
              <span className="fl-editor-save-arrow" aria-hidden>{'→'}</span>
            </button>
          )}
        </div>
      </div>

      {filePath && filePath.length > 0 && (
        <div className="fl-editor-meta">
          <span className="fl-editor-meta-path">
            {filePath.map((node, i) => (
              <span key={node.id}>
                {i > 0 && <span className="sep"> / </span>}
                <span>{i === 0 ? 'workspace' : node.name}</span>
              </span>
            ))}
          </span>
          <span className="fl-editor-meta-stats">
            <span>{lineCount} {lineCount === 1 ? 'line' : 'lines'}</span>
            <span>{wordCount} {wordCount === 1 ? 'word' : 'words'}</span>
          </span>
        </div>
      )}

      <div className={`fl-editor-body${mode === 'edit' ? ' is-edit' : ''}`}>
        {mode === 'view' ? (
          <div className="fl-editor-view md-doc">
            {isEmpty ? (
              <p className="fl-editor-empty-line">This file is empty. Click Edit to add content.</p>
            ) : (
              <RichText content={file.content} />
            )}
          </div>
        ) : (
          <textarea
            className="fl-editor-textarea"
            value={draft}
            onChange={e => updateDraft(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Start writing…"
            spellCheck={false}
          />
        )}
      </div>
    </div>
  );
}
