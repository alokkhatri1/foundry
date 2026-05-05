import { useState, useEffect, useRef, useCallback } from 'react';
import { useConfirm } from '../components/ConfirmDialog';

// Local draft state for a file editor. Keeps keystrokes out of the persistent
// store until the user explicitly hits Save, and exposes a dirty flag so the
// UI can warn before discarding unsaved work.
//
// `fileId` keys the draft — when it changes (user switches files), the draft
// resets to the new file's content. `fileContent` follows the upstream value
// so remote updates and lazy-load arrivals are picked up when the user
// hasn't started editing.
//
// Dirtiness is tracked by an explicit "user typed something" flag rather
// than `draft !== fileContent`, because the latter latches true the moment
// fileContent transitions from empty to its real body (the lazy-load case)
// and the auto-sync effect would then refuse to apply the new content,
// pinning the editor on its empty initial draft and showing "UNSAVED"
// forever even though the user did nothing.
export default function useFileDraft(fileId, fileContent, onSave) {
  const confirm = useConfirm();
  const [draft, setDraft] = useState(fileContent || '');
  const [hasUserEdited, setHasUserEdited] = useState(false);
  const lastFileIdRef = useRef(fileId);

  useEffect(() => {
    const upstream = fileContent || '';
    if (lastFileIdRef.current !== fileId) {
      // Switched files: reset to the new upstream.
      lastFileIdRef.current = fileId;
      setDraft(upstream);
      setHasUserEdited(false);
      return;
    }
    // Same file, fileContent changed — lazy-load arrival, remote edit,
    // or post-save propagation. Auto-sync only when the user hasn't
    // edited; otherwise we'd wipe their unsaved work.
    if (!hasUserEdited) {
      setDraft(upstream);
    } else if (draft === upstream) {
      // User edited, and upstream now matches their draft — their save
      // just landed (or someone else made the identical change). Clear
      // the dirty flag.
      setHasUserEdited(false);
    }
  }, [fileId, fileContent, hasUserEdited, draft]);

  const isDirty = hasUserEdited && draft !== (fileContent || '');

  const updateDraft = useCallback((next) => {
    setHasUserEdited(true);
    setDraft(next);
  }, []);

  const save = useCallback(() => {
    if (!isDirty) return false;
    onSave(fileId, draft);
    return true;
  }, [isDirty, onSave, fileId, draft]);

  const confirmDiscard = useCallback(async (message) => {
    if (!isDirty) return true;
    const ok = await confirm({
      title: 'Unsaved changes',
      message: message || 'You have unsaved changes. Discard them?',
      confirmLabel: 'Discard',
      danger: true,
    });
    if (ok) {
      setDraft(fileContent || '');
      setHasUserEdited(false);
    }
    return ok;
  }, [isDirty, fileContent, confirm]);

  return { draft, isDirty, updateDraft, save, confirmDiscard };
}
