import { useEffect, useMemo, useRef, useState } from 'react';
import { CAPSTONE_BLUEPRINT_REFERENCE } from '../data/exampleArtifacts';

// Capstone tab — Stage 8. Each row is a step spec for the workflow.
//
// Coworker step: the step text becomes the coworker's role, and the row
// also picks knowledge files and skills files. On Send-to-copilot, the
// row materializes into a real saved coworker (auto-named from the step
// text) that lands in the participant's library and is then referenced
// by name on the canvas.
//
// Human step: pick a real human in the room + remarks describing what
// they verify. Materializes as a Review node assigned to that human.
//
// Stage 5 (Coworkers) teaches the primitive — name, role, knowledge,
// skills. Stage 8 USES the same primitive at workflow scale: every
// coworker step IS a coworker spec. The teaching arc is "one coworker,
// then a team of them, defined the same way."
//
// Persistence: per-participant per-room via sb.loadCapstoneDraft /
// sb.saveCapstoneDraft. No realtime — single-author edits.

function newRow() {
  return {
    id: 'row-' + Math.random().toString(36).slice(2, 10),
    type: 'coworker', // 'coworker' | 'human'
    step: '',
    knowledgeFileIds: [], // coworker-only
    skillsFileIds: [],    // coworker-only
    reviewerId: '',       // human-only
    reviewerName: '',     // human-only — cached for stale-handling
    remarks: '',          // human-only — what they verify
  };
}

// One-time migration of pre-redesign drafts. Old shape had:
//   { type: 'coworker'|'review', actorId, actorName, fileIds, remarks }
// where files were a single combined knowledge+skills picker and the
// actor pointed at a saved coworker (coworker rows) or participant
// (review rows). We map it forward best-effort: the freeform actor binding
// no longer applies to coworker rows (the spec replaces it), but for
// review rows we copy actor → reviewer. Old fileIds get parked into
// knowledgeFileIds since we can't tell from the row alone which folder
// they came from; the participant can re-split if it matters.
function migrateRow(row) {
  if (!row || typeof row !== 'object') return newRow();
  const next = { ...newRow(), ...row };
  if (row.type === 'review') next.type = 'human';
  if (row.type === 'review' && row.actorId && !row.reviewerId) {
    next.reviewerId = row.actorId;
    next.reviewerName = row.actorName || '';
  }
  if (Array.isArray(row.fileIds) && row.fileIds.length && !row.knowledgeFileIds && !row.skillsFileIds) {
    next.knowledgeFileIds = row.fileIds;
  }
  // Drop legacy fields so the saved draft converges on the new shape.
  delete next.actorId;
  delete next.actorName;
  delete next.fileIds;
  delete next.node;
  return next;
}

function rowTypeLabel(type) {
  return type === 'human' ? 'Human review' : 'AI coworker';
}

// Derive a coworker name from the step text. Takes the first ~5 words,
// title-cased, capped. The participant sees this preview under the row
// before they hit Send. Uniqueness against other rows in the same plan
// (and against the existing library) is handled in App.jsx at send time.
export function deriveCoworkerName(step) {
  const cleaned = (step || '').trim().replace(/\s+/g, ' ');
  if (!cleaned) return '';
  const words = cleaned.split(' ').slice(0, 5);
  const titled = words.map(w => w ? w[0].toUpperCase() + w.slice(1).toLowerCase() : w).join(' ');
  return titled.replace(/[.,;:!?]+$/, '').slice(0, 60);
}

function isRowComplete(row, participants) {
  const step = (row.step || '').trim();
  if (!step) return false;
  if ((row.type || 'coworker') === 'coworker') {
    // At least one knowledge or skills file backing the spec — the
    // materialized coworker has nothing to behave from otherwise.
    const hasFiles = (row.knowledgeFileIds || []).length > 0 || (row.skillsFileIds || []).length > 0;
    return hasFiles;
  }
  // Human row — accept either a picked participant or a typed name.
  // Cross-room messaging isn't built so a typed name won't actually
  // notify a human at workflow run time, but for the Capstone
  // planning artifact a name is enough. The step textarea doubles
  // as the prompt the reviewer sees.
  if (!(row.reviewerName || '').trim()) return false;
  return true;
}

function firstIncompleteReason(rows, participants) {
  for (let i = 0; i < (rows || []).length; i++) {
    const r = rows[i];
    const num = i + 1;
    if (!(r.step || '').trim()) {
      return (r.type || 'coworker') === 'coworker'
        ? `Step ${num}: describe what the coworker does`
        : `Step ${num}: describe what the human verifies`;
    }
    if ((r.type || 'coworker') === 'coworker') {
      const hasFiles = (r.knowledgeFileIds || []).length > 0 || (r.skillsFileIds || []).length > 0;
      if (!hasFiles) return `Step ${num}: attach at least one knowledge or skills file`;
    } else {
      if (!(r.reviewerName || '').trim()) return `Step ${num}: name a reviewer`;
    }
  }
  return null;
}

// Walk the file tree, returning files inside the named subfolder
// ('knowledge' or 'skills'). Used by FilePicker; supports the two
// pickers on a coworker card without leaking files between folders.
function flattenForPicker(tree, folder) {
  const out = [];
  if (!tree) return out;
  function walk(node, ancestorFolderName) {
    if (!node) return;
    const nextAncestor = node.type === 'folder' ? node.name : ancestorFolderName;
    if (node.type === 'file' && ancestorFolderName === folder) {
      out.push({ id: node.id, name: node.name });
    }
    for (const child of node.children || []) walk(child, nextAncestor);
  }
  walk(tree, null);
  return out;
}

function stripExt(name) {
  return (name || '').replace(/\.md$/i, '');
}

function FilePicker({ value, onChange, fileTree, folder }) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef(null);
  const options = useMemo(() => flattenForPicker(fileTree, folder), [fileTree, folder]);
  const selectedNames = (value || [])
    .map(id => options.find(o => o.id === id)?.name)
    .filter(Boolean)
    .map(stripExt);

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

  function toggle(id) {
    const next = (value || []).includes(id)
      ? (value || []).filter(x => x !== id)
      : [...(value || []), id];
    onChange(next);
  }

  const placeholder = folder === 'skills' ? 'Pick skills files…' : 'Pick knowledge files…';
  const emptyMsg = folder === 'skills'
    ? 'No skills files yet — write one in the Files tab.'
    : 'No knowledge files yet — add one in the Files tab.';

  return (
    <div className="capstone-filepicker" ref={containerRef}>
      <button
        type="button"
        className={`capstone-filepicker-btn${selectedNames.length > 0 ? ' has-selection' : ''}`}
        onClick={() => setOpen(o => !o)}
      >
        <span className="capstone-filepicker-content">
          {selectedNames.length === 0 ? (
            <span className="capstone-filepicker-placeholder">{placeholder}</span>
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
            <div className="capstone-filepicker-empty">{emptyMsg}</div>
          ) : (
            options.map(opt => (
              <label key={opt.id} className="capstone-filepicker-option">
                <input
                  type="checkbox"
                  checked={(value || []).includes(opt.id)}
                  onChange={() => toggle(opt.id)}
                />
                <span className="capstone-filepicker-option-name">{stripExt(opt.name)}</span>
              </label>
            ))
          )}
        </div>
      )}
    </div>
  );
}

// Reviewer picker for human steps — single-select dropdown over the
// room's humans, with free-text fallback for planning purposes.
//
// Hybrid combo: text input + suggestions dropdown. The participant
// can type any reviewer name (useful when they want to plan a step
// for someone who hasn't joined the workshop yet, or to test the
// flow solo) and pick a real human from the dropdown when one is
// in the room. Cross-room messaging isn't built out yet, so a
// custom-named reviewer won't actually receive notifications at
// workflow run time — but for the Capstone planning artifact
// that's an acceptable trade-off.
function ReviewerPicker({ value, valueName, participants, onChange }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState(valueName || '');
  const containerRef = useRef(null);

  // Sync local text with parent state when it changes externally
  // (e.g. type flip clears the row).
  useEffect(() => {
    setText(valueName || '');
  }, [valueName]);

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

  const options = useMemo(() => (
    (participants || [])
      .filter(p => (p.kind || 'human') === 'human' && (p.name || '').trim())
      .map(p => ({ id: p.id, name: p.name, sub: p.online ? 'online' : 'offline' }))
  ), [participants]);

  const filtered = useMemo(() => {
    const t = text.trim().toLowerCase();
    if (!t) return options;
    return options.filter(o => o.name.toLowerCase().includes(t));
  }, [options, text]);

  function commit(name) {
    setText(name);
    const trimmed = name.trim();
    // Try to match an option by exact (case-insensitive) name; otherwise
    // accept as a free-text reviewer (no participant id).
    const match = options.find(o => o.name.toLowerCase() === trimmed.toLowerCase());
    if (match) {
      onChange({ reviewerId: match.id, reviewerName: match.name });
    } else {
      onChange({ reviewerId: '', reviewerName: trimmed });
    }
  }

  function pick(opt) {
    setText(opt.name);
    onChange({ reviewerId: opt.id, reviewerName: opt.name });
    setOpen(false);
  }

  return (
    <div className="capstone-actorpicker" ref={containerRef}>
      <input
        type="text"
        className="capstone-actorpicker-input"
        value={text}
        placeholder="Type a name or pick…"
        onChange={e => commit(e.target.value)}
        onFocus={() => setOpen(true)}
      />
      <span className="capstone-actorpicker-caret" aria-hidden>{open ? '▴' : '▾'}</span>
      {open && (
        <div className="capstone-actorpicker-menu">
          {filtered.length === 0 ? (
            <div className="capstone-actorpicker-empty">
              {options.length === 0
                ? 'No humans in the workshop yet — type a name above.'
                : 'No matches — keep typing to use the name as-is.'}
            </div>
          ) : (
            filtered.map(opt => (
              <button
                type="button"
                key={opt.id}
                className={`capstone-actorpicker-option${opt.id === value ? ' is-selected' : ''}`}
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

function StepCard({ row, idx, isLast, isComplete, fileTree, participants, onUpdate, onMove, onDelete, canDelete }) {
  const isCoworker = (row.type || 'coworker') !== 'human';
  const derivedName = isCoworker ? deriveCoworkerName(row.step) : '';

  return (
    <div className={`capstone-card${isComplete ? ' is-complete' : ''} type-${isCoworker ? 'coworker' : 'human'}`}>
      <div className="capstone-card-header">
        <div className="capstone-card-num">Step {idx + 1}</div>
        <div className="capstone-type-toggle" role="group" aria-label="Step type">
          <button
            type="button"
            className={`capstone-type-btn${isCoworker ? ' active' : ''}`}
            onClick={() => {
              if (isCoworker) return;
              // Type flip clears the human-only fields. Step text stays;
              // the participant usually wants to keep the description.
              onUpdate({ type: 'coworker', reviewerId: '', reviewerName: '', remarks: '' });
            }}
          >
            <span aria-hidden>{'\u{1F916}'}</span> Coworker
          </button>
          <button
            type="button"
            className={`capstone-type-btn${!isCoworker ? ' active' : ''}`}
            onClick={() => {
              if (!isCoworker) return;
              onUpdate({ type: 'human', knowledgeFileIds: [], skillsFileIds: [] });
            }}
          >
            <span aria-hidden>{'\u{1F464}'}</span> Human
          </button>
        </div>
        <div className="capstone-card-actions">
          <button type="button" className="capstone-row-btn" onClick={() => onMove(-1)} disabled={idx === 0} title="Move up">{'↑'}</button>
          <button type="button" className="capstone-row-btn" onClick={() => onMove(1)} disabled={isLast} title="Move down">{'↓'}</button>
          <button type="button" className="capstone-row-btn capstone-row-delete" onClick={onDelete} disabled={!canDelete} title="Delete step">{'✕'}</button>
        </div>
      </div>

      <div className="capstone-card-body">
        {isCoworker ? (
          <>
            <label className="capstone-field">
              <span className="capstone-field-label">
                What does the coworker do? (becomes the coworker’s role)
              </span>
              <textarea
                className="capstone-field-input"
                value={row.step}
                placeholder="e.g. Capture borrower identity, registration, ownership, and guarantor details."
                onChange={e => onUpdate({ step: e.target.value })}
                rows={3}
              />
            </label>
            <div className="capstone-field-row">
              <label className="capstone-field">
                <span className="capstone-field-label">Knowledge files</span>
                <FilePicker
                  value={row.knowledgeFileIds || []}
                  onChange={ids => onUpdate({ knowledgeFileIds: ids })}
                  fileTree={fileTree}
                  folder="knowledge"
                />
              </label>
              <label className="capstone-field">
                <span className="capstone-field-label">Skills files</span>
                <FilePicker
                  value={row.skillsFileIds || []}
                  onChange={ids => onUpdate({ skillsFileIds: ids })}
                  fileTree={fileTree}
                  folder="skills"
                />
              </label>
            </div>
            {derivedName && (
              <div className="capstone-card-name-preview">
                Will create coworker: <strong>{derivedName}</strong>
              </div>
            )}
          </>
        ) : (
          // Human card: single content row — step textarea on the left
          // (wider) with the reviewer picker on the right. Eliminates the
          // dead column that appeared when remarks went away.
          <div className="capstone-field-row capstone-field-row-human">
            <label className="capstone-field">
              <span className="capstone-field-label">What does the human verify or approve?</span>
              <textarea
                className="capstone-field-input"
                value={row.step}
                placeholder="e.g. Risk memo reviewed and approved."
                onChange={e => onUpdate({ step: e.target.value })}
                rows={3}
              />
            </label>
            <label className="capstone-field">
              <span className="capstone-field-label">Reviewer</span>
              <ReviewerPicker
                value={row.reviewerId}
                valueName={row.reviewerName}
                participants={participants}
                onChange={patch => onUpdate(patch)}
              />
            </label>
          </div>
        )}
      </div>
    </div>
  );
}

// Read-only StepCard variant. Renders a blueprint row in the same
// shape as the editable cards above so the reference *is* the same
// surface the participant fills in — labels in the same places, file
// chips where the FilePicker would be, the auto-name preview where
// the live one shows.
function BlueprintCard({ row, idx }) {
  const isCoworker = row.type !== 'human';
  const derivedName = isCoworker ? deriveCoworkerName(row.step) : '';
  return (
    <div className={`capstone-card capstone-card--blueprint type-${isCoworker ? 'coworker' : 'human'}`}>
      <div className="capstone-card-header">
        <div className="capstone-card-num">Step {idx + 1}</div>
        <div className={`capstone-card-type-badge type-${isCoworker ? 'coworker' : 'human'}`}>
          <span aria-hidden>{isCoworker ? '\u{1F916}' : '\u{1F464}'}</span>
          {isCoworker ? 'Coworker' : 'Human'}
        </div>
      </div>
      <div className="capstone-card-body">
        {isCoworker ? (
          <>
            <div className="capstone-blueprint-field">
              <span className="capstone-field-label">What does the coworker do</span>
              <p className="capstone-blueprint-text">{row.step}</p>
            </div>
            <div className="capstone-field-row">
              <div className="capstone-blueprint-field">
                <span className="capstone-field-label">Knowledge files</span>
                <BlueprintChips items={row.knowledgeFiles} />
              </div>
              <div className="capstone-blueprint-field">
                <span className="capstone-field-label">Skills files</span>
                <BlueprintChips items={row.skillsFiles} />
              </div>
            </div>
            {derivedName && (
              <div className="capstone-card-name-preview">
                Will create coworker: <strong>{derivedName}</strong>
              </div>
            )}
          </>
        ) : (
          <div className="capstone-field-row capstone-field-row-human">
            <div className="capstone-blueprint-field">
              <span className="capstone-field-label">What does the human verify</span>
              <p className="capstone-blueprint-text">{row.step}</p>
            </div>
            <div className="capstone-blueprint-field">
              <span className="capstone-field-label">Reviewer</span>
              <p className="capstone-blueprint-empty">Pick someone in the room</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function BlueprintChips({ items }) {
  if (!items || items.length === 0) {
    return <p className="capstone-blueprint-empty">—</p>;
  }
  return (
    <div className="capstone-blueprint-chips">
      {items.map((name, i) => (
        <span key={i} className="capstone-filepicker-chip">{name}</span>
      ))}
    </div>
  );
}

function BlueprintDrawer({ open, onClose, blueprint }) {
  if (!open) return null;
  return (
    <div className="capstone-drawer-backdrop" onClick={onClose}>
      <aside
        className="capstone-drawer capstone-drawer--blueprint"
        onClick={e => e.stopPropagation()}
        role="dialog"
        aria-label="Workflow blueprint reference"
      >
        <div className="capstone-drawer-header">
          <h3>Workflow blueprint</h3>
          <button className="capstone-drawer-close" onClick={onClose} aria-label="Close blueprint">{'✕'}</button>
        </div>
        <div className="capstone-drawer-body capstone-drawer-body--blueprint">
          <div className="capstone-blueprint-intro">
            <h4 className="capstone-blueprint-title">{blueprint.title}</h4>
            <p className="capstone-blueprint-sub">{blueprint.intro}</p>
          </div>
          <div className="capstone-blueprint-cards">
            {blueprint.rows.map((row, idx) => (
              <BlueprintCard key={idx} row={row} idx={idx} />
            ))}
          </div>
        </div>
      </aside>
    </div>
  );
}

export default function Capstone({
  sb,
  myParticipantId,
  fileTree,
  participants,
  copilotUnlocked,
  onSendToCopilot,
}) {
  const [rows, setRows] = useState(null); // null = loading
  const [saving, setSaving] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [savedNotice, setSavedNotice] = useState(false);
  const [sending, setSending] = useState(false);

  // One-shot load. Old drafts use the previous shape ({ actorId, fileIds,
  // type:'review' }); migrateRow rewrites them on load so the participant
  // doesn't see broken cards.
  useEffect(() => {
    let cancelled = false;
    if (!myParticipantId || !sb) {
      setRows([newRow()]);
      return;
    }
    sb.loadCapstoneDraft(myParticipantId).then(serverRows => {
      if (cancelled) return;
      if (Array.isArray(serverRows) && serverRows.length > 0) {
        setRows(serverRows.map(migrateRow));
      } else {
        setRows([newRow()]);
      }
    }).catch(() => { if (!cancelled) setRows([newRow()]); });
    return () => { cancelled = true; };
  }, [sb, myParticipantId]);

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

  // Auto-save: debounce 800ms after the last edit. Same pattern as before.
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
    () => (rows || []).filter(r => isRowComplete(r, participants)).length,
    [rows, participants],
  );
  const allComplete = rows !== null && rows.length > 0 && rows.every(r => isRowComplete(r, participants));
  const incompleteReason = useMemo(
    () => firstIncompleteReason(rows || [], participants),
    [rows, participants],
  );

  async function handleSend() {
    if (!allComplete || sending) return;
    setSending(true);
    try {
      await onSendToCopilot?.(rows);
    } finally {
      setSending(false);
    }
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
            Lay out a real workflow step by step. Each Coworker step
            describes what an AI teammate does — and on Send, that
            description becomes a coworker in your library, named for
            you, ready to wire onto the canvas. Human steps assign a
            real reviewer in the room. Clarity is the slow step;
            building should feel fast.
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
              disabled={!allComplete || sending}
              title={allComplete ? 'Materialize coworkers and send the plan to the copilot' : (incompleteReason || `Fill every step first (${completeCount}/${rows.length} complete)`)}
            >
              {sending ? 'Sending…' : 'Send to copilot'}
              <span className="capstone-btn-icon" aria-hidden>↗</span>
            </button>
          )}
        </div>
      </div>

      <div className="capstone-status">
        <span>{completeCount} of {rows.length} step{rows.length === 1 ? '' : 's'} complete</span>
        {saving && <span className="capstone-status-saving">Saving&hellip;</span>}
        {!saving && savedNotice && <span className="capstone-status-saved">Saved</span>}
      </div>

      <div className="capstone-cards">
        {rows.map((row, idx) => (
          <StepCard
            key={row.id}
            row={row}
            idx={idx}
            isLast={idx === rows.length - 1}
            isComplete={isRowComplete(row, participants)}
            fileTree={fileTree}
            participants={participants}
            onUpdate={patch => update(idx, patch)}
            onMove={dir => moveRow(idx, dir)}
            onDelete={() => deleteRow(idx)}
            canDelete={rows.length > 1}
          />
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
        blueprint={CAPSTONE_BLUEPRINT_REFERENCE}
      />
    </div>
  );
}
