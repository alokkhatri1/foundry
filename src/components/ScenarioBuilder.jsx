import { useEffect, useMemo, useRef, useState } from 'react';
import { CAPSTONE_BLUEPRINT_REFERENCE } from '../data/exampleArtifacts';

// Orchestration tab — Stage 6 post-2026-05-09 redesign. Case-driven
// build that retired the React Flow DAG: the participant declares one
// real case, lays out a linear sequence of coworker + human-review
// steps, and clicks Run. The parent materializes the rows into a
// runnable workflow (coworkers built on the fly, steps wired in order),
// executes through the existing runWorkflow path, and auto-flips to
// Observability so the participant watches their run alongside the
// cohort's.
//
// Coworker step: step text becomes the coworker's role; the row picks
// knowledge + skills files. On Run, the row materializes into a real
// saved coworker (auto-named from the step text) and the executor
// wires it into the run as an agent step.
//
// Human step: pick a real human in the room. Materializes as an
// Approval step assigned to that human; the step text doubles as the
// prompt the reviewer sees.
//
// Persistence: rows + caseInput are per-participant per-room via
// sb.loadCapstoneDraft / sb.saveCapstoneDraft (same JSONB column as
// the retired Capstone tab — the artefact is the same shape, just
// executed rather than handed to a copilot).

function newRow() {
  return {
    id: 'row-' + Math.random().toString(36).slice(2, 10),
    type: 'coworker', // 'coworker' | 'human'
    name: '',             // coworker-only — what to call this teammate
    step: '',
    knowledgeFileIds: [], // coworker-only
    skillsFileIds: [],    // coworker-only
    reviewerId: '',       // human-only
    reviewerName: '',     // human-only — cached for stale-handling
    remarks: '',          // legacy, kept for back-compat
  };
}

// One-time migration of pre-redesign drafts. Old shape had:
//   { type: 'coworker'|'review', actorId, actorName, fileIds, remarks }
// where files were a single combined knowledge+skills picker and the
// actor pointed at a saved coworker (coworker rows) or participant
// (review rows). Map forward best-effort: review→human, actor→reviewer,
// fileIds→knowledgeFileIds (folder split is unrecoverable).
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
  // Backfill the new `name` field from the derived name so old drafts
  // surface as already-named (they were implicitly named all along).
  // The user can rename, but they don't get a wall of empty inputs.
  if (next.type === 'coworker' && !(next.name || '').trim()) {
    next.name = deriveCoworkerName(next.step) || '';
  }
  delete next.actorId;
  delete next.actorName;
  delete next.fileIds;
  delete next.node;
  return next;
}

// Derive a coworker name from the step text. Takes the first ~5 words,
// title-cased, capped. Uniqueness against other rows in the same plan
// (and against the existing library) is handled in App.jsx at send time.
export function deriveCoworkerName(step) {
  const cleaned = (step || '').trim().replace(/\s+/g, ' ');
  if (!cleaned) return '';
  const words = cleaned.split(' ').slice(0, 5);
  const titled = words.map(w => w ? w[0].toUpperCase() + w.slice(1).toLowerCase() : w).join(' ');
  return titled.replace(/[.,;:!?]+$/, '').slice(0, 60);
}

function isRowComplete(row) {
  const step = (row.step || '').trim();
  if (!step) return false;
  if ((row.type || 'coworker') === 'coworker') {
    if (!(row.name || '').trim()) return false;
    const hasFiles = (row.knowledgeFileIds || []).length > 0 || (row.skillsFileIds || []).length > 0;
    return hasFiles;
  }
  if (!(row.reviewerName || '').trim()) return false;
  return true;
}

function firstIncompleteReason(rows) {
  for (let i = 0; i < (rows || []).length; i++) {
    const r = rows[i];
    const num = i + 1;
    const isCoworker = (r.type || 'coworker') === 'coworker';
    if (isCoworker && !(r.name || '').trim()) {
      return `Step ${num}: name the coworker`;
    }
    if (!(r.step || '').trim()) {
      return isCoworker
        ? `Step ${num}: describe what the coworker does`
        : `Step ${num}: describe what the human verifies`;
    }
    if (isCoworker) {
      const hasFiles = (r.knowledgeFileIds || []).length > 0 || (r.skillsFileIds || []).length > 0;
      if (!hasFiles) return `Step ${num}: attach at least one knowledge or skills file`;
    } else {
      if (!(r.reviewerName || '').trim()) return `Step ${num}: name a reviewer`;
    }
  }
  return null;
}

function flattenForPicker(tree, folder) {
  const out = [];
  if (!tree) return out;
  function walk(node, ancestorFolderName) {
    if (!node) return;
    const nextAncestor = node.type === 'folder' ? node.name : ancestorFolderName;
    if (node.type === 'file' && ancestorFolderName === folder) {
      out.push({ id: node.id, name: node.name, createdBy: node.createdBy ?? null });
    }
    for (const child of node.children || []) walk(child, nextAncestor);
  }
  walk(tree, null);
  return out;
}

function stripExt(name) {
  return (name || '').replace(/\.md$/i, '');
}

function pad2(n) {
  return String(n).padStart(2, '0');
}

// localStorage fallback so a refresh always restores something even if
// Supabase is unreachable, the capstone_drafts table isn't migrated yet,
// or RLS denies the write. Per-participant key. The DB stays authoritative
// when available; this is just a safety net the participant can't lose.
function localCapstoneKey(participantId) {
  return participantId ? `foundry:capstone-draft:${participantId}` : null;
}
function loadLocalCapstoneDraft(participantId) {
  const key = localCapstoneKey(participantId);
  if (!key) return null;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : null;
  } catch { return null; }
}
function saveLocalCapstoneDraft(participantId, rows) {
  const key = localCapstoneKey(participantId);
  if (!key) return;
  try { localStorage.setItem(key, JSON.stringify(rows)); } catch {}
}

function relSavedLabel(now, ts) {
  if (!ts) return '';
  const sec = Math.max(0, Math.floor((now - ts) / 1000));
  if (sec < 5) return 'Saved';
  if (sec < 60) return `Saved ${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `Saved ${min}m ago`;
  return 'Saved';
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
    <div className={`cs-filepicker is-${folder}`} ref={containerRef}>
      <button
        type="button"
        className={`cs-filepicker-btn${selectedNames.length > 0 ? ' has-selection' : ''}`}
        onClick={() => setOpen(o => !o)}
      >
        <span className="cs-filepicker-content">
          {selectedNames.length === 0 ? (
            <span className="cs-filepicker-placeholder">{placeholder}</span>
          ) : (
            selectedNames.map((name, i) => (
              <span key={i} className={`cs-chip is-${folder}`}>{name}</span>
            ))
          )}
        </span>
        <span className="cs-filepicker-caret" aria-hidden>{open ? '▴' : '▾'}</span>
      </button>
      {open && (
        <div className="cs-filepicker-menu">
          {options.length === 0 ? (
            <div className="cs-filepicker-empty">{emptyMsg}</div>
          ) : (
            options.map(opt => (
              <label key={opt.id} className="cs-filepicker-option">
                <input
                  type="checkbox"
                  checked={(value || []).includes(opt.id)}
                  onChange={() => toggle(opt.id)}
                />
                <span className="cs-filepicker-option-name">{stripExt(opt.name)}</span>
                {opt.createdBy && (
                  <span className="cs-filepicker-option-author" title={`Authored by ${opt.createdBy}`}>
                    by {opt.createdBy}
                  </span>
                )}
              </label>
            ))
          )}
        </div>
      )}
    </div>
  );
}

function ReviewerPicker({ value, valueName, participants, onChange }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState(valueName || '');
  const containerRef = useRef(null);

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
      .map(p => ({ id: p.id, name: p.name, online: !!p.online }))
  ), [participants]);

  const filtered = useMemo(() => {
    const t = text.trim().toLowerCase();
    if (!t) return options;
    return options.filter(o => o.name.toLowerCase().includes(t));
  }, [options, text]);

  function commit(name) {
    setText(name);
    const trimmed = name.trim();
    if (!trimmed) {
      onChange({ reviewerId: '', reviewerName: '' });
      return;
    }
    // Only commit when the typed text exactly matches a real participant.
    // Cross-user assignment isn't supported (no notification system), so
    // free-text reviewer names would create a fake binding.
    const match = options.find(o => o.name.toLowerCase() === trimmed.toLowerCase());
    if (match) {
      onChange({ reviewerId: match.id, reviewerName: match.name });
    }
  }

  function pick(opt) {
    setText(opt.name);
    onChange({ reviewerId: opt.id, reviewerName: opt.name });
    setOpen(false);
  }

  return (
    <div className="cs-reviewer" ref={containerRef}>
      <input
        type="text"
        className="cs-reviewer-input"
        value={text}
        placeholder="Pick the reviewer…"
        onChange={e => { commit(e.target.value); setOpen(true); }}
        onMouseDown={() => setOpen(true)}
        onKeyDown={e => {
          if (e.key === 'Enter') { e.preventDefault(); setOpen(false); e.target.blur(); }
        }}
      />
      <button
        type="button"
        className="cs-reviewer-caret"
        onClick={() => setOpen(o => !o)}
        aria-label={open ? 'Close menu' : 'Open menu'}
      >{open ? '▴' : '▾'}</button>
      {open && (
        <div className="cs-reviewer-menu">
          {filtered.length === 0 ? (
            <div className="cs-reviewer-empty">
              {options.length === 0
                ? 'No reviewer available yet.'
                : 'No matches — clear the field and pick from the list.'}
            </div>
          ) : (
            filtered.map(opt => (
              <button
                type="button"
                key={opt.id}
                className={`cs-reviewer-option${opt.id === value ? ' is-selected' : ''}`}
                onMouseDown={e => { e.preventDefault(); pick(opt); }}
              >
                <span className="cs-reviewer-avatar" aria-hidden>{opt.name[0].toUpperCase()}</span>
                <span className="cs-reviewer-option-body">
                  <span className="cs-reviewer-option-name">{opt.name}</span>
                  <span className={`cs-reviewer-option-sub${opt.online ? ' is-online' : ''}`}>
                    {opt.online ? 'online' : 'offline'}
                  </span>
                </span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

function StepCard({
  row, idx, total, isLast, isComplete, fileTree, participants,
  collapsed, onUpdate, onMove, onDelete, onToggleCollapse, canDelete,
}) {
  const isCoworker = (row.type || 'coworker') !== 'human';
  const explicitName = (row.name || '').trim();
  const derivedName = isCoworker ? (explicitName || deriveCoworkerName(row.step)) : '';
  const reviewerName = (row.reviewerName || '').trim();
  const reviewerInitial = reviewerName ? reviewerName[0].toUpperCase() : '';
  const reviewerOnline = useMemo(() => {
    if (!row.reviewerId) return false;
    const p = (participants || []).find(p => p.id === row.reviewerId);
    return Boolean(p?.online);
  }, [row.reviewerId, participants]);

  const numStr = pad2(idx + 1);
  const totStr = pad2(total);
  const typeLabel = isCoworker ? 'COWORKER STEP' : 'HUMAN STEP';
  const knowledgeCount = (row.knowledgeFileIds || []).length;
  const skillsCount = (row.skillsFileIds || []).length;
  const stepText = (row.step || '').trim();

  if (collapsed) {
    return (
      <div
        className={`cs-card cs-card--collapsed${isComplete ? ' is-complete' : ''} type-${isCoworker ? 'coworker' : 'human'}`}
      >
        <button
          type="button"
          className="cs-collapsed-row"
          onClick={onToggleCollapse}
          aria-label="Expand step"
        >
          <span className="cs-collapsed-left">
            <span className="cs-num">{numStr}</span>
            <span className="cs-num-total">/ {totStr}</span>
            <span className="cs-divider" aria-hidden>|</span>
            <span className={`cs-type-pill type-${isCoworker ? 'coworker' : 'human'}`}>
              <span className="cs-type-dot" aria-hidden /> {typeLabel}
            </span>
            <span className="cs-divider" aria-hidden>|</span>
            <span className={`cs-collapsed-step${stepText ? '' : ' is-empty'}`}>
              {stepText || '— no step text yet —'}
            </span>
          </span>
          <span className="cs-collapsed-right">
            {isCoworker && derivedName && (
              <span className="cs-collapsed-name">{derivedName}</span>
            )}
            {isCoworker && (knowledgeCount + skillsCount > 0) && (
              <span className="cs-collapsed-chips">
                <span className="cs-mini-chip is-knowledge">{knowledgeCount}</span>
                <span className="cs-mini-chip-sep" aria-hidden>·</span>
                <span className="cs-mini-chip is-skills">{skillsCount}</span>
              </span>
            )}
            {!isCoworker && reviewerName && (
              <span className="cs-collapsed-reviewer">
                <span className="cs-avatar" aria-hidden>{reviewerInitial}</span>
                {reviewerName}
              </span>
            )}
            {isComplete && <span className="cs-pill-status is-ready"><span className="cs-pill-dot" aria-hidden />READY</span>}
            <span className="cs-chevron" aria-hidden>▾</span>
          </span>
        </button>
      </div>
    );
  }

  return (
    <div className={`cs-card${isComplete ? ' is-complete' : ''} type-${isCoworker ? 'coworker' : 'human'}`}>
      <div
        className="cs-card-head is-clickable"
        onClick={(e) => {
          // Bar-level click collapses the card. Clicks that land on (or
          // inside) a button stay with that button's own handler — type
          // toggle, up/down, delete, the chevron — none of those should
          // collapse the card as a side effect.
          if (e.target.closest('button')) return;
          onToggleCollapse();
        }}
      >
        <div className="cs-card-head-left">
          <span className="cs-num">{numStr}</span>
          <span className="cs-num-total">/ {totStr}</span>
          <span className="cs-divider" aria-hidden>|</span>
          <span className={`cs-type-pill type-${isCoworker ? 'coworker' : 'human'}`}>
            <span className="cs-type-dot" aria-hidden /> {typeLabel}
          </span>
        </div>
        <div className="cs-card-head-right">
          {isComplete && (
            <span className="cs-pill-status is-ready">
              <span className="cs-pill-dot" aria-hidden />READY
            </span>
          )}
          <div className="cs-type-toggle" role="group" aria-label="Step type">
            <button
              type="button"
              className={`cs-type-toggle-btn type-coworker${isCoworker ? ' is-active' : ''}`}
              onClick={() => {
                if (isCoworker) return;
                onUpdate({ type: 'coworker', reviewerId: '', reviewerName: '', remarks: '' });
              }}
            >
              <span className="cs-toggle-dot type-coworker" aria-hidden />
              COWORKER
            </button>
            <button
              type="button"
              className={`cs-type-toggle-btn type-human${!isCoworker ? ' is-active' : ''}`}
              onClick={() => {
                if (!isCoworker) return;
                onUpdate({ type: 'human', knowledgeFileIds: [], skillsFileIds: [] });
              }}
            >
              <span className="cs-toggle-dot type-human" aria-hidden />
              HUMAN
            </button>
          </div>
          <button
            type="button"
            className="cs-icon-btn"
            onClick={() => onMove(-1)}
            disabled={idx === 0}
            title="Move up"
            aria-label="Move up"
          >↑</button>
          <button
            type="button"
            className="cs-icon-btn"
            onClick={() => onMove(1)}
            disabled={isLast}
            title="Move down"
            aria-label="Move down"
          >↓</button>
          <button
            type="button"
            className="cs-icon-btn cs-icon-btn--danger"
            onClick={onDelete}
            disabled={!canDelete}
            title="Delete step"
            aria-label="Delete step"
          >✕</button>
          <button
            type="button"
            className="cs-icon-btn"
            onClick={onToggleCollapse}
            title="Collapse"
            aria-label="Collapse step"
          >▴</button>
        </div>
      </div>

      <div className="cs-card-body">
        {isCoworker ? (
          <>
            <label className="cs-field">
              <span className="cs-field-label">
                COWORKER NAME
                <em className="cs-field-hint">what to call them</em>
              </span>
              <input
                type="text"
                className="cs-input"
                value={row.name || ''}
                placeholder="e.g. Compliance Reviewer"
                onChange={e => onUpdate({ name: e.target.value })}
                maxLength={60}
              />
            </label>
            <label className="cs-field">
              <span className="cs-field-label">WHAT DOES THE COWORKER DO?</span>
              <textarea
                className="cs-textarea"
                value={row.step}
                placeholder="e.g. Capture borrower identity, registration, ownership, and guarantor details from the application."
                onChange={e => onUpdate({ step: e.target.value })}
                rows={3}
              />
            </label>
            <div className="cs-field-row">
              <label className="cs-field">
                <span className="cs-field-label">
                  <span className="cs-label-dot is-knowledge" aria-hidden />
                  KNOWLEDGE FILES
                  <em className="cs-field-hint">what it reads</em>
                </span>
                <FilePicker
                  value={row.knowledgeFileIds || []}
                  onChange={ids => onUpdate({ knowledgeFileIds: ids })}
                  fileTree={fileTree}
                  folder="knowledge"
                />
              </label>
              <label className="cs-field">
                <span className="cs-field-label">
                  <span className="cs-label-dot is-skills" aria-hidden />
                  SKILLS FILES
                  <em className="cs-field-hint">what it produces</em>
                </span>
                <FilePicker
                  value={row.skillsFileIds || []}
                  onChange={ids => onUpdate({ skillsFileIds: ids })}
                  fileTree={fileTree}
                  folder="skills"
                />
              </label>
            </div>
            {derivedName && (
              <div className="cs-becomes is-coworker">
                <span className="cs-becomes-label">ON SEND, BECOMES A COWORKER NAMED</span>
                <span className="cs-becomes-name">{derivedName}</span>
                <span className="cs-becomes-arrow" aria-hidden>↗</span>
              </div>
            )}
          </>
        ) : (
          <>
            <label className="cs-field">
              <span className="cs-field-label">WHAT DOES THE HUMAN VERIFY OR APPROVE?</span>
              <textarea
                className="cs-textarea"
                value={row.step}
                placeholder="e.g. Risk memo reviewed and approved."
                onChange={e => onUpdate({ step: e.target.value })}
                rows={3}
              />
            </label>
            <label className="cs-field">
              <span className="cs-field-label">
                <span className="cs-label-dot is-human" aria-hidden />
                REVIEWER
                <em className="cs-field-hint">who signs off</em>
              </span>
              <ReviewerPicker
                value={row.reviewerId}
                valueName={row.reviewerName}
                participants={participants}
                onChange={patch => onUpdate(patch)}
              />
            </label>
            {reviewerName && (
              <div className="cs-becomes is-human">
                <span className="cs-becomes-label">ON SEND, BECOMES A REVIEW NODE ASSIGNED TO</span>
                <span className="cs-becomes-avatar" aria-hidden>{reviewerInitial}</span>
                <span className="cs-becomes-name">{reviewerName}</span>
                <span className={`cs-becomes-status${reviewerOnline ? ' is-online' : ''}`}>
                  <span className="cs-pill-dot" aria-hidden />
                  {reviewerOnline ? 'ONLINE' : 'OFFLINE'}
                </span>
                <span className="cs-becomes-arrow" aria-hidden>↗</span>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function BlueprintChips({ items, flavor }) {
  if (!items || items.length === 0) {
    return <p className="cs-blueprint-empty">—</p>;
  }
  return (
    <div className="cs-blueprint-chips">
      {items.map((name, i) => (
        <span key={i} className={`cs-chip is-${flavor}`}>{stripExt(name)}</span>
      ))}
    </div>
  );
}

function BlueprintCard({ row, idx, total }) {
  const isCoworker = row.type !== 'human';
  const explicitName = (row.name || '').trim();
  const derivedName = isCoworker ? (explicitName || deriveCoworkerName(row.step)) : '';
  const reviewerName = (row.reviewerName || row.reviewer || '').trim();
  const reviewerInitial = reviewerName ? reviewerName[0].toUpperCase() : '';
  const numStr = pad2(idx + 1);
  const totStr = pad2(total);
  const typeLabel = isCoworker ? 'COWORKER STEP' : 'HUMAN STEP';

  return (
    <div className={`cs-card cs-card--blueprint type-${isCoworker ? 'coworker' : 'human'}`}>
      <div className="cs-card-head">
        <div className="cs-card-head-left">
          <span className="cs-num">{numStr}</span>
          <span className="cs-num-total">/ {totStr}</span>
          <span className="cs-divider" aria-hidden>|</span>
          <span className={`cs-type-pill type-${isCoworker ? 'coworker' : 'human'}`}>
            <span className="cs-type-dot" aria-hidden /> {typeLabel}
          </span>
        </div>
      </div>
      <div className="cs-card-body">
        {isCoworker ? (
          <>
            <div className="cs-field">
              <span className="cs-field-label">WHAT THE COWORKER DOES</span>
              <p className="cs-blueprint-text">{row.step}</p>
            </div>
            <div className="cs-field-row">
              <div className="cs-field">
                <span className="cs-field-label">
                  <span className="cs-label-dot is-knowledge" aria-hidden />
                  KNOWLEDGE
                </span>
                <BlueprintChips items={row.knowledgeFiles} flavor="knowledge" />
              </div>
              <div className="cs-field">
                <span className="cs-field-label">
                  <span className="cs-label-dot is-skills" aria-hidden />
                  SKILLS
                </span>
                <BlueprintChips items={row.skillsFiles} flavor="skills" />
              </div>
            </div>
            {derivedName && (
              <div className="cs-becomes is-coworker">
                <span className="cs-becomes-label">BECOMES A COWORKER NAMED</span>
                <span className="cs-becomes-name">{derivedName}</span>
                <span className="cs-becomes-arrow" aria-hidden>↗</span>
              </div>
            )}
          </>
        ) : (
          <>
            <div className="cs-field">
              <span className="cs-field-label">WHAT THE HUMAN VERIFIES</span>
              <p className="cs-blueprint-text">{row.step}</p>
            </div>
            <div className="cs-field">
              <span className="cs-field-label">
                <span className="cs-label-dot is-human" aria-hidden />
                REVIEWER
              </span>
              {reviewerName ? (
                <p className="cs-blueprint-text cs-blueprint-text--reviewer">
                  <span className="cs-becomes-avatar" aria-hidden>{reviewerInitial}</span>
                  {reviewerName}
                </p>
              ) : (
                <p className="cs-blueprint-empty">Pick someone in the room</p>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function BlueprintDrawer({ open, onClose, blueprint }) {
  if (!open) return null;
  return (
    <div className="cs-drawer-backdrop" onClick={onClose}>
      <aside
        className="cs-drawer"
        onClick={e => e.stopPropagation()}
        role="dialog"
        aria-label="Workflow reference"
      >
        <div className="cs-drawer-head">
          <div className="cs-drawer-head-text">
            <div className="cs-eyebrow"><span className="cs-eyebrow-dot" aria-hidden />REFERENCE</div>
            <h3 className="cs-drawer-title">
              <em>Workflow reference</em>
            </h3>
          </div>
          <button className="cs-drawer-close" onClick={onClose} aria-label="Close reference">✕</button>
        </div>
        <div className="cs-drawer-body">
          <div className="cs-drawer-intro">
            <h4 className="cs-drawer-intro-title">{blueprint.title}</h4>
            <p className="cs-drawer-intro-sub">{blueprint.intro}</p>
          </div>
          <div className="cs-drawer-cards">
            {blueprint.rows.map((row, idx) => (
              <BlueprintCard key={idx} row={row} idx={idx} total={blueprint.rows.length} />
            ))}
          </div>
        </div>
      </aside>
    </div>
  );
}

// Legacy: older drafts saved a case-input sentinel row inside the rows
// JSONB. The case input was retired — workflow name now plays both
// roles ("what this is" and "what to chew on"). We strip the sentinel
// on load so it doesn't pollute the step list, and we never inject it
// on save anymore.
const CASE_INPUT_ID = '__case_input__';
function stripCaseInput(rows) {
  if (!Array.isArray(rows)) return [];
  return rows.filter(x => !x || x.id !== CASE_INPUT_ID);
}

export default function ScenarioBuilder({
  sb,
  myParticipantId,
  currentUserName,
  fileTree,
  participants,
  onRunWorkflow,
  running = false,
}) {
  const [drafts, setDrafts] = useState([]);
  const [activeDraftId, setActiveDraftId] = useState(null);
  const [rows, setRows] = useState(null);
  const [workflowName, setWorkflowName] = useState('');
  const [saving, setSaving] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [lastSavedAt, setLastSavedAt] = useState(null);
  const [sending, setSending] = useState(false);
  const [collapsed, setCollapsed] = useState({});
  const [now, setNow] = useState(() => Date.now());
  // Suppress save-effect on the very first render after switching drafts —
  // otherwise the load-then-save sequence writes the same draft back over
  // itself and bumps updated_at every time you switch.
  const skipNextSaveRef = useRef(false);

  // Tick once a second so the "Saved Xs ago" relative time keeps moving.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  // Load the participant's full draft library on mount; pick the most
  // recent draft as the active one. If the participant has no drafts yet,
  // the active state stays null and the editor renders an empty
  // first-draft skeleton until they type or click Run.
  useEffect(() => {
    let cancelled = false;
    if (!myParticipantId || !sb) {
      setRows([newRow()]);
      return;
    }
    const restoreFromLocal = () => {
      const local = loadLocalCapstoneDraft(myParticipantId);
      if (Array.isArray(local) && local.length > 0) {
        const realRows = stripCaseInput(local);
        setRows(realRows.length > 0 ? realRows.map(migrateRow) : [newRow()]);
      } else {
        setRows([newRow()]);
      }
    };
    sb.loadCapstoneDrafts(myParticipantId).then(list => {
      if (cancelled) return;
      if (!Array.isArray(list) || list.length === 0) {
        restoreFromLocal();
        return;
      }
      setDrafts(list);
      const first = list[0];
      skipNextSaveRef.current = true;
      setActiveDraftId(first.id);
      const realRows = stripCaseInput(first.rows);
      setWorkflowName(first.name || '');
      setRows(realRows.length > 0 ? realRows.map(migrateRow) : [newRow()]);
    }).catch(() => { if (!cancelled) restoreFromLocal(); });
    return () => { cancelled = true; };
  }, [sb, myParticipantId]);

  function update(idx, patch) {
    setRows(prev => prev.map((r, i) => i === idx ? { ...r, ...patch } : r));
  }
  function addRow() {
    setRows(prev => [...prev, newRow()]);
  }
  function deleteRow(idx) {
    setRows(prev => {
      if (prev.length <= 1) return prev;
      const removed = prev[idx];
      // Drop the orphan collapsed entry too — keeps the map tidy.
      if (removed) {
        setCollapsed(c => {
          if (!(removed.id in c)) return c;
          const next = { ...c };
          delete next[removed.id];
          return next;
        });
      }
      return prev.filter((_, i) => i !== idx);
    });
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
  function toggleCollapsed(id) {
    setCollapsed(prev => ({ ...prev, [id]: !prev[id] }));
  }
  function toggleAll() {
    if (!rows) return;
    const anyExpanded = rows.some(r => !collapsed[r.id]);
    if (anyExpanded) {
      const next = {};
      rows.forEach(r => { next[r.id] = true; });
      setCollapsed(next);
    } else {
      setCollapsed({});
    }
  }

  // Auto-save: debounce 800ms after the last edit. Both rows and caseInput
  // ride into the same JSONB blob so a single save covers both.
  // localStorage is written immediately on every edit so a refresh never
  // loses keystrokes even if Supabase is down or the network is flaky.
  // The save targets the active draft id; without one, the first save
  // creates a fresh row and we adopt the returned id.
  useEffect(() => {
    if (rows === null || !myParticipantId) return;
    if (skipNextSaveRef.current) {
      skipNextSaveRef.current = false;
      return;
    }
    const blob = stripCaseInput(rows);
    saveLocalCapstoneDraft(myParticipantId, blob);
    const handle = setTimeout(async () => {
      setSaving(true);
      const res = await sb.saveCapstoneDraft({
        participantId: myParticipantId,
        id: activeDraftId,
        name: workflowName.trim() || 'Untitled workflow',
        rows: blob,
      });
      setSaving(false);
      if (res?.ok) {
        setLastSavedAt(Date.now());
        if (res.draft) {
          // Adopt the freshly-inserted id and refresh the chooser pill.
          if (!activeDraftId) setActiveDraftId(res.draft.id);
          setDrafts(prev => {
            const without = prev.filter(d => d.id !== res.draft.id);
            return [{ id: res.draft.id, name: res.draft.name, rows: res.draft.rows, updated_at: res.draft.updated_at }, ...without];
          });
        }
      }
    }, 800);
    return () => clearTimeout(handle);
  }, [rows, workflowName, sb, myParticipantId, activeDraftId]);

  function handleSwitchDraft(draftId) {
    if (draftId === activeDraftId) return;
    const target = drafts.find(d => d.id === draftId);
    if (!target) return;
    skipNextSaveRef.current = true;
    setActiveDraftId(draftId);
    const realRows = stripCaseInput(target.rows);
    setWorkflowName(target.name || '');
    setRows(realRows.length > 0 ? realRows.map(migrateRow) : [newRow()]);
    setCollapsed({});
  }

  function handleNewDraft() {
    skipNextSaveRef.current = false; // let the empty-state save create the row
    setActiveDraftId(null);
    setWorkflowName('');
    setRows([newRow()]);
    setCollapsed({});
  }

  async function handleDeleteDraft(draftId) {
    if (!draftId) return;
    if (!window.confirm('Delete this workflow? This can’t be undone.')) return;
    const res = await sb.deleteCapstoneDraft(draftId);
    if (!res?.ok) return;
    setDrafts(prev => prev.filter(d => d.id !== draftId));
    if (draftId === activeDraftId) {
      // If there are other drafts, switch to the most recent one;
      // otherwise reset to a fresh empty draft.
      const remaining = drafts.filter(d => d.id !== draftId);
      if (remaining.length > 0) {
        handleSwitchDraft(remaining[0].id);
      } else {
        handleNewDraft();
      }
    }
  }

  const completeCount = useMemo(
    () => (rows || []).filter(r => isRowComplete(r)).length,
    [rows],
  );
  const allComplete = rows !== null && rows.length > 0 && rows.every(r => isRowComplete(r));
  const incompleteReason = useMemo(
    () => firstIncompleteReason(rows || []),
    [rows],
  );
  const coworkerCount = (rows || []).filter(r => (r.type || 'coworker') !== 'human').length;
  const humanCount = (rows || []).filter(r => (r.type || 'coworker') === 'human').length;
  const anyExpanded = (rows || []).some(r => !collapsed[r.id]);
  const pct = rows && rows.length > 0 ? Math.round((completeCount / rows.length) * 100) : 0;
  const savedLabel = saving ? 'Saving…' : relSavedLabel(now, lastSavedAt);

  // Reviewer pool is restricted to the current user. We don't have a
  // cross-user notification system, so letting participants assign a
  // human step to someone else would create a binding that never fires
  // at workflow runtime. Match by name first (the local participants
  // list dedups by name and may carry a locally-minted id that differs
  // from myParticipantId), then fall back to id.
  const allowedReviewers = useMemo(() => {
    const list = participants || [];
    const byName = currentUserName ? list.find(p => p.name === currentUserName) : null;
    const byId = myParticipantId ? list.find(p => p.id === myParticipantId) : null;
    const me = byName || byId;
    return me ? [me] : [];
  }, [participants, myParticipantId, currentUserName]);

  // Run gate: a workflow name must be declared and every step must be
  // complete. The name plays both roles — what the workflow is AND what
  // its coworkers chew on (the executor receives it as the case input).
  const nameReady = (workflowName || '').trim().length > 0;
  const canRun = nameReady && allComplete && !sending && !running;
  const runBlockedReason = !nameReady
    ? 'Name the workflow first — what is this thing called?'
    : (incompleteReason || `Fill every step first (${completeCount}/${rows.length} complete)`);

  const [runError, setRunError] = useState(null);

  async function handleRun() {
    console.log('[ScenarioBuilder] Run clicked', {
      canRun,
      nameReady,
      allComplete,
      sending,
      running,
      workflowNameLen: (workflowName || '').length,
      rowCount: (rows || []).length,
      rowStatuses: (rows || []).map(r => ({ type: r.type, complete: isRowComplete(r), step: (r.step || '').slice(0, 30) })),
      hasOnRunWorkflow: typeof onRunWorkflow === 'function',
    });
    setRunError(null);
    if (!canRun) {
      console.warn('[ScenarioBuilder] Run blocked', { runBlockedReason });
      setRunError(runBlockedReason);
      return;
    }
    if (typeof onRunWorkflow !== 'function') {
      console.error('[ScenarioBuilder] onRunWorkflow is not a function');
      setRunError('Run handler not wired — refresh the page and try again.');
      return;
    }
    setSending(true);
    try {
      console.log('[ScenarioBuilder] Calling onRunWorkflow...');
      // Workflow name doubles as the case input the executor receives —
      // the case-input field was retired in favour of using the name as
      // the anchor for both the workflow's identity and its coworkers'
      // input.
      const trimmedName = workflowName.trim();
      await onRunWorkflow(rows, trimmedName, trimmedName);
      console.log('[ScenarioBuilder] onRunWorkflow returned');
    } catch (err) {
      console.error('[ScenarioBuilder] onRunWorkflow threw', err);
      setRunError(`Run failed: ${err?.message || String(err)}`);
    } finally {
      setSending(false);
    }
  }

  if (rows === null) {
    return (
      <div className="cs-page">
        <div className="cs-loading">Loading your workflow…</div>
      </div>
    );
  }

  return (
    <div className="cs-page">
      <nav className="cs-draft-chooser" aria-label="Saved workflows">
        <div className="cs-draft-chooser-list">
          {drafts.map(d => {
            const isActive = d.id === activeDraftId;
            return (
              <button
                key={d.id}
                type="button"
                className={`cs-draft-pill${isActive ? ' is-active' : ''}`}
                onClick={() => handleSwitchDraft(d.id)}
                title={d.name || 'Untitled workflow'}
              >
                <span className="cs-draft-pill-name">{d.name || 'Untitled workflow'}</span>
                {isActive && drafts.length > 1 && (
                  <span
                    className="cs-draft-pill-x"
                    role="button"
                    tabIndex={0}
                    aria-label="Delete this workflow"
                    onClick={e => { e.stopPropagation(); handleDeleteDraft(d.id); }}
                    onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.stopPropagation(); handleDeleteDraft(d.id); } }}
                  >×</span>
                )}
              </button>
            );
          })}
          {/* In the brand-new-draft empty state there's no row in `drafts`
              yet — show a synthetic "Untitled" pill so the chooser doesn't
              look broken. */}
          {drafts.length === 0 && (
            <span className="cs-draft-pill is-active">
              <span className="cs-draft-pill-name">Untitled workflow</span>
            </span>
          )}
        </div>
        <button type="button" className="cs-draft-new" onClick={handleNewDraft}>+ New workflow</button>
      </nav>
      <header className="cs-page-head">
        <div className="cs-page-head-text">
          <div className="cs-eyebrow">
            <span className="cs-eyebrow-dot" aria-hidden />STAGE 6 · WORKFLOW
          </div>
          <h2 className="cs-page-title">
            Pick one real case,&nbsp;<em>build the workflow that handles it</em>.
          </h2>
          <p className="cs-page-sub">
            Describe the case below. Then chain coworkers and human reviewers in order. Hit Run and you'll watch it play out in Audit.
          </p>
        </div>
        <div className="cs-page-actions">
          {savedLabel && (
            <span className={`cs-save-status${saving ? ' is-saving' : ''}`} aria-live="polite">
              <span className="cs-save-status-dot" aria-hidden />
              {savedLabel}
            </span>
          )}
          <button
            type="button"
            className="cs-btn-paper"
            onClick={() => setDrawerOpen(true)}
          >
            <span className="cs-btn-spark" aria-hidden>✦</span>
            Show reference
          </button>
          <button
            type="button"
            className={`cs-btn-dark${canRun ? '' : ' is-blocked'}`}
            onClick={handleRun}
            title={canRun ? 'Run this workflow on the case above — flips you to Audit' : runBlockedReason}
          >
            <span className="cs-btn-dark-text">{sending || running ? 'Running…' : 'Run workflow'}</span>
            <span className="cs-btn-dark-arrow" aria-hidden>→</span>
          </button>
        </div>
      </header>

      <section className="cs-name-input">
        <label className="cs-case-input-label" htmlFor="cs-workflow-name">
          Workflow name
        </label>
        <input
          id="cs-workflow-name"
          className="cs-name-input-textarea"
          value={workflowName}
          onChange={e => setWorkflowName(e.target.value)}
          placeholder="e.g. Credit risk review for John Doe · Loan exception #1234"
          maxLength={120}
        />
      </section>

      {runError && (
        <div className="cs-run-error" role="alert">
          {runError}
        </div>
      )}

      <div className="cs-status-row">
        <div className="cs-status-progress">
          <span className="cs-status-progress-text">
            <strong>{completeCount}</strong> of {rows.length} step{rows.length === 1 ? '' : 's'} complete
          </span>
          <div className="cs-status-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
            <div className="cs-status-bar-fill" style={{ width: `${pct}%` }} />
          </div>
        </div>
        <div className="cs-status-meta">
          <span className="cs-meta-item">
            <span className="cs-meta-dot type-coworker" aria-hidden />
            {coworkerCount} {coworkerCount === 1 ? 'coworker' : 'coworkers'}
          </span>
          <span className="cs-meta-sep" aria-hidden>·</span>
          <span className="cs-meta-item">
            <span className="cs-meta-dot type-human" aria-hidden />
            {humanCount} {humanCount === 1 ? 'reviewer' : 'reviewers'}
          </span>
          <span className="cs-meta-sep" aria-hidden>·</span>
          <button type="button" className="cs-meta-link" onClick={toggleAll}>
            {anyExpanded ? 'Collapse all' : 'Expand all'}
          </button>
        </div>
      </div>

      <div className="cs-cards">
        {rows.map((row, idx) => (
          <StepCard
            key={row.id}
            row={row}
            idx={idx}
            total={rows.length}
            isLast={idx === rows.length - 1}
            isComplete={isRowComplete(row)}
            fileTree={fileTree}
            participants={allowedReviewers}
            collapsed={!!collapsed[row.id]}
            onUpdate={patch => update(idx, patch)}
            onMove={dir => moveRow(idx, dir)}
            onDelete={() => deleteRow(idx)}
            onToggleCollapse={() => toggleCollapsed(row.id)}
            canDelete={rows.length > 1}
          />
        ))}
      </div>

      <button
        type="button"
        className="cs-add-row"
        onClick={addRow}
      >
        <span className="cs-add-row-left">
          <span className="cs-add-row-plus" aria-hidden>+</span>
          Add step
        </span>
        <span className="cs-add-row-hint">COWORKER OR HUMAN — SWITCH AFTER ADDING</span>
      </button>

      <BlueprintDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        blueprint={CAPSTONE_BLUEPRINT_REFERENCE}
      />
    </div>
  );
}
