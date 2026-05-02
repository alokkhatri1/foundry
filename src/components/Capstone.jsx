import { useEffect, useMemo, useRef, useState } from 'react';
import RichText from './RichText';
import { EXAMPLE_BLUEPRINT_FILE_ID } from '../data/exampleArtifacts';

// Capstone tab — Stage 8. Each participant fills a 5-column workflow plan
// (Step / Node / Data source / Knowledge & skills files / Remarks). When
// every row has all five fields non-empty AND the Copilot stage (9) has
// been revealed, a "Send to copilot" action ships the table as markdown
// into the Orchestration copilot.
//
// Persistence: per-participant per-room via sb.loadCapstoneDraft /
// sb.saveCapstoneDraft. No realtime — single-author edits.
//
// Blueprint reference: a side drawer reads the seeded blueprint.md file
// (Examples/blueprints/blueprint.md, dropped at Stage 8 reveal). The file
// is editable by admins via the standard FileEditor, so each cohort can
// rewrite the blueprint without a code deploy.

function newRow() {
  return {
    id: 'row-' + Math.random().toString(36).slice(2, 10),
    type: 'coworker', // 'coworker' | 'review' — drives whether the copilot
                      // generates an add_coworker_node or add_review_node
                      // for this step. Default Coworker because most rows
                      // are AI work; Reviews are typically the minority.
    actorId: '',      // For type=coworker: id of a saved coworker.
                      // For type=review: id of a participant (reviewer).
                      // Bound from the ActorPicker. Cleared when type flips.
    actorName: '',    // Cached at bind time so the markdown export still
                      // works if the underlying entity is later renamed
                      // or removed; isRowComplete validates the id still
                      // resolves before send is allowed.
    step: '',
    node: '',
    fileIds: [],
    remarks: '',
  };
}

function rowTypeLabel(type) {
  return type === 'review' ? 'Human review' : 'AI coworker';
}

// "Step / Node" is one combined column in the LOAMS reference (a step in
// the workflow = a node in the DAG). For drafts saved before this collapse
// the row may carry both `step` and `node` — treat them as one. Going
// forward only `step` is required; `node` is preserved on existing rows
// for backwards compat but no longer asked for in the UI.
function combinedStep(row) {
  const s = (row.step || '').trim();
  const n = (row.node || '').trim();
  if (s && n) return `${s} (${n})`;
  return s || n;
}

function isRowComplete(row, coworkers, participants) {
  if (!combinedStep(row)) return false;
  if (!(row.remarks || '').trim()) return false;
  if (!row.actorId) return false;
  // Files required for Coworker (the AI step needs reference material to
  // shape its behaviour); optional for Review (a human reviewer might
  // attach a checklist but doesn't have to).
  if ((row.type || 'coworker') === 'coworker' && (row.fileIds || []).length === 0) return false;
  // Actor must still resolve to a real entity. A coworker deleted from the
  // library or a participant who left the room should re-flag the row as
  // incomplete instead of silently shipping a dangling id to the copilot.
  if ((row.type || 'coworker') === 'coworker') {
    if (!(coworkers || []).some(c => c.id === row.actorId)) return false;
  } else {
    if (!(participants || []).some(p => p.id === row.actorId)) return false;
  }
  return true;
}

// First-incomplete row diagnostic. Tells the participant *which* row blocks
// Send rather than just "5 of 7 complete" — we know from the workshop the
// count-only message left people hunting for the missing field.
function firstIncompleteReason(rows, coworkers, participants) {
  for (let i = 0; i < (rows || []).length; i++) {
    const r = rows[i];
    const num = i + 1;
    if (!combinedStep(r)) return `Row ${num}: step description is empty`;
    if (!r.actorId) {
      return r.type === 'review'
        ? `Row ${num}: pick a reviewer`
        : `Row ${num}: pick a coworker`;
    }
    if ((r.type || 'coworker') === 'coworker') {
      if (!(coworkers || []).some(c => c.id === r.actorId)) {
        return `Row ${num}: coworker "${r.actorName || r.actorId}" no longer exists — pick another`;
      }
      if ((r.fileIds || []).length === 0) return `Row ${num}: attach at least one reference file`;
    } else {
      if (!(participants || []).some(p => p.id === r.actorId)) {
        return `Row ${num}: reviewer "${r.actorName || r.actorId}" left the room — pick another`;
      }
    }
    if (!(r.remarks || '').trim()) return `Row ${num}: remarks are empty`;
  }
  return null;
}

// Markdown rendering of the participant's plan. Bindings are explicit
// (Coworker: <name> / Reviewer: <name>) so the copilot doesn't have to
// infer which saved entity a step refers to — it can call the add_*
// tools directly with the named entity. The copilot's system prompt
// tells it to skip Discover when these bindings are present.
function rowsToMarkdown(rows, fileTreeFlat) {
  const fileNameById = new Map((fileTreeFlat || []).map(f => [f.id, f.name]));
  const lines = [
    'Build this workflow. Bindings below are explicit — use them, don’t infer.',
    '',
  ];
  rows.forEach((r, i) => {
    const fileNames = (r.fileIds || []).map(id => fileNameById.get(id) || id).filter(Boolean);
    const isReview = r.type === 'review';
    lines.push(`### Step ${i + 1}: ${combinedStep(r)}`);
    lines.push(`- Type: ${rowTypeLabel(r.type)}`);
    if (isReview) {
      lines.push(`- Reviewer: ${r.actorName || ''}`);
      // Use the step text as the review prompt. The copilot may rephrase
      // into a question form when it calls add_review_node; that's fine.
      lines.push(`- Prompt: ${combinedStep(r)}`);
    } else {
      lines.push(`- Coworker: ${r.actorName || ''}`);
    }
    if (fileNames.length) lines.push(`- Reference files: ${fileNames.join(', ')}`);
    lines.push(`- Logic + DoD: ${r.remarks}`);
    lines.push('');
  });
  return lines.join('\n').trim();
}

// Flatten a FileExplorer-style tree into rows for the file picker. Filters
// out folders and the participant's own / system files restricted to the
// knowledge + skills folders, since those are the ones that actually back
// workflow steps.
function flattenForPicker(tree) {
  const out = [];
  if (!tree) return out;
  function walk(node, ancestorFolderName) {
    if (!node) return;
    const nextAncestor = node.type === 'folder' ? node.name : ancestorFolderName;
    if (node.type === 'file') {
      const inKnowledgeOrSkills = ancestorFolderName === 'knowledge' || ancestorFolderName === 'skills';
      if (inKnowledgeOrSkills) {
        out.push({ id: node.id, name: node.name, folder: ancestorFolderName });
      }
    }
    for (const child of node.children || []) walk(child, nextAncestor);
  }
  walk(tree, null);
  return out;
}

function stripExt(name) {
  return (name || '').replace(/\.md$/i, '');
}

function FilePicker({ value, onChange, fileTree }) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef(null);
  const options = useMemo(() => flattenForPicker(fileTree), [fileTree]);
  const selectedNames = (value || [])
    .map(id => options.find(o => o.id === id)?.name)
    .filter(Boolean)
    .map(stripExt);

  // Click-outside-to-close. Without this the dropdown stays open when the
  // participant clicks back into a textarea or anywhere else on the page,
  // and they have to click the button again to dismiss it.
  useEffect(() => {
    if (!open) return;
    function onDocClick(e) {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setOpen(false);
      }
    }
    function onEsc(e) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onEsc);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onEsc);
    };
  }, [open]);

  function toggle(id) {
    const next = (value || []).includes(id)
      ? (value || []).filter(x => x !== id)
      : [...(value || []), id];
    onChange(next);
  }

  return (
    <div className="capstone-filepicker" ref={containerRef}>
      <button
        type="button"
        className={`capstone-filepicker-btn${selectedNames.length > 0 ? ' has-selection' : ''}`}
        onClick={() => setOpen(o => !o)}
      >
        <span className="capstone-filepicker-content">
          {selectedNames.length === 0 ? (
            <span className="capstone-filepicker-placeholder">Pick files&hellip;</span>
          ) : (
            selectedNames.map((name, i) => (
              <span key={i} className="capstone-filepicker-chip">{name}</span>
            ))
          )}
        </span>
        <span className="capstone-filepicker-caret">{open ? '▴' : '▾'}</span>
      </button>
      {open && (
        <div className="capstone-filepicker-menu">
          {options.length === 0 ? (
            <div className="capstone-filepicker-empty">
              No files in your knowledge or skills folders yet.
            </div>
          ) : (
            options.map(opt => (
              <label key={opt.id} className="capstone-filepicker-option">
                <input
                  type="checkbox"
                  checked={(value || []).includes(opt.id)}
                  onChange={() => toggle(opt.id)}
                />
                <span className="capstone-filepicker-option-name">{stripExt(opt.name)}</span>
                <span className="capstone-filepicker-option-folder">{opt.folder}</span>
              </label>
            ))
          )}
        </div>
      )}
    </div>
  );
}

function ActorPicker({ row, coworkers, participants, onActorChange }) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef(null);

  // Same click-outside-to-close pattern as FilePicker. Without this the
  // dropdown stays open when the participant clicks back into a textarea.
  useEffect(() => {
    if (!open) return;
    function onDocClick(e) {
      if (containerRef.current && !containerRef.current.contains(e.target)) setOpen(false);
    }
    function onEsc(e) { if (e.key === 'Escape') setOpen(false); }
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onEsc);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onEsc);
    };
  }, [open]);

  const isCoworker = (row.type || 'coworker') === 'coworker';
  const options = useMemo(() => {
    if (isCoworker) {
      return (coworkers || [])
        .filter(c => (c.name || '').trim())
        .map(c => ({ id: c.id, name: c.name, sub: (c.role || '').slice(0, 80) }));
    }
    // Humans only — exclude AI participants. Show offline humans too: a
    // workshop where everyone happens to be offline at planning time
    // shouldn't block them from picking a reviewer.
    return (participants || [])
      .filter(p => (p.kind || 'human') === 'human' && (p.name || '').trim())
      .map(p => ({ id: p.id, name: p.name, sub: p.online ? 'online' : 'offline' }));
  }, [isCoworker, coworkers, participants]);

  const selected = options.find(o => o.id === row.actorId);
  const placeholder = isCoworker ? 'Pick a coworker…' : 'Pick a reviewer…';
  const emptyMsg = isCoworker
    ? 'No saved coworkers yet — build one in the Coworkers tab.'
    : 'No humans in the workshop yet.';

  function pick(opt) {
    onActorChange({ actorId: opt.id, actorName: opt.name });
    setOpen(false);
  }

  return (
    <div className="capstone-actorpicker" ref={containerRef}>
      <button
        type="button"
        className={`capstone-actorpicker-btn${selected ? ' has-selection' : ''}`}
        onClick={() => setOpen(o => !o)}
      >
        <span className="capstone-actorpicker-content">
          {selected ? (
            <span className="capstone-actorpicker-chip">{selected.name}</span>
          ) : (
            <span className="capstone-actorpicker-placeholder">{placeholder}</span>
          )}
        </span>
        <span className="capstone-actorpicker-caret">{open ? '▴' : '▾'}</span>
      </button>
      {open && (
        <div className="capstone-actorpicker-menu">
          {options.length === 0 ? (
            <div className="capstone-actorpicker-empty">{emptyMsg}</div>
          ) : (
            options.map(opt => (
              <button
                type="button"
                key={opt.id}
                className={`capstone-actorpicker-option${opt.id === row.actorId ? ' is-selected' : ''}`}
                onClick={() => pick(opt)}
              >
                <span className="capstone-actorpicker-option-name">{opt.name}</span>
                {opt.sub && <span className="capstone-actorpicker-option-sub">{opt.sub}</span>}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

function BlueprintDrawer({ open, onClose, blueprintContent }) {
  if (!open) return null;
  return (
    <div className="capstone-drawer-backdrop" onClick={onClose}>
      <aside
        className="capstone-drawer"
        onClick={e => e.stopPropagation()}
        role="dialog"
        aria-label="Workflow blueprint reference"
      >
        <div className="capstone-drawer-header">
          <h3>Workflow blueprint</h3>
          <button className="capstone-drawer-close" onClick={onClose} aria-label="Close blueprint">{'✕'}</button>
        </div>
        <div className="capstone-drawer-body md-doc">
          {blueprintContent
            ? <RichText content={blueprintContent} />
            : <p className="capstone-drawer-empty">Blueprint hasn&rsquo;t been seeded for this room yet. Ask the facilitator to reveal Stage 8 again.</p>}
        </div>
      </aside>
    </div>
  );
}

export default function Capstone({
  sb,
  myParticipantId,
  fileTree,
  flatFiles,
  onEnsureFileContent,
  coworkers,
  participants,
  copilotUnlocked,
  onSendToCopilot,
}) {
  const [rows, setRows] = useState(null); // null = loading
  const [saving, setSaving] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [savedNotice, setSavedNotice] = useState(false);

  // One-shot load of the participant's draft (or seed an empty row if none).
  useEffect(() => {
    let cancelled = false;
    if (!myParticipantId || !sb) {
      setRows([newRow()]);
      return;
    }
    sb.loadCapstoneDraft(myParticipantId).then(serverRows => {
      if (cancelled) return;
      if (Array.isArray(serverRows) && serverRows.length > 0) {
        setRows(serverRows);
      } else {
        setRows([newRow()]);
      }
    }).catch(() => { if (!cancelled) setRows([newRow()]); });
    return () => { cancelled = true; };
  }, [sb, myParticipantId]);

  // Pull the seeded blueprint markdown when the drawer opens. We use the
  // standard lazy-load path so admin edits via FileEditor are reflected
  // here without needing a separate fetch route.
  const blueprintFile = (flatFiles || []).find(f => f.id === EXAMPLE_BLUEPRINT_FILE_ID);
  useEffect(() => {
    if (drawerOpen && blueprintFile && typeof blueprintFile.content !== 'string') {
      onEnsureFileContent?.(blueprintFile.id);
    }
  }, [drawerOpen, blueprintFile, onEnsureFileContent]);

  function update(idx, patch) {
    setRows(prev => prev.map((r, i) => i === idx ? { ...r, ...patch } : r));
  }
  function addRow() {
    setRows(prev => [...prev, newRow()]);
  }
  function deleteRow(idx) {
    setRows(prev => prev.length > 1 ? prev.filter((_, i) => i !== idx) : prev);
  }
  function moveRow(idx, dir) {
    setRows(prev => {
      const next = [...prev];
      const j = idx + dir;
      if (j < 0 || j >= next.length) return prev;
      [next[idx], next[j]] = [next[j], next[idx]];
      return next;
    });
  }

  // Auto-save: debounce 800ms after the last edit. Avoids a write per
  // keystroke while still landing the row safely on idle. The save is
  // fire-and-forget — we surface a transient "Saved" pill so the
  // participant has feedback without an explicit Save button.
  useEffect(() => {
    if (rows === null || !myParticipantId) return;
    const handle = setTimeout(async () => {
      setSaving(true);
      const res = await sb.saveCapstoneDraft(myParticipantId, rows);
      setSaving(false);
      if (res?.ok) {
        setSavedNotice(true);
        setTimeout(() => setSavedNotice(false), 1200);
      }
    }, 800);
    return () => clearTimeout(handle);
  }, [rows, sb, myParticipantId]);

  const completeCount = useMemo(
    () => (rows || []).filter(r => isRowComplete(r, coworkers, participants)).length,
    [rows, coworkers, participants],
  );
  const allComplete = rows !== null && rows.length > 0 && rows.every(r => isRowComplete(r, coworkers, participants));
  const incompleteReason = useMemo(
    () => firstIncompleteReason(rows || [], coworkers, participants),
    [rows, coworkers, participants],
  );

  function handleSend() {
    const md = rowsToMarkdown(rows, flatFiles);
    onSendToCopilot?.(md);
  }

  if (rows === null) {
    return (
      <div className="capstone-page">
        <div className="capstone-loading">Loading your capstone draft&hellip;</div>
      </div>
    );
  }

  return (
    <div className="capstone-page">
      <div className="capstone-header">
        <div>
          <h2 className="capstone-title">Capstone</h2>
          <p className="capstone-sub">
            Lay out a real workflow. Each row is one step: what happens, who
            owns it (a saved coworker or a real reviewer), what reading
            material backs it, and what done looks like. When every row is
            bound,{' '}
            {copilotUnlocked
              ? 'send the plan to the copilot to build it in seconds.'
              : 'a copilot stage will unlock and you can send the plan to it to build the workflow in seconds.'}
            {' '}You’ll need at least one saved coworker in the library to fill this in.
          </p>
        </div>
        <div className="capstone-actions">
          <button
            type="button"
            className="capstone-btn-secondary"
            onClick={() => setDrawerOpen(true)}
          >
            <span className="capstone-btn-icon" aria-hidden>{'\u{1F4D8}'}</span>
            Show blueprint
          </button>
          {copilotUnlocked && (
            <button
              type="button"
              className="capstone-btn-primary"
              onClick={handleSend}
              disabled={!allComplete}
              title={allComplete ? 'Send your plan to the workflow copilot' : (incompleteReason || `Fill every row first (${completeCount}/${rows.length} complete)`)}
            >
              Send to copilot
              <span className="capstone-btn-icon" aria-hidden>{'↗'}</span>
            </button>
          )}
        </div>
      </div>

      <div className="capstone-status">
        <span>{completeCount} of {rows.length} step{rows.length === 1 ? '' : 's'} complete</span>
        {saving && <span className="capstone-status-saving">Saving&hellip;</span>}
        {!saving && savedNotice && <span className="capstone-status-saved">Saved</span>}
      </div>

      <div className="capstone-table">
        <div className="capstone-table-head">
          <div className="capstone-col-num">#</div>
          <div className="capstone-col-step">Step</div>
          <div className="capstone-col-actor">Actor</div>
          <div className="capstone-col-files">Reference files</div>
          <div className="capstone-col-remarks">Remarks (logic + DoD)</div>
          <div className="capstone-col-actions" />
        </div>
        {rows.map((row, idx) => (
          <div key={row.id} className={`capstone-row${isRowComplete(row, coworkers, participants) ? ' is-complete' : ''} type-${row.type || 'coworker'}`}>
            <div className="capstone-col-num">{idx + 1}</div>
            <div className="capstone-col-step">
              <textarea
                value={row.step}
                placeholder={row.type === 'review'
                  ? 'e.g. Risk memo reviewed and approved'
                  : 'e.g. Client basic profile created'}
                onChange={e => update(idx, { step: e.target.value })}
                rows={2}
              />
            </div>
            <div className="capstone-col-actor">
              <div className="capstone-type-toggle" role="group" aria-label="Step type">
                <button
                  type="button"
                  className={`capstone-type-btn${(row.type || 'coworker') === 'coworker' ? ' active' : ''}`}
                  onClick={() => {
                    if ((row.type || 'coworker') === 'coworker') return;
                    // Type flip clears the actor binding — coworker ids and
                    // participant ids don't cross-reference.
                    update(idx, { type: 'coworker', actorId: '', actorName: '' });
                  }}
                >
                  <span aria-hidden>{'\u{1F916}'}</span> Coworker
                </button>
                <button
                  type="button"
                  className={`capstone-type-btn${row.type === 'review' ? ' active' : ''}`}
                  onClick={() => {
                    if (row.type === 'review') return;
                    update(idx, { type: 'review', actorId: '', actorName: '' });
                  }}
                >
                  <span aria-hidden>{'\u{1F464}'}</span> Review
                </button>
              </div>
              <ActorPicker
                row={row}
                coworkers={coworkers}
                participants={participants}
                onActorChange={patch => update(idx, patch)}
              />
            </div>
            <div className="capstone-col-files">
              <FilePicker
                value={row.fileIds}
                onChange={fileIds => update(idx, { fileIds })}
                fileTree={fileTree}
              />
            </div>
            <textarea
              className="capstone-col-remarks"
              value={row.remarks}
              placeholder="Logic + Definition of Done"
              onChange={e => update(idx, { remarks: e.target.value })}
              rows={3}
            />
            <div className="capstone-col-actions">
              <button
                type="button"
                className="capstone-row-btn"
                onClick={() => moveRow(idx, -1)}
                disabled={idx === 0}
                title="Move up"
              >{'↑'}</button>
              <button
                type="button"
                className="capstone-row-btn"
                onClick={() => moveRow(idx, 1)}
                disabled={idx === rows.length - 1}
                title="Move down"
              >{'↓'}</button>
              <button
                type="button"
                className="capstone-row-btn capstone-row-delete"
                onClick={() => deleteRow(idx)}
                disabled={rows.length === 1}
                title="Delete row"
              >{'✕'}</button>
            </div>
          </div>
        ))}
      </div>

      <button
        type="button"
        className="capstone-add-row"
        onClick={addRow}
      >
        + Add step
      </button>

      <BlueprintDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        blueprintContent={blueprintFile?.content}
      />
    </div>
  );
}
