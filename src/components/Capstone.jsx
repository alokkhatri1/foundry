import { useEffect, useMemo, useState } from 'react';
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
    step: '',
    node: '',
    fileIds: [],
    remarks: '',
  };
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

function isRowComplete(row) {
  return !!(
    combinedStep(row) &&
    (row.fileIds || []).length > 0 &&
    (row.remarks || '').trim()
  );
}

// Markdown rendering of the participant's plan, used for both the
// "Send to copilot" payload and a copy-to-clipboard fallback. Same shape
// for both so the copilot sees what the participant sees.
function rowsToMarkdown(rows, fileTreeFlat) {
  const fileNameById = new Map((fileTreeFlat || []).map(f => [f.id, f.name]));
  const lines = ['Build a workflow with these steps:', ''];
  rows.forEach((r, i) => {
    const fileNames = (r.fileIds || []).map(id => fileNameById.get(id) || id).filter(Boolean);
    lines.push(`### Step ${i + 1}: ${combinedStep(r)}`);
    if (fileNames.length) lines.push(`- **Knowledge & skills files:** ${fileNames.join(', ')}`);
    lines.push(`- **Remarks:** ${r.remarks}`);
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
  const options = useMemo(() => flattenForPicker(fileTree), [fileTree]);
  const selectedNames = (value || [])
    .map(id => options.find(o => o.id === id)?.name)
    .filter(Boolean)
    .map(stripExt);

  function toggle(id) {
    const next = (value || []).includes(id)
      ? (value || []).filter(x => x !== id)
      : [...(value || []), id];
    onChange(next);
  }

  // Compact summary inside the button so the cell doesn't grow a tag stack
  // beneath it. Show up to two names; collapse the rest into "+N more".
  const summary = (() => {
    if (selectedNames.length === 0) return null;
    if (selectedNames.length <= 2) return selectedNames.join(', ');
    return `${selectedNames.slice(0, 2).join(', ')} +${selectedNames.length - 2} more`;
  })();

  return (
    <div className="capstone-filepicker">
      <button
        type="button"
        className={`capstone-filepicker-btn${summary ? ' has-selection' : ''}`}
        onClick={() => setOpen(o => !o)}
      >
        <span className="capstone-filepicker-summary">
          {summary || 'Pick files…'}
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
    () => (rows || []).filter(isRowComplete).length,
    [rows],
  );
  const allComplete = rows !== null && rows.length > 0 && rows.every(isRowComplete);

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
            Lay out a real workflow as a five-column plan. Each row is one step:
            who owns it, where the data lives, what reading material backs it,
            and what done looks like. When every row is filled,{' '}
            {copilotUnlocked
              ? 'send the plan to the copilot to build it together.'
              : 'a copilot stage will unlock and you can send the plan to it to build the workflow together.'}
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
              title={allComplete ? 'Send your plan to the workflow copilot' : `Fill all 5 fields on every row first (${completeCount}/${rows.length} complete)`}
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
          <div className="capstone-col-step">Step / Node</div>
          <div className="capstone-col-files">Knowledge &amp; skills files</div>
          <div className="capstone-col-remarks">Remarks (logic + DoD)</div>
          <div className="capstone-col-actions" />
        </div>
        {rows.map((row, idx) => (
          <div key={row.id} className={`capstone-row${isRowComplete(row) ? ' is-complete' : ''}`}>
            <div className="capstone-col-num">{idx + 1}</div>
            <textarea
              className="capstone-col-step"
              value={row.step}
              placeholder="e.g. Client basic profile created"
              onChange={e => update(idx, { step: e.target.value })}
              rows={2}
            />
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
