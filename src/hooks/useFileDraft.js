import { useState, useEffect, useRef, useCallback } from 'react';

// Local draft state for a file editor. Keeps keystrokes out of the persistent
// store until the user explicitly hits Save, and exposes a dirty flag so the
// UI can warn before discarding unsaved work.
//
// `fileId` keys the draft — when it changes (user switches files), the draft
// resets to the new file's content. `fileContent` follows the upstream value
// so remote updates are picked up when the draft is clean.
export default function useFileDraft(fileId, fileContent, onSave) {
  const [draft, setDraft] = useState(fileContent || '');
  const dirtyRef = useRef(false);
  const lastFileIdRef = useRef(fileId);

  useEffect(() => {
    if (lastFileIdRef.current !== fileId) {
      lastFileIdRef.current = fileId;
      setDraft(fileContent || '');
      dirtyRef.current = false;
      return;
    }
    if (!dirtyRef.current) {
      setDraft(fileContent || '');
    }
  }, [fileId, fileContent]);

  const isDirty = draft !== (fileContent || '');
  dirtyRef.current = isDirty;

  const updateDraft = useCallback((next) => {
    setDraft(next);
  }, []);

  const save = useCallback(() => {
    if (!isDirty) return false;
    onSave(fileId, draft);
    return true;
  }, [isDirty, onSave, fileId, draft]);

  const confirmDiscard = useCallback((message) => {
    if (!isDirty) return true;
    const ok = window.confirm(message || 'You have unsaved changes. Discard them?');
    if (ok) {
      setDraft(fileContent || '');
      dirtyRef.current = false;
    }
    return ok;
  }, [isDirty, fileContent]);

  return { draft, isDirty, updateDraft, save, confirmDiscard };
}
