import { useState, useRef } from 'react';
import EducationalCue from './EducationalCue';
import Icon, { COWORKER_ICONS, hasIcon } from './Icon';
import RevealAt, { stageReached } from './RevealAt';

const TOOL_REVEAL_STAGE = {
  'builtin-research': '5b',
  'builtin-process-doc': '5b',
  'builtin-dm': '5c',
  'builtin-ask-human': '5c',
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
    const subfolder = dept.children.find(c => c.type === 'folder' && c.name === folderName);
    if (!subfolder || !subfolder.children) continue;
    const files = subfolder.children.filter(c => c.type === 'file');
    if (files.length > 0) groups.push({ dept: dept.name, files });
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
      role.trim()
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

// ===== File Picker =====
function FilePicker({ fileTree, selectedIds, onChange, folderName }) {
  const [open, setOpen] = useState(false);
  const [previewId, setPreviewId] = useState(null);
  const [collapsedDepts, setCollapsedDepts] = useState({});
  const groups = getFilesByDept(fileTree, folderName);
  const selected = selectedIds.map(id => findNode(fileTree, id)).filter(Boolean);
  const previewFile = previewId ? findNode(fileTree, previewId) : null;

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
              <div className="ftp-empty">No {folderName} files found. Create them in the Files tab.</div>
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
          {previewFile && (
            <div className="ftp-preview">
              <div className="ftp-preview-header">
                <span className="ftp-preview-name">{previewFile.name.replace(/\.md$/, '')}</span>
                <button className="ftp-preview-close" onClick={() => setPreviewId(null)}>{'\u2715'}</button>
              </div>
              <div className="ftp-preview-content">{previewFile.content || 'Empty file'}</div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ===== Coworker Card =====
function CoworkerCard({ coworker, onSelect, onDelete }) {
  const instrCount = coworker.instructionFileIds?.length || 0;
  const isReady = instrCount > 0;

  return (
    <div className="cwb-card" onClick={() => onSelect(coworker.id)}>
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
      </div>
      <button className="cwb-card-delete" onClick={e => { e.stopPropagation(); onDelete(coworker.id); }} title="Delete">{'\u2715'}</button>
    </div>
  );
}

// ===== Coworker Editor =====
function CoworkerEditor({ coworker, onUpdate, onBack, fileTree, callClaudeAPI, showEducationalCues, tools, currentStage }) {
  const [showAvatarPicker, setShowAvatarPicker] = useState(false);

  return (
    <div className="cwb-editor">
      <div className="cwb-editor-header">
        <button className="files-back-btn" onClick={onBack}>{'\u2190'} Back</button>
      </div>

      <div className="cwb-editor-scroll">
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
                    <label key={tool.id} className={`cwb-tool-row${checked ? ' checked' : ''}`}>
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
                  );
                })}
                {(tools || []).filter(t => t.isBuiltin && stageReached(currentStage, TOOL_REVEAL_STAGE[t.id] || '5b')).length === 0 && (
                  <p style={{ fontSize: 13, color: 'var(--text-muted, #888)', padding: 8 }}>No tools available yet.</p>
                )}
              </div>
            </div>
          </RevealAt>

        </div>
      </div>
    </div>
  );
}

// ===== Main Export =====
export default function CoworkerBuilder({ coworkers, onUpdateCoworkers, fileTree, tools, userName, callClaudeAPI, showEducationalCues, currentStage }) {
  const [selectedCwId, setSelectedCwId] = useState(null);
  const selectedCw = selectedCwId ? coworkers.find(c => c.id === selectedCwId) : null;

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

  function handleUpdate(updatedCw) {
    onUpdateCoworkers(coworkers.map(c => c.id === updatedCw.id ? updatedCw : c));
  }

  function handleDelete(cwId) {
    if (!confirm('Delete this coworker?')) return;
    onUpdateCoworkers(coworkers.filter(c => c.id !== cwId));
    if (selectedCwId === cwId) setSelectedCwId(null);
  }

  if (selectedCw) {
    return (
      <div className="panel panel-center">
        <CoworkerEditor coworker={selectedCw} onUpdate={handleUpdate} onBack={() => setSelectedCwId(null)} fileTree={fileTree} callClaudeAPI={callClaudeAPI} showEducationalCues={showEducationalCues} tools={tools} currentStage={currentStage} />
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
          <button className="cw-hire-btn" onClick={handleCreate}>+ New Coworker</button>
        </div>
        <div className="cw-list-grid">
          {coworkers.length === 0 && (
            <div className="cw-list-empty">
              <p>No coworkers yet.</p>
              <button className="setup-btn-primary" onClick={handleCreate} style={{ marginTop: 16 }}>
                + Create your first coworker<span className="btn-arrow">&#x2197;</span>
              </button>
            </div>
          )}
          {coworkers.map(cw => (
            <CoworkerCard key={cw.id} coworker={cw} onSelect={setSelectedCwId} onDelete={handleDelete} />
          ))}
        </div>
      </div>
    </div>
  );
}
