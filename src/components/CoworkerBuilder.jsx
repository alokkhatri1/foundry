import { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import EducationalCue from './EducationalCue';
import Icon, { COWORKER_ICONS, hasIcon } from './Icon';
import RevealAt, { stageReached } from './RevealAt';
import RichText from './RichText';
import useFileDraft from '../hooks/useFileDraft';
import { useConfirm } from './ConfirmDialog';

const TOOL_REVEAL_STAGE = {
  'builtin-create-file': '5b',
  'builtin-send-message': '5b',
};

let cwCounter = Date.now();
function genCwId() { return 'cw-' + (cwCounter++); }

const DEFAULT_ICON = 'user';
const COLORS = ['#4a7fb5', '#5a9e6f', '#c8956c', '#8b6fb0', '#c45c5c', '#4a9e9e', '#b5784a', '#6f8bb0', '#2c2c2c', '#e8e0d6'];

function isImageAvatar(avatar) {
  return typeof avatar === 'string' && avatar.startsWith('data:');
}
function isIconAvatar(avatar) {
  return typeof avatar === 'string' && avatar.startsWith('icon:') && hasIcon(avatar.slice(5));
}
function iconName(avatar) {
  return avatar.slice(5);
}

function findNode(tree, id) {
  if (!tree) return null;
  if (tree.id === id) return tree;
  if (tree.children) {
    for (const child of tree.children) {
      const found = findNode(child, id);
      if (found) return found;
    }
  }
  return null;
}

function getFilesByDept(tree, folderName) {
  const groups = [];
  if (!tree?.children) return groups;
  for (const dept of tree.children) {
    if (!dept.children) continue;
    if (folderName) {
      // Scoped mode: only the named subfolder per department.
      const subfolder = dept.children.find(c => c.type === 'folder' && c.name === folderName);
      if (!subfolder || !subfolder.children) continue;
      const files = subfolder.children.filter(c => c.type === 'file');
      if (files.length > 0) groups.push({ dept: dept.name, files });
    } else {
      // Unscoped mode: every file under the department, across subfolders.
      const files = [];
      for (const child of dept.children) {
        if (child.type === 'file') files.push(child);
        else if (child.type === 'folder' && child.children) {
          for (const grand of child.children) if (grand.type === 'file') files.push(grand);
        }
      }
      if (files.length > 0) groups.push({ dept: dept.name, files });
    }
  }
  return groups;
}

// ===== Avatar Display (handles icon, image, legacy emoji) =====
function AvatarDisplay({ avatar, color, size, className }) {
  const s = size || 44;
  const bg = color || '#4a7fb5';
  const radius = s > 50 ? 14 : 10;
  const base = { width: s, height: s, borderRadius: radius, background: bg, overflow: 'hidden', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' };

  if (isImageAvatar(avatar)) {
    return (
      <div className={className} style={base}>
        <img src={avatar} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
      </div>
    );
  }

  const icon = isIconAvatar(avatar) ? iconName(avatar) : DEFAULT_ICON;
  return (
    <div className={className} style={base}>
      <Icon name={icon} size={Math.round(s * 0.55)} color="#ffffff" strokeWidth={1.6} />
    </div>
  );
}

// ===== Avatar Picker =====
function AvatarPicker({ avatar, color, onChangeAvatar, onChangeColor }) {
  const fileRef = useRef(null);

  function handleUpload(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) return;
    const reader = new FileReader();
    reader.onload = () => onChangeAvatar(reader.result);
    reader.readAsDataURL(file);
    if (fileRef.current) fileRef.current.value = '';
  }

  return (
    <div className="cwb-avatar-picker-card">
      <div className="cwb-ap-preview">
        <AvatarDisplay avatar={avatar} color={color} size={72} />
      </div>

      <div className="cwb-ap-section">
        <div className="cwb-ap-label">Icon</div>
        <div className="cwb-ap-emoji-grid">
          {COWORKER_ICONS.map(id => {
            const value = 'icon:' + id;
            const active = avatar === value;
            return (
              <button key={id} className={`cwb-ap-emoji${active ? ' active' : ''}`} onClick={() => onChangeAvatar(value)} title={id}>
                <Icon name={id} size={18} color="currentColor" />
              </button>
            );
          })}
        </div>
      </div>

      <div className="cwb-ap-section">
        <div className="cwb-ap-label">Upload image</div>
        <input ref={fileRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleUpload} />
        <button className="cwb-ap-upload-btn" onClick={() => fileRef.current?.click()}>
          {isImageAvatar(avatar) ? 'Change image' : 'Choose image'}
        </button>
      </div>

      <div className="cwb-ap-section">
        <div className="cwb-ap-label">Background</div>
        <div className="cwb-ap-colors">
          {COLORS.map(c => (
            <button key={c} className={`cwb-ap-color${color === c ? ' active' : ''}`} style={{ background: c }} onClick={() => onChangeColor(c)} />
          ))}
        </div>
      </div>
    </div>
  );
}

// ===== Description Generator =====
function DescriptionSection({ role, onChangeRole, callClaudeAPI }) {
  const [generating, setGenerating] = useState(false);

  async function handleGenerate() {
    if (!role?.trim()) return;
    setGenerating(true);
    const result = await callClaudeAPI(
      `You write operational role descriptions for AI coworkers on a workflow platform. These descriptions are used as context when the coworker processes cases.

Given a rough description, write a clear role description (3-5 sentences) that covers:
1. What this coworker's purpose is
2. What kind of inputs it receives and analyzes
3. What it should focus on or prioritize
4. What its output should look like

Write in second person ("You are...", "You analyze...", "You produce..."). Be specific and actionable — this text directly shapes how the AI behaves at runtime. Return ONLY the description text, nothing else.`,
      role.trim(),
      // Short text polishing task — Haiku is plenty, ~5x cheaper than Sonnet.
      { segment: 'refine_description', model: 'claude-haiku-4-5-20251001' },
    );
    setGenerating(false);
    if (result.success) {
      onChangeRole(result.content.trim());
    }
  }

  return (
    <div className="cwb-section">
      <h3 className="cwb-section-title">About</h3>
      <p className="cwb-section-desc">What does this coworker do? Describe it roughly and generate a polished description.</p>
      <div className="cwb-desc-gen">
        <div className="cwb-desc-input-wrap">
          <textarea
            className={`cwb-desc-input${generating ? ' generating' : ''}`}
            value={role}
            onChange={e => onChangeRole(e.target.value)}
            placeholder="e.g., Reviews loan applications, checks if all documents are submitted, and assesses risk based on our lending policy..."
            rows={8}
            disabled={generating}
          />
          {generating && <div className="cwb-desc-generating">Generating preferences<span className="cwb-dots"><span>.</span><span>.</span><span>.</span></span></div>}
        </div>
        <button className="cwb-desc-gen-btn" onClick={handleGenerate} disabled={generating || !role?.trim()}>
          {generating ? 'Generating...' : 'Refine with Foundry AI'}
        </button>
      </div>
    </div>
  );
}

// ===== Create File tool config =====
function CreateFileConfig({ fileTree, currentStage, config, onChange }) {
  const topFolders = (fileTree?.children || []).filter(c => c.type === 'folder');
  const folderId = config?.folderId || '';
  const subfolder = config?.subfolder || 'knowledge';
  const skillsAvailable = stageReached(currentStage, '4');

  return (
    <div className="cwb-tool-config">
      <div className="cwb-tool-config-title">Where should new files go?</div>
      <div className="cwb-tool-config-row">
        <label className="cwb-tool-config-label">Folder</label>
        <select
          className="cwb-tool-config-select"
          value={folderId}
          onChange={e => onChange({ folderId: e.target.value, subfolder })}
        >
          <option value="">First available folder</option>
          {topFolders.map(f => (
            <option key={f.id} value={f.id}>{f.name}</option>
          ))}
        </select>
      </div>
      <div className="cwb-tool-config-row">
        <label className="cwb-tool-config-label">Subfolder</label>
        <div className="cwb-tool-config-radios">
          <label className={`cwb-tool-config-radio${subfolder === 'knowledge' ? ' on' : ''}`}>
            <input
              type="radio"
              name={`subfolder-${folderId || 'default'}`}
              checked={subfolder === 'knowledge'}
              onChange={() => onChange({ folderId, subfolder: 'knowledge' })}
            />
            knowledge
          </label>
          <label
            className={`cwb-tool-config-radio${subfolder === 'skills' ? ' on' : ''}${skillsAvailable ? '' : ' disabled'}`}
            title={skillsAvailable ? '' : 'Skills unlock at Stage 4'}
          >
            <input
              type="radio"
              name={`subfolder-${folderId || 'default'}`}
              checked={subfolder === 'skills'}
              disabled={!skillsAvailable}
              onChange={() => onChange({ folderId, subfolder: 'skills' })}
            />
            skills
          </label>
        </div>
      </div>
      {topFolders.length === 0 && (
        <div className="cwb-tool-config-hint">Create a folder in the Files tab first. Until then, files will land at the top level.</div>
      )}
    </div>
  );
}

// ===== Send Message tool config =====
// Instructions for WHEN to DM someone + a whitelist of humans this coworker
// is allowed to message. The whitelist is enforced on the runtime picker,
// and the instructions get folded into the coworker's system prompt so it
// knows when to reach for the tool.
function SendMessageConfig({ participants, config, onChange }) {
  const instructions = config?.instructions || '';
  const allowed = config?.allowedParticipantIds || [];
  const humans = (participants || []).filter(p => (p.kind || 'human') === 'human');

  function toggleParticipant(pid) {
    const next = allowed.includes(pid)
      ? allowed.filter(id => id !== pid)
      : [...allowed, pid];
    onChange({ instructions, allowedParticipantIds: next });
  }

  return (
    <div className="cwb-tool-config">
      <div className="cwb-tool-config-title">When should this coworker send a message?</div>
      <textarea
        className="cwb-tool-config-textarea"
        value={instructions}
        onChange={e => onChange({ instructions: e.target.value, allowedParticipantIds: allowed })}
        placeholder="e.g., DM the team lead when a loan flags the 2024 exception. DM ops if the case takes longer than expected."
        rows={3}
      />
      <div className="cwb-tool-config-row cwb-tool-config-col">
        <label className="cwb-tool-config-label">Who this coworker can message</label>
        {humans.length === 0 ? (
          <div className="cwb-tool-config-hint">No workshop participants yet — the picker will have nothing to show at runtime.</div>
        ) : (
          <div className="cwb-tool-config-checklist">
            {humans.map(p => (
              <label key={p.id} className={`cwb-tool-config-checkitem${allowed.includes(p.id) ? ' on' : ''}`}>
                <input
                  type="checkbox"
                  checked={allowed.includes(p.id)}
                  onChange={() => toggleParticipant(p.id)}
                />
                <span
                  className="cwb-tool-config-dot"
                  style={{ background: p.color || '#888', opacity: p.online ? 1 : 0.35 }}
                  title={p.online ? 'Online' : 'Offline'}
                />
                <span className="cwb-tool-config-checkname">{p.name}</span>
              </label>
            ))}
          </div>
        )}
        {humans.length > 0 && allowed.length === 0 && (
          <div className="cwb-tool-config-warning">Pick at least one — the tool won't fire with an empty whitelist.</div>
        )}
      </div>
    </div>
  );
}

// ===== File Picker =====
// Exported below for reuse from WorkflowBuilder's inline Coworker node.
function FilePicker({ fileTree, selectedIds, onChange, folderName, onUpdateContent }) {
  const [open, setOpen] = useState(false);
  const [previewId, setPreviewId] = useState(null);
  const [previewMode, setPreviewMode] = useState('view');
  const [collapsedDepts, setCollapsedDepts] = useState({});
  const groups = getFilesByDept(fileTree, folderName);
  const selected = selectedIds.map(id => findNode(fileTree, id)).filter(Boolean);
  const previewFile = previewId ? findNode(fileTree, previewId) : null;
  const { draft, isDirty, updateDraft, save, confirmDiscard } = useFileDraft(
    previewFile?.id,
    previewFile?.content,
    onUpdateContent,
  );

  useEffect(() => { setPreviewMode('view'); }, [previewId]);

  async function tryClosePreview() {
    const ok = await confirmDiscard('You have unsaved changes. Close without saving?');
    if (!ok) return;
    setPreviewId(null);
  }

  function handleSave() {
    if (save()) setPreviewMode('view');
  }

  async function switchEditorMode(next) {
    if (next === 'view' && isDirty) {
      const ok = await confirmDiscard('You have unsaved changes. Discard them?');
      if (!ok) return;
    }
    setPreviewMode(next);
  }

  function handleTextareaKeyDown(e) {
    if ((e.metaKey || e.ctrlKey) && e.key === 's') {
      e.preventDefault();
      handleSave();
    }
  }

  function toggleFile(fileId) {
    if (selectedIds.includes(fileId)) onChange(selectedIds.filter(id => id !== fileId));
    else onChange([...selectedIds, fileId]);
  }

  function toggleDept(dept) {
    setCollapsedDepts(prev => ({ ...prev, [dept]: !prev[dept] }));
  }

  return (
    <div className="ftp">
      <div className="ftp-selected">
        {selected.map(f => (
          <span key={f.id} className="ftp-chip">
            <span className="ftp-chip-name">{f.name.replace(/\.md$/, '')}</span>
            <button className="ftp-chip-remove" onClick={() => onChange(selectedIds.filter(id => id !== f.id))}>{'\u2715'}</button>
          </span>
        ))}
        <button className="ftp-browse-btn" onClick={() => { setOpen(!open); setPreviewId(null); }}>
          {open ? 'Done' : '+ Browse'}
        </button>
      </div>
      {open && (
        <div className="ftp-browser">
          <div className="ftp-tree">
            {groups.length === 0 && (
              <div className="ftp-empty">No {folderName || ''} files found. Create them in the Files tab.</div>
            )}
            {groups.map(g => {
              const isCollapsed = collapsedDepts[g.dept];
              const selectedInDept = g.files.filter(f => selectedIds.includes(f.id)).length;
              return (
                <div key={g.dept}>
                  <div className="ftp-dept" onClick={() => toggleDept(g.dept)}>
                    <span className={`ftp-dept-caret${!isCollapsed ? ' open' : ''}`}>{'\u25B6'}</span>
                    <span className="ftp-dept-name">{g.dept}</span>
                    <span className="ftp-dept-count">{selectedInDept > 0 ? `${selectedInDept}/` : ''}{g.files.length}</span>
                  </div>
                  {!isCollapsed && g.files.map(f => {
                    const isSelected = selectedIds.includes(f.id);
                    const isPreviewing = previewId === f.id;
                    return (
                      <div key={f.id} className={`ftp-file${isSelected ? ' selected' : ''}${isPreviewing ? ' previewing' : ''}`}>
                        <span className="ftp-file-name" onClick={() => setPreviewId(isPreviewing ? null : f.id)}>{f.name.replace(/\.md$/, '')}</span>
                        <button className={`ftp-file-toggle${isSelected ? ' on' : ''}`} onClick={() => toggleFile(f.id)}>
                          {isSelected ? '\u2713' : '+'}
                        </button>
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>
      )}
      {previewFile && createPortal(
        <div className="ftp-preview-overlay" onClick={tryClosePreview}>
          <div className="ftp-preview-modal" onClick={e => e.stopPropagation()}>
            <div className="ftp-preview-header">
              <span className="ftp-preview-name">
                {previewFile.name.replace(/\.md$/, '')}
                {isDirty && <span style={{ color: 'var(--text-muted)', fontWeight: 400, fontSize: 12, marginLeft: 8 }}>• unsaved</span>}
              </span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                {onUpdateContent && previewMode === 'view' && (
                  <button
                    className="ftp-preview-action"
                    onClick={() => switchEditorMode('edit')}
                  >Edit</button>
                )}
                {onUpdateContent && previewMode === 'edit' && (
                  <>
                    <button
                      className="ftp-preview-action"
                      onClick={() => switchEditorMode('view')}
                    >Cancel</button>
                    <button
                      className="ftp-preview-action ftp-preview-save"
                      onClick={handleSave}
                      disabled={!isDirty}
                    >Save</button>
                  </>
                )}
                <button className="ftp-preview-close" onClick={tryClosePreview}>{'\u2715'}</button>
              </div>
            </div>
            {previewMode === 'edit' && onUpdateContent ? (
              <textarea
                className="ftp-preview-textarea"
                value={draft}
                onChange={e => updateDraft(e.target.value)}
                onKeyDown={handleTextareaKeyDown}
                placeholder="Start writing..."
                spellCheck={false}
                autoFocus
              />
            ) : (
              <div className="ftp-preview-content">
                {previewFile.content ? <RichText content={previewFile.content} /> : <em style={{ color: 'var(--text-muted)' }}>Empty file</em>}
              </div>
            )}
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}

// ===== Coworker Row (list view) =====
// Compact one-liner row — avatar + name + role + status + edit/delete. Used
// when the coworker list gets long and scanning cards top-to-bottom becomes
// painful. Click the row to chat, click Edit to open the editor.
function CoworkerRow({ coworker, onStartChat, onEdit, onDelete, readOnly }) {
  const instrCount = coworker.instructionFileIds?.length || 0;
  const isReady = instrCount > 0;
  return (
    <div className="cwb-row" onClick={() => onStartChat(coworker.id)}>
      <AvatarDisplay avatar={coworker.avatar} color={coworker.color} size={32} />
      <div className="cwb-row-name">{coworker.name || 'Untitled'}</div>
      <div className="cwb-row-role">{coworker.role ? (coworker.role.length > 80 ? coworker.role.slice(0, 80) + '\u2026' : coworker.role) : 'No role defined'}</div>
      <span className={`cwb-card-status${isReady ? ' ready' : ''}`}>
        <span className="cwb-card-dot" />
        {isReady ? 'Ready' : 'Needs setup'}
      </span>
      {readOnly ? (
        <button className="cwb-row-edit" onClick={e => { e.stopPropagation(); onEdit(coworker.id); }} title="View (read-only)">View</button>
      ) : (
        <>
          <button className="cwb-row-edit" onClick={e => { e.stopPropagation(); onEdit(coworker.id); }} title="Edit">Edit</button>
          <button className="cwb-row-delete" onClick={e => { e.stopPropagation(); onDelete(coworker.id); }} title="Delete">{'\u2715'}</button>
        </>
      )}
    </div>
  );
}

// ===== Coworker Card =====
function CoworkerCard({ coworker, onStartChat, onEdit, onDelete, readOnly }) {
  const instrCount = coworker.instructionFileIds?.length || 0;
  const isReady = instrCount > 0;

  return (
    <div className="cwb-card" onClick={() => onStartChat(coworker.id)}>
      <div className="cwb-card-top">
        <AvatarDisplay avatar={coworker.avatar} color={coworker.color} size={42} />
        <div className="cwb-card-info">
          <div className="cwb-card-name">{coworker.name}</div>
          <div className="cwb-card-role">{coworker.role || 'No role defined'}</div>
        </div>
      </div>
      <div className="cwb-card-bottom">
        <span className={`cwb-card-status${isReady ? ' ready' : ''}`}>
          <span className="cwb-card-dot" />
          {isReady ? 'Ready' : 'Needs setup'}
        </span>
        <button
          className="cwb-card-edit"
          onClick={e => { e.stopPropagation(); onEdit(coworker.id); }}
          title={readOnly ? 'View (read-only)' : 'Edit'}
        >
          {readOnly ? 'View' : 'Edit'}
        </button>
      </div>
      {!readOnly && (
        <button className="cwb-card-delete" onClick={e => { e.stopPropagation(); onDelete(coworker.id); }} title="Delete">{'\u2715'}</button>
      )}
    </div>
  );
}

// ===== Coworker Editor =====
function CoworkerEditor({ coworker, onUpdate, onBack, fileTree, callClaudeAPI, showEducationalCues, tools, currentStage, participants, onUpdateFileContent, readOnly }) {
  const [showAvatarPicker, setShowAvatarPicker] = useState(false);

  return (
    <div className={`cwb-editor${readOnly ? ' cwb-editor-readonly' : ''}`}>
      <div className="cwb-editor-header">
        <button className="files-back-btn" onClick={onBack}>{'\u2190'} Back</button>
        {readOnly && (
          <div className="cwb-readonly-banner" title="This coworker was built by another participant — you can view it but not change it.">
            Read-only — built by {coworker.createdBy}
          </div>
        )}
      </div>

      <div className="cwb-editor-scroll">
        <fieldset className="cwb-editor-fieldset" disabled={readOnly}>
        <div className="cwb-editor-content">
          {/* Identity — name + avatar */}
          <div className="cwb-section cwb-section-identity">
            <div className="cwb-identity">
              <div className="cwb-identity-avatar-btn" style={{ background: coworker.color || '#4a7fb5' }} onClick={() => setShowAvatarPicker(!showAvatarPicker)}>
                {isImageAvatar(coworker.avatar)
                  ? <img src={coworker.avatar} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: 10 }} />
                  : <Icon name={isIconAvatar(coworker.avatar) ? iconName(coworker.avatar) : DEFAULT_ICON} size={36} color="#ffffff" strokeWidth={1.6} />
                }
              </div>
              <div className="cwb-identity-fields">
                <input
                  className="cwb-name-input"
                  type="text"
                  value={coworker.name}
                  onChange={e => onUpdate({ ...coworker, name: e.target.value })}
                  placeholder="Coworker name"
                  autoFocus
                />
              </div>
            </div>

            {showAvatarPicker && (
              <AvatarPicker
                avatar={coworker.avatar}
                color={coworker.color}
                onChangeAvatar={avatar => onUpdate({ ...coworker, avatar })}
                onChangeColor={color => onUpdate({ ...coworker, color })}
              />
            )}
          </div>

          {/* About — description with AI generation */}
          <DescriptionSection
            role={coworker.role}
            onChangeRole={role => onUpdate({ ...coworker, role })}
            callClaudeAPI={callClaudeAPI}
          />

          {/* Skills */}
          <div className="cwb-section">
            <h3 className="cwb-section-title">Skills</h3>
            <p className="cwb-section-desc">How this coworker behaves — its process and output format.</p>
            <FilePicker
              fileTree={fileTree}
              selectedIds={coworker.instructionFileIds || []}
              onChange={ids => onUpdate({ ...coworker, instructionFileIds: ids })}
              folderName="skills"
              onUpdateContent={onUpdateFileContent}
            />
          </div>

          {/* Knowledge */}
          <div className="cwb-section">
            <h3 className="cwb-section-title">Knowledge</h3>
            <p className="cwb-section-desc">Reference material — policies, rules, criteria.</p>
            <FilePicker
              fileTree={fileTree}
              selectedIds={coworker.knowledgeFileIds || []}
              onChange={ids => onUpdate({ ...coworker, knowledgeFileIds: ids })}
              folderName="knowledge"
              onUpdateContent={onUpdateFileContent}
            />
          </div>

          {/* Tools — Stage 5b */}
          <RevealAt stage="5b" currentStage={currentStage}>
            <div className="cwb-section">
              <h3 className="cwb-section-title">Tools</h3>
              <p className="cwb-section-desc">Capabilities this coworker can invoke during a conversation. Pick which tools they can use.</p>
              <div className="cwb-tools-list">
                {(tools || [])
                  .filter(t => t.isBuiltin)
                  .filter(t => stageReached(currentStage, TOOL_REVEAL_STAGE[t.id] || '5b'))
                  .map(tool => {
                  const checked = (coworker.toolIds || []).includes(tool.id);
                  return (
                    <div key={tool.id} className={`cwb-tool-wrap${checked ? ' checked' : ''}`}>
                      <label className={`cwb-tool-row${checked ? ' checked' : ''}`}>
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={e => {
                            const ids = new Set(coworker.toolIds || []);
                            if (e.target.checked) ids.add(tool.id);
                            else ids.delete(tool.id);
                            onUpdate({ ...coworker, toolIds: Array.from(ids) });
                          }}
                        />
                        <span className="cwb-tool-icon">{tool.icon}</span>
                        <div className="cwb-tool-info">
                          <span className="cwb-tool-name">{tool.name}</span>
                          <span className="cwb-tool-desc">{tool.description}</span>
                        </div>
                      </label>
                      {checked && tool.id === 'builtin-create-file' && (
                        <CreateFileConfig
                          fileTree={fileTree}
                          currentStage={currentStage}
                          config={coworker.toolConfigs?.['builtin-create-file']}
                          onChange={next => onUpdate({
                            ...coworker,
                            toolConfigs: {
                              ...(coworker.toolConfigs || {}),
                              'builtin-create-file': next,
                            },
                          })}
                        />
                      )}
                      {checked && tool.id === 'builtin-send-message' && (
                        <SendMessageConfig
                          participants={participants}
                          config={coworker.toolConfigs?.['builtin-send-message']}
                          onChange={next => onUpdate({
                            ...coworker,
                            toolConfigs: {
                              ...(coworker.toolConfigs || {}),
                              'builtin-send-message': next,
                            },
                          })}
                        />
                      )}
                    </div>
                  );
                })}
                {(tools || []).filter(t => t.isBuiltin && stageReached(currentStage, TOOL_REVEAL_STAGE[t.id] || '5b')).length === 0 && (
                  <p style={{ fontSize: 13, color: 'var(--text-muted, #888)', padding: 8 }}>No tools available yet.</p>
                )}
              </div>
            </div>
          </RevealAt>

        </div>
        </fieldset>
      </div>
    </div>
  );
}

// ===== Main Export =====
// Re-export shared editor pieces so the Coworker node in WorkflowBuilder can
// render the same About / Skills / Knowledge UI inline on the canvas.
export { AvatarDisplay, AvatarPicker, DescriptionSection, FilePicker, isImageAvatar, isIconAvatar, iconName, DEFAULT_ICON };

export default function CoworkerBuilder({ coworkers, onUpdateCoworkers, fileTree, tools, userName, callClaudeAPI, showEducationalCues, currentStage, onStartChat, participants, onUpdateFileContent }) {
  const confirm = useConfirm();
  const [selectedCwId, setSelectedCwId] = useState(null);
  const [searchQ, setSearchQ] = useState('');
  const [viewMode, setViewMode] = useState('grid'); // 'grid' | 'list'
  const selectedCw = selectedCwId ? coworkers.find(c => c.id === selectedCwId) : null;

  const q = searchQ.trim().toLowerCase();
  const visibleCoworkers = q
    ? coworkers.filter(c =>
        (c.name || '').toLowerCase().includes(q)
        || (c.role || '').toLowerCase().includes(q)
      )
    : coworkers;
  // Split into "mine" vs "built by others" so the user's own work doesn't
  // get lost in the shared library as the workshop fills up. Anything
  // without a createdBy (legacy) falls into "mine" for the current user
  // rather than getting orphaned.
  const myCoworkers = visibleCoworkers.filter(c => !c.createdBy || c.createdBy === userName);
  const otherCoworkers = visibleCoworkers.filter(c => c.createdBy && c.createdBy !== userName);

  function handleCreate() {
    const newCw = {
      id: genCwId(),
      name: 'New Coworker',
      role: '',
      avatar: 'icon:' + COWORKER_ICONS[Math.floor(Math.random() * COWORKER_ICONS.length)],
      color: COLORS[Math.floor(Math.random() * 8)],
      instructionFileIds: [],
      knowledgeFileIds: [],
      toolIds: [],
      createdBy: userName,
      createdAt: Date.now(),
    };
    onUpdateCoworkers([...coworkers, newCw]);
    setSelectedCwId(newCw.id);
  }

  function handleStartChat(cwId) {
    if (onStartChat) onStartChat(cwId);
  }

  function handleUpdate(updatedCw) {
    onUpdateCoworkers(coworkers.map(c => c.id === updatedCw.id ? updatedCw : c));
  }

  async function handleDelete(cwId) {
    const ok = await confirm({ message: 'Delete this coworker?', danger: true });
    if (!ok) return;
    onUpdateCoworkers(coworkers.filter(c => c.id !== cwId));
    if (selectedCwId === cwId) setSelectedCwId(null);
  }

  if (selectedCw) {
    const editorReadOnly = !!(selectedCw.createdBy && selectedCw.createdBy !== userName);
    return (
      <div className="panel panel-center">
        <CoworkerEditor
          coworker={selectedCw}
          onUpdate={editorReadOnly ? () => {} : handleUpdate}
          onBack={() => setSelectedCwId(null)}
          fileTree={fileTree}
          callClaudeAPI={callClaudeAPI}
          showEducationalCues={showEducationalCues}
          tools={tools}
          currentStage={currentStage}
          participants={participants}
          onUpdateFileContent={onUpdateFileContent}
          readOnly={editorReadOnly}
        />
      </div>
    );
  }

  return (
    <div className="panel panel-center">
      <div className="cw-list">
        <div className="cw-list-header">
          <div>
            <h2 className="cw-list-title">Coworkers</h2>
            <p className="cw-list-subtitle">AI team members that process cases, review documents, and make assessments.</p>
            <EducationalCue cueId="coworkers-overview" show={showEducationalCues} />
          </div>
          <div className="cw-list-actions">
            {coworkers.length > 0 && (
              <>
                <input
                  type="text"
                  className="cwb-search cwb-search-inline"
                  placeholder={'Search\u2026'}
                  value={searchQ}
                  onChange={e => setSearchQ(e.target.value)}
                />
                <div className="cwb-view-toggle">
                  <button
                    className={`cwb-view-btn${viewMode === 'grid' ? ' active' : ''}`}
                    onClick={() => setViewMode('grid')}
                    title="Grid view"
                  >Grid</button>
                  <button
                    className={`cwb-view-btn${viewMode === 'list' ? ' active' : ''}`}
                    onClick={() => setViewMode('list')}
                    title="List view"
                  >List</button>
                </div>
              </>
            )}
            <button className="cw-hire-btn" onClick={handleCreate}>+ New Coworker</button>
          </div>
        </div>

        {coworkers.length === 0 ? (
          <div className="cw-list-grid">
            <div className="cw-list-empty">
              <p>No coworkers yet.</p>
            </div>
          </div>
        ) : visibleCoworkers.length === 0 ? (
          <div className="cwb-empty-search">
            No coworkers match &ldquo;{searchQ}&rdquo;.
          </div>
        ) : (
          <>
            {myCoworkers.length > 0 && (
              <div className="cw-section">
                <div className="cw-section-title">
                  Built by you <span className="cw-section-count">{myCoworkers.length}</span>
                </div>
                {viewMode === 'grid' ? (
                  <div className="cw-list-grid">
                    {myCoworkers.map(cw => (
                      <CoworkerCard key={cw.id} coworker={cw} onStartChat={handleStartChat} onEdit={setSelectedCwId} onDelete={handleDelete} />
                    ))}
                  </div>
                ) : (
                  <div className="cwb-list">
                    {myCoworkers.map(cw => (
                      <CoworkerRow key={cw.id} coworker={cw} onStartChat={handleStartChat} onEdit={setSelectedCwId} onDelete={handleDelete} />
                    ))}
                  </div>
                )}
              </div>
            )}
            {otherCoworkers.length > 0 && (
              <div className="cw-section">
                <div className="cw-section-title">
                  Built by others <span className="cw-section-count">{otherCoworkers.length}</span>
                </div>
                {viewMode === 'grid' ? (
                  <div className="cw-list-grid">
                    {otherCoworkers.map(cw => (
                      <CoworkerCard key={cw.id} coworker={cw} onStartChat={handleStartChat} onEdit={setSelectedCwId} onDelete={handleDelete} readOnly />
                    ))}
                  </div>
                ) : (
                  <div className="cwb-list">
                    {otherCoworkers.map(cw => (
                      <CoworkerRow key={cw.id} coworker={cw} onStartChat={handleStartChat} onEdit={setSelectedCwId} onDelete={handleDelete} readOnly />
                    ))}
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
