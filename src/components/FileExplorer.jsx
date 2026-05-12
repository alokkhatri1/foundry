import { useState, useRef, useEffect } from 'react';
import { KNOWLEDGE_TEMPLATE, INSTRUCTION_TEMPLATE } from '../data/starterContent';
import { parseFile, getFileIcon, getFileCategory } from '../utils/fileParser';
import EducationalCue from './EducationalCue';
import { stageReached } from './RevealAt';
import { useConfirm } from './ConfirmDialog';
import { addChildToTree, removeNodeFromTree, moveNodeInTree, updateNodeInTree } from '../utils/treeUtils';

const SKILL_TEMPLATE = INSTRUCTION_TEMPLATE;

let nextId = Date.now();
function genId() { return 'id-' + (nextId++); }

function findNode(tree, id) {
  if (tree.id === id) return tree;
  if (tree.children) {
    for (const child of tree.children) {
      const found = findNode(child, id);
      if (found) return found;
    }
  }
  return null;
}

function findParent(tree, nodeId) {
  if (tree.children) {
    for (const child of tree.children) {
      if (child.id === nodeId) return tree;
      const found = findParent(child, nodeId);
      if (found) return found;
    }
  }
  return null;
}

function isDescendant(tree, ancestorId, nodeId) {
  const ancestor = findNode(tree, ancestorId);
  if (!ancestor || !ancestor.children) return false;
  function walk(node) {
    if (node.id === nodeId) return true;
    if (node.children) {
      for (const child of node.children) {
        if (walk(child)) return true;
      }
    }
    return false;
  }
  return walk(ancestor);
}

function buildPath(tree, targetId) {
  const path = [];
  function walk(node) {
    if (node.id === targetId) {
      path.push(node);
      return true;
    }
    if (node.children) {
      for (const child of node.children) {
        if (walk(child)) {
          path.unshift(node);
          return true;
        }
      }
    }
    return false;
  }
  walk(tree);
  return path;
}

function findDept(tree, nodeId) {
  function walk(node, dept) {
    if (node.id === nodeId) return dept;
    if (node.children) {
      for (const child of node.children) {
        const nextDept = node.id === tree.id ? child : dept;
        const found = walk(child, nextDept);
        if (found) return found;
      }
    }
    return null;
  }
  return walk(tree, null);
}

function FolderIcon({ color = '#c8956c' }) {
  return (
    <svg width="48" height="40" viewBox="0 0 48 40" fill="none">
      <path d="M4 6C4 3.79 5.79 2 8 2H18L22 8H40C42.21 8 44 9.79 44 12V34C44 36.21 42.21 38 40 38H8C5.79 38 4 36.21 4 34V6Z" fill={color} opacity="0.15"/>
      <path d="M4 6C4 3.79 5.79 2 8 2H18L22 8H40C42.21 8 44 9.79 44 12V34C44 36.21 42.21 38 40 38H8C5.79 38 4 36.21 4 34V6Z" stroke={color} strokeWidth="2" fill="none"/>
    </svg>
  );
}

function FileIcon() {
  return (
    <svg width="40" height="48" viewBox="0 0 40 48" fill="none">
      <path d="M4 4C4 1.79 5.79 0 8 0H26L36 12V44C36 46.21 34.21 48 32 48H8C5.79 48 4 46.21 4 44V4Z" fill="#f5efe6"/>
      <path d="M4 4C4 1.79 5.79 0 8 0H26L36 12V44C36 46.21 34.21 48 32 48H8C5.79 48 4 46.21 4 44V4Z" stroke="#d4ccc2" strokeWidth="1.5" fill="none"/>
      <path d="M26 0V8C26 10.21 27.79 12 30 12H36" stroke="#d4ccc2" strokeWidth="1.5" fill="none"/>
      <rect x="10" y="20" width="16" height="2" rx="1" fill="#c8c0b6"/>
      <rect x="10" y="26" width="12" height="2" rx="1" fill="#c8c0b6"/>
      <rect x="10" y="32" width="14" height="2" rx="1" fill="#c8c0b6"/>
    </svg>
  );
}

function getFolderColor(name) {
  if (name === 'knowledge') return '#5a9e6f';
  if (name === 'skills') return '#4a7fb5';
  return '#c8956c';
}

function getFolderDescription(name) {
  if (name === 'knowledge') return 'Policies, rules & context for AI';
  if (name === 'skills') return 'Reusable instructions the AI follows';
  return null;
}

export default function FileExplorer({ fileTree, selectedFileId, onSelectFile, onUpdateTree, onSelectDepartment, showEducationalCues, currentStage, userName, callClaudeAPI }) {
  const confirm = useConfirm();
  const [currentFolderId, setCurrentFolderId] = useState(fileTree.id);
  const [showModal, setShowModal] = useState(false);
  const [modalMode, setModalMode] = useState('folder');
  const [newName, setNewName] = useState('');
  const [templateContent, setTemplateContent] = useState('');
  const [showNewMenu, setShowNewMenu] = useState(false);
  const [uploading, setUploading] = useState(false);
  const uploadInputRef = useRef(null);
  const [dragItemId, setDragItemId] = useState(null);
  const [dropTargetId, setDropTargetId] = useState(null);
  const [renamingId, setRenamingId] = useState(null);
  const [renameDraft, setRenameDraft] = useState('');
  // Create-with-AI modal state
  const [aiModalOpen, setAiModalOpen] = useState(false);
  const [aiPrompt, setAiPrompt] = useState('');
  const [aiName, setAiName] = useState('');
  const [aiBusy, setAiBusy] = useState(false);
  const [aiError, setAiError] = useState(null);

  const currentFolder = findNode(fileTree, currentFolderId) || fileTree;
  const breadcrumb = buildPath(fileTree, currentFolderId);
  const rawItems = currentFolder.children || [];
  // Example folders (createdBy === 'System') and anything inside them are
  // read-only for participants — they're seeded reference material, not
  // a workspace. Block creation, upload, and AI-draft entry points when
  // any ancestor in the breadcrumb is system-owned.
  const insideExample = breadcrumb.some(n => n.createdBy === 'System');
  // Stage reveals — additive: each unlocks a new subfolder beside the
  // previous one. Stage 3 reveals skills (post-2026-05-09 swap, was 4),
  // Stage 4 reveals knowledge. Before each gate the corresponding
  // subfolder is hidden even if it exists in the data (migration
  // backfill, seed content, etc.) so the lesson lands in order.
  const skillsRevealed = stageReached(currentStage, '3');
  const knowledgeRevealed = stageReached(currentStage, '4');
  // The example references folder (a canonical workflow file) is only
  // revealed once the copilot is unlocked at Stage 9 (after Capstone).
  // Hidden before that even if it exists in the data.
  const referencesRevealed = stageReached(currentStage, '9');

  // One-time migration: any top-level "Knowledge" / "Instructions" folder
  // (capitalised — signature of the removed ensureStageFolder auto-creator)
  // gets its children promoted to true top-level, then the legacy shell is
  // dropped. Same pass also strips any stray empty top-level `knowledge` or
  // `skills` folders that may have been backfilled into the legacy shells
  // before we ripped that code out.
  //
  // Then the Stage-4 backfill: every remaining top-level folder should have a
  // `skills` subfolder beside `knowledge`. Idempotent — runs on tree changes
  // but does nothing when the tree is already clean.
  useEffect(() => {
    if (!fileTree?.children) return;
    const legacyNames = new Set(['Knowledge', 'Instructions']);
    const hasLegacy = fileTree.children.some(c => c.type === 'folder' && legacyNames.has(c.name));
    const updated = JSON.parse(JSON.stringify(fileTree));
    let dirty = false;

    if (hasLegacy) {
      const survivors = [];
      const promoted = [];
      for (const child of updated.children) {
        if (child.type === 'folder' && legacyNames.has(child.name)) {
          (child.children || []).forEach(g => promoted.push(g));
        } else {
          survivors.push(child);
        }
      }
      updated.children = [...survivors, ...promoted].filter(c => {
        if (c.type === 'folder'
            && (c.name === 'knowledge' || c.name === 'skills')
            && (!c.children || c.children.length === 0)) return false;
        return true;
      });
      dirty = true;
    }

    if (skillsRevealed) {
      for (const folder of (updated.children || [])) {
        if (folder.type !== 'folder') continue;
        if (legacyNames.has(folder.name)) continue;
        const hasSkills = (folder.children || []).some(c => c.type === 'folder' && c.name === 'skills');
        if (!hasSkills) {
          folder.children = folder.children || [];
          folder.children.push({ id: genId(), name: 'skills', type: 'folder', children: [] });
          dirty = true;
        }
      }
    }

    // Rename legacy "blueprints" folder + "blueprint.md" file to the new
    // "references" / "reference.md" naming. Walks the whole tree once
    // and is idempotent — does nothing if the tree is already migrated.
    function renameRecursively(node) {
      if (!node) return;
      if (node.type === 'folder' && node.name === 'blueprints') {
        node.name = 'references';
        dirty = true;
      }
      if (node.type === 'file' && node.name === 'blueprint.md') {
        node.name = 'reference.md';
        dirty = true;
      }
      for (const child of node.children || []) renameRecursively(child);
    }
    renameRecursively(updated);

    if (dirty) onUpdateTree(updated);
  }, [skillsRevealed, fileTree, onUpdateTree]);

  // If a stage gate hides the folder the user is currently inside (e.g.
  // they were viewing references when an admin pushed the stage back), fall
  // back to root so they don't get stranded with no breadcrumb back out.
  useEffect(() => {
    const path = buildPath(fileTree, currentFolderId);
    const insideHidden = path.some(n =>
      (!referencesRevealed && n.type === 'folder' && n.name === 'references')
      || (!skillsRevealed    && n.type === 'folder' && n.name === 'skills')
      || (!knowledgeRevealed && n.type === 'folder' && n.name === 'knowledge'),
    );
    if (insideHidden) {
      setCurrentFolderId(fileTree.id);
      onSelectFile(null);
    }
  }, [fileTree, currentFolderId, referencesRevealed, skillsRevealed, knowledgeRevealed, onSelectFile]);

  const isRoot = currentFolder.id === fileTree.id;
  // Stage 4 reveals the skills subfolder. Before that, hide it even if present
  // in the data — the reveal is additive: at stage 3 each dept shows only its
  // knowledge folder; at stage 4 skills joins it as a sibling.
  //
  // Also hide legacy top-level folders named exactly "Knowledge" or
  // "Instructions" when they're empty — these are leftover cruft from the
  // removed ensureStageFolder auto-creator. Non-empty ones stay visible so no
  // data is ever lost silently.
  const items = rawItems.filter(c => {
    if (!skillsRevealed    && c.type === 'folder' && c.name === 'skills')    return false;
    if (!knowledgeRevealed && c.type === 'folder' && c.name === 'knowledge') return false;
    if (!referencesRevealed && c.type === 'folder' && c.name === 'references') return false;
    if (isRoot && c.type === 'folder'
        && (c.name === 'Knowledge' || c.name === 'Instructions')
        && (!c.children || c.children.length === 0)) return false;
    return true;
  });
  // Skills before Knowledge to match the stage-reveal order (Stage 3
  // skills, then Stage 4 knowledge). Other folders keep their insertion
  // order via Array.sort's stability — non-skills/knowledge entries all
  // share the same sort key.
  items.sort((a, b) => {
    const order = (item) => {
      if (item.type !== 'folder') return 2;
      if (item.name === 'skills') return 0;
      if (item.name === 'knowledge') return 1;
      return 2;
    };
    return order(a) - order(b);
  });
  const isKnowledgeFolder = currentFolder.name === 'knowledge';
  const isSkillsFolder = currentFolder.name === 'skills';

  function navigateTo(folderId) {
    setCurrentFolderId(folderId);
    const dept = findDept(fileTree, folderId);
    if (dept && onSelectDepartment) {
      onSelectDepartment(dept.id);
    }
  }

  function handleItemClick(item) {
    if (item.type === 'folder') {
      navigateTo(item.id);
    } else {
      onSelectFile(item.id);
      const dept = findDept(fileTree, item.id);
      if (dept && onSelectDepartment) {
        onSelectDepartment(dept.id);
      }
    }
  }

  function openCreateModal(mode, template = '') {
    setModalMode(mode);
    setTemplateContent(template);
    setNewName(mode === 'file' && template ? 'new-file.md' : '');
    setShowModal(true);
    setShowNewMenu(false);
  }

  // Slugify a free-text prompt into a markdown-friendly filename. Strip
  // punctuation, lowercase, hyphenate; cap at ~50 chars so very long
  // prompts don't produce wall-of-text filenames; append .md.
  function slugifyPrompt(text) {
    const slug = (text || '')
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 50);
    return (slug || 'new-file') + '.md';
  }

  function openAiCreateModal() {
    setAiPrompt('');
    setAiName('');
    setAiError(null);
    setAiBusy(false);
    setAiModalOpen(true);
    setShowNewMenu(false);
  }

  // Generate a markdown body via Claude tuned to the folder's flavor
  // (knowledge = policy/rules style; skills = numbered-step instruction
  // style). On success, write the file to the current folder and open it
  // in the editor. On failure, fall back to the static template so the
  // participant still gets a starting point.
  async function handleAiGenerate() {
    const prompt = aiPrompt.trim();
    if (!prompt || aiBusy) return;
    if (!callClaudeAPI) {
      // No AI hookup — quietly use the template path.
      const template = isKnowledgeFolder ? KNOWLEDGE_TEMPLATE : SKILL_TEMPLATE;
      finalizeAiCreate(template);
      return;
    }
    setAiBusy(true);
    setAiError(null);

    const flavor = isKnowledgeFolder ? 'knowledge' : 'skills';
    const systemPrompt = flavor === 'knowledge'
      ? `You are a workshop participant drafting a Knowledge file for an AI coworker to read at runtime. Knowledge files contain reference material — policies, rules, thresholds, exceptions, definitions — written as plain markdown. Structure: an H1 title, then concise H2 sections (Purpose / Rules / Exceptions / References or similar). Be specific. Use bullet lists and concrete numbers where applicable. No filler, no preamble. Output ONLY the markdown body.`
      : `You are a workshop participant drafting a Skills file for an AI coworker to follow as a job aid. Skills files are reusable instructions — what the AI reads, the steps it follows, the output it produces. Structure: H1 title, then H2 sections (Role / Inputs / Steps / Output / Constraints). Steps should be numbered. Be specific and operational. No filler, no preamble. Output ONLY the markdown body.`;

    try {
      const result = await callClaudeAPI(systemPrompt, prompt, {
        model: 'claude-haiku-4-5-20251001',
        segment: 'file_generation',
      });
      if (!result || result.success === false) {
        throw new Error(result?.error || 'Empty response');
      }
      const text = (result.content || '').toString().trim();
      if (!text) throw new Error('Empty response');
      finalizeAiCreate(text);
    } catch (err) {
      setAiError('Generation failed. Inserted the template instead — edit it freely.');
      const template = isKnowledgeFolder ? KNOWLEDGE_TEMPLATE : SKILL_TEMPLATE;
      finalizeAiCreate(template);
    }
  }

  function finalizeAiCreate(content) {
    const parent = findNode(fileTree, currentFolderId);
    if (!parent || parent.type !== 'folder' || insideExample) {
      setAiBusy(false);
      return;
    }
    const filename = (aiName.trim() || slugifyPrompt(aiPrompt)).endsWith('.md')
      ? (aiName.trim() || slugifyPrompt(aiPrompt))
      : (aiName.trim() || slugifyPrompt(aiPrompt)) + '.md';
    const newNode = {
      id: genId(),
      name: filename,
      type: 'file',
      content,
      createdBy: userName,
    };
    onUpdateTree(addChildToTree(fileTree, currentFolderId, newNode));
    setAiBusy(false);
    setAiModalOpen(false);
    onSelectFile(newNode.id);
  }

  function handleCreate() {
    if (!newName.trim()) return;
    if (insideExample) return;
    const parent = findNode(fileTree, currentFolderId);
    if (!parent || parent.type !== 'folder') return;

    let newNode;
    if (modalMode === 'folder') {
      const isTopLevelCreate = parent.id === fileTree.id;
      const children = [];
      if (isTopLevelCreate) {
        children.push({ id: genId(), name: 'knowledge', type: 'folder', children: [], createdBy: userName });
        children.push({ id: genId(), name: 'skills', type: 'folder', children: [], createdBy: userName });
      }
      newNode = { id: genId(), name: newName.trim(), type: 'folder', children, createdBy: userName };
    } else {
      const fileName = newName.trim().endsWith('.md') ? newName.trim() : newName.trim() + '.md';
      newNode = {
        id: genId(),
        name: fileName,
        type: 'file',
        content: templateContent || '',
        createdBy: userName,
      };
    }

    onUpdateTree(addChildToTree(fileTree, currentFolderId, newNode));
    setShowModal(false);
    setNewName('');
    setTemplateContent('');
  }

  async function handleDelete(e, nodeId) {
    e.stopPropagation();
    const ok = await confirm({ message: 'Delete this item?', danger: true });
    if (!ok) return;
    onUpdateTree(removeNodeFromTree(fileTree, nodeId));
    if (selectedFileId === nodeId) onSelectFile(null);
    if (currentFolderId === nodeId) setCurrentFolderId(fileTree.id);
  }

  function startRename(e, node) {
    e.stopPropagation();
    setRenamingId(node.id);
    setRenameDraft(node.name);
  }

  function commitRename(node) {
    const trimmed = renameDraft.trim();
    if (!trimmed || trimmed === node.name) {
      setRenamingId(null);
      return;
    }
    let nextName = trimmed;
    if (node.type === 'file' && !nextName.endsWith('.md')) nextName += '.md';
    onUpdateTree(updateNodeInTree(fileTree, node.id, n => ({ ...n, name: nextName })));
    setRenamingId(null);
  }

  function cancelRename() {
    setRenamingId(null);
    setRenameDraft('');
  }

  // ===== Drag & Drop: move items into folders =====
  function handleDragStart(e, itemId) {
    setDragItemId(itemId);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', itemId);
  }

  function handleDragOverFolder(e, folderId) {
    e.preventDefault();
    e.stopPropagation();
    if (!dragItemId || dragItemId === folderId) return;
    // Don't allow dropping a folder into its own descendant
    if (isDescendant(fileTree, dragItemId, folderId)) return;
    e.dataTransfer.dropEffect = 'move';
    setDropTargetId(folderId);
  }

  function handleDragLeaveFolder(e) {
    // Only clear if we're actually leaving the folder card (not entering a child)
    const related = e.relatedTarget;
    if (related && e.currentTarget.contains(related)) return;
    setDropTargetId(null);
  }

  function handleDropOnFolder(e, folderId) {
    e.preventDefault();
    e.stopPropagation();
    setDropTargetId(null);

    if (!dragItemId || dragItemId === folderId) {
      setDragItemId(null);
      return;
    }

    // Don't drop a folder into itself or its descendants
    if (isDescendant(fileTree, dragItemId, folderId)) {
      setDragItemId(null);
      return;
    }

    // Validate the source and target exist before mutating.
    const item = findNode(fileTree, dragItemId);
    if (!item) { setDragItemId(null); return; }
    const targetFolder = findNode(fileTree, folderId);
    if (!targetFolder || targetFolder.type !== 'folder') { setDragItemId(null); return; }

    onUpdateTree(moveNodeInTree(fileTree, dragItemId, folderId));
    setDragItemId(null);
  }

  function handleDragEnd() {
    setDragItemId(null);
    setDropTargetId(null);
  }

  // Also allow dropping on breadcrumb segments to move items up
  function handleDropOnBreadcrumb(e, folderId) {
    e.preventDefault();
    handleDropOnFolder(e, folderId);
  }

  function handleDragOverBreadcrumb(e, folderId) {
    e.preventDefault();
    if (!dragItemId || dragItemId === folderId) return;
    e.dataTransfer.dropEffect = 'move';
    setDropTargetId(folderId);
  }

  async function handleUploadFiles(e) {
    const files = Array.from(e.target.files);
    if (files.length === 0) return;
    if (insideExample) { e.target.value = ''; return; }
    setUploading(true);
    setShowNewMenu(false);

    const parent = findNode(fileTree, currentFolderId);
    if (!parent || parent.type !== 'folder') { setUploading(false); return; }

    let nextTree = fileTree;
    for (const file of files) {
      const parsed = await parseFile(file);
      const newFile = {
        id: genId(),
        name: parsed.fileName,
        type: 'file',
        content: parsed.type === 'text' ? parsed.content : `# ${file.name}\n\n[Image file — content not displayable as text]`,
        createdBy: userName,
      };
      nextTree = addChildToTree(nextTree, currentFolderId, newFile);
    }

    onUpdateTree(nextTree, currentFolderId);
    setUploading(false);
    if (uploadInputRef.current) uploadInputRef.current.value = '';
  }

  const canCreateFolder = isRoot;
  const canCreateFile = isKnowledgeFolder || isSkillsFolder;
  const isLeafFolder = isKnowledgeFolder || isSkillsFolder;

  return (
    <div className="fl-explorer">
      {/* Breadcrumb */}
      <div className="fl-breadcrumb">
        {breadcrumb.map((node, i) => (
          <span key={node.id} className="fl-crumb-segment">
            {i > 0 && <span className="fl-crumb-sep">/</span>}
            <button
              className={`fl-crumb${i === breadcrumb.length - 1 ? ' is-current' : ''}${dropTargetId === node.id ? ' drop-target' : ''}`}
              onClick={() => navigateTo(node.id)}
              onDragOver={e => handleDragOverBreadcrumb(e, node.id)}
              onDragLeave={() => setDropTargetId(null)}
              onDrop={e => handleDropOnBreadcrumb(e, node.id)}
            >
              {i === 0 ? 'Workspace' : node.name}
            </button>
          </span>
        ))}
        {dragItemId && (
          <span className="fl-drag-hint">Drop on a folder or breadcrumb to move</span>
        )}
      </div>

      {/* Toolbar */}
      <div className="fl-toolbar">
        <div className="fl-toolbar-left">
          <span className="fl-item-count">
            {items.filter(i => i.type === 'folder').length} {items.filter(i => i.type === 'folder').length === 1 ? 'folder' : 'folders'}
            {' · '}
            {items.filter(i => i.type === 'file').length} {items.filter(i => i.type === 'file').length === 1 ? 'file' : 'files'}
          </span>
          {currentStage && <span className="fl-stage-pill">Stage {currentStage}</span>}
          {isKnowledgeFolder && items.length > 0 && <EducationalCue cueId="files-knowledge-base" show={showEducationalCues} />}
          {isSkillsFolder && items.length > 0 && <EducationalCue cueId="files-instructions" show={showEducationalCues} />}
        </div>
        <div className="fl-toolbar-right">
          {insideExample && (
            <span className="fl-readonly-pill" title="Example content is read-only. Clone or create your own folder to add files.">Example · read-only</span>
          )}
          {!insideExample && (
            <button className="fl-new" onClick={() => setShowNewMenu(!showNewMenu)}>
              New
              <span className="fl-new-arrow" aria-hidden>+</span>
            </button>
          )}
          {!insideExample && showNewMenu && (
            <div className="fl-new-menu">
              {(isRoot || (!isLeafFolder && !isRoot)) && (
                <button className="fl-new-option" onClick={() => openCreateModal('folder')}>
                  <FolderIcon color="#d97757" />
                  <span className="fl-new-option-label">
                    <span>New folder</span>
                    <span className="fl-new-option-hint">{isRoot ? 'folder at root' : 'subfolder'}</span>
                  </span>
                </button>
              )}
              {canCreateFile && (
                <>
                  <button className="fl-new-option" onClick={() => openCreateModal('file')}>
                    <FileIcon />
                    <span className="fl-new-option-label">
                      <span>Empty file</span>
                      <span className="fl-new-option-hint">start blank</span>
                    </span>
                  </button>
                  <button className="fl-new-option fl-new-option-ai" onClick={openAiCreateModal}>
                    <span className="fl-new-option-spark" aria-hidden>✦</span>
                    <span className="fl-new-option-label">
                      <span>Create with AI</span>
                      <span className="fl-new-option-hint">{isKnowledgeFolder ? 'draft a knowledge file' : 'draft a skills file'}</span>
                    </span>
                  </button>
                </>
              )}
              {!isRoot && !canCreateFile && !isLeafFolder && (
                <button className="fl-new-option" onClick={() => openCreateModal('file')}>
                  <FileIcon />
                  <span className="fl-new-option-label">
                    <span>New file</span>
                    <span className="fl-new-option-hint">markdown</span>
                  </span>
                </button>
              )}
              {!isRoot && (
                <button className="fl-new-option fl-upload" onClick={() => { uploadInputRef.current?.click(); setShowNewMenu(false); }}>
                  <span className="fl-upload-icon" aria-hidden>{'↑'}</span>
                  <span className="fl-new-option-label">
                    <span>{uploading ? 'Uploading…' : 'Upload file'}</span>
                    <span className="fl-new-option-hint">pdf · docx · md</span>
                  </span>
                </button>
              )}
            </div>
          )}
          <input type="file" ref={uploadInputRef} style={{ display: 'none' }} multiple onChange={handleUploadFiles}
            accept=".pdf,.doc,.docx,.xls,.xlsx,.csv,.txt,.md,.json,.png,.jpg,.jpeg,.gif,.webp" />
        </div>
        {!isRoot && <EducationalCue cueId="files-upload" show={showEducationalCues} />}
      </div>

      {/* Grid */}
      <div className="fl-grid" onClick={() => setShowNewMenu(false)}>
        {items.length === 0 && (
          <div className="fl-empty">
            {isKnowledgeFolder && (
              <>
                <div className="fl-empty-icon"><FolderIcon color="#5a9e6f" /></div>
                <p className="fl-empty-title">No knowledge files yet</p>
                <p className="fl-empty-desc">Add policies, SOPs, or rules that your AI coworker will reference at runtime.</p>
                <EducationalCue cueId="files-knowledge-base" show={showEducationalCues} />
                <div className="fl-empty-actions">
                  <button className="fl-empty-btn" onClick={openAiCreateModal}>
                    <span className="fl-empty-btn-spark" aria-hidden>✦</span>
                    Create with AI
                    <span className="fl-empty-btn-arrow" aria-hidden>{'→'}</span>
                  </button>
                  <button className="fl-empty-btn fl-empty-btn-secondary" onClick={() => uploadInputRef.current?.click()}>
                    Upload file
                  </button>
                </div>
              </>
            )}
            {isSkillsFolder && (
              <>
                <div className="fl-empty-icon"><FolderIcon color="#4a7fb5" /></div>
                <p className="fl-empty-title">No skill files yet</p>
                <p className="fl-empty-desc">Write reusable instructions that shape how the AI works, like a job aid for a new hire.</p>
                <EducationalCue cueId="files-instructions" show={showEducationalCues} />
                <div className="fl-empty-actions">
                  <button className="fl-empty-btn" onClick={openAiCreateModal}>
                    <span className="fl-empty-btn-spark" aria-hidden>✦</span>
                    Create with AI
                    <span className="fl-empty-btn-arrow" aria-hidden>{'→'}</span>
                  </button>
                  <button className="fl-empty-btn fl-empty-btn-secondary" onClick={() => uploadInputRef.current?.click()}>
                    Upload file
                  </button>
                </div>
              </>
            )}
            {isRoot && (
              <>
                <div className="fl-empty-icon"><FolderIcon /></div>
                <p className="fl-empty-title">No folders yet</p>
                <p className="fl-empty-desc">Each folder at root holds a knowledge folder and a skills folder. Compliance, Lending, Research, whatever shape your work takes.</p>
                <button className="fl-empty-btn" onClick={() => openCreateModal('folder')}>
                  New folder
                  <span className="fl-empty-btn-arrow" aria-hidden>{'→'}</span>
                </button>
              </>
            )}
            {!isRoot && !isKnowledgeFolder && !isSkillsFolder && (
              <>
                <div className="fl-empty-icon"><FolderIcon /></div>
                <p className="fl-empty-title">This folder is empty</p>
              </>
            )}
          </div>
        )}

        {(() => {
          const folderItems = items.filter(i => i.type === 'folder');
          const fileItems = items.filter(i => i.type === 'file');
          const renderFolderCard = (folder) => {
            const isSystem = folder.createdBy === 'System';
            const flavor = (folder.name === 'knowledge' || folder.name === 'skills') ? folder.name : null;
            const folderCount = (folder.children || []).filter(c => c.type === 'folder').length;
            const fileCount   = (folder.children || []).filter(c => c.type === 'file').length;
            return (
              <div
                key={folder.id}
                className={`fl-card fl-card-folder${dropTargetId === folder.id ? ' drop-target' : ''}${dragItemId === folder.id ? ' is-dragging' : ''}${isSystem ? ' fl-card-example' : ''}`}
                data-flavor={flavor || undefined}
                onClick={() => handleItemClick(folder)}
                draggable={!isSystem}
                onDragStart={e => !isSystem && handleDragStart(e, folder.id)}
                onDragOver={e => !isSystem && handleDragOverFolder(e, folder.id)}
                onDragLeave={e => handleDragLeaveFolder(e)}
                onDrop={e => !isSystem && handleDropOnFolder(e, folder.id)}
                onDragEnd={handleDragEnd}
              >
                <div className="fl-card-icon">
                  <FolderIcon color={getFolderColor(folder.name)} />
                </div>
                {renamingId === folder.id ? (
                  <input
                    autoFocus
                    className="fl-card-name fl-card-name-input"
                    value={renameDraft}
                    onClick={e => e.stopPropagation()}
                    onChange={e => setRenameDraft(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter') { e.preventDefault(); commitRename(folder); }
                      if (e.key === 'Escape') { e.preventDefault(); cancelRename(); }
                    }}
                    onBlur={() => commitRename(folder)}
                  />
                ) : (
                  <div className="fl-card-name">{folder.name}</div>
                )}
                {getFolderDescription(folder.name) && (
                  <div className="fl-card-desc">{getFolderDescription(folder.name)}</div>
                )}
                <div className="fl-card-meta">
                  {folderCount > 0 && `${folderCount} ${folderCount === 1 ? 'folder' : 'folders'}`}
                  {folderCount > 0 && fileCount > 0 && ' · '}
                  {fileCount > 0 && `${fileCount} ${fileCount === 1 ? 'file' : 'files'}`}
                  {folderCount === 0 && fileCount === 0 && 'Empty'}
                </div>
                {folder.name !== 'knowledge' && folder.name !== 'skills' && folder.createdBy === userName && (
                  <>
                    <button className="fl-card-action-rename" onClick={e => startRename(e, folder)} title="Rename">{'✎'}</button>
                    <button className="fl-card-action-delete" onClick={e => handleDelete(e, folder.id)} title="Delete">{'✕'}</button>
                  </>
                )}
              </div>
            );
          };
          const renderFileCard = (file) => {
            const isSystem = file.createdBy === 'System';
            const lines = typeof file.content === 'string'
              ? (file.content ? file.content.split('\n').length : 0)
              : null;
            const authorLabel = file.createdBy && file.createdBy !== 'System'
              ? (file.createdBy === userName ? 'You' : file.createdBy)
              : null;
            return (
              <div
                key={file.id}
                className={`fl-card fl-card-file${selectedFileId === file.id ? ' is-selected' : ''}${dragItemId === file.id ? ' is-dragging' : ''}${isSystem ? ' fl-card-example' : ''}`}
                onClick={() => handleItemClick(file)}
                draggable={!isSystem}
                onDragStart={e => !isSystem && handleDragStart(e, file.id)}
                onDragEnd={handleDragEnd}
              >
                <div className="fl-card-icon">
                  <FileIcon />
                </div>
                {renamingId === file.id ? (
                  <input
                    autoFocus
                    className="fl-card-name fl-card-name-input"
                    value={renameDraft}
                    onClick={e => e.stopPropagation()}
                    onChange={e => setRenameDraft(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter') { e.preventDefault(); commitRename(file); }
                      if (e.key === 'Escape') { e.preventDefault(); cancelRename(); }
                    }}
                    onBlur={() => commitRename(file)}
                  />
                ) : (
                  <div className="fl-card-name">{file.name}</div>
                )}
                <div className="fl-card-meta">
                  {lines === null ? '' : (lines > 0 ? `${lines} ${lines === 1 ? 'line' : 'lines'}` : 'Empty')}
                  {authorLabel && (
                    <span className="fl-card-meta-author">{authorLabel}</span>
                  )}
                </div>
                {isSystem && <span className="fl-card-badge">Example</span>}
                {file.createdBy === userName && (
                  <>
                    <button className="fl-card-action-rename" onClick={e => startRename(e, file)} title="Rename">{'✎'}</button>
                    <button className="fl-card-action-delete" onClick={e => handleDelete(e, file.id)} title="Delete">{'✕'}</button>
                  </>
                )}
              </div>
            );
          };

          if (!isRoot) {
            if (folderItems.length === 0 && fileItems.length === 0) return null;
            return (
              <div className="fl-flat-grid">
                {folderItems.map(renderFolderCard)}
                {fileItems.map(renderFileCard)}
              </div>
            );
          }

          const exampleFolders = folderItems.filter(f => f.createdBy === 'System');
          const mineFolders = folderItems.filter(f => f.createdBy && f.createdBy !== 'System' && f.createdBy === userName);
          const othersFolders = folderItems.filter(f => f.createdBy && f.createdBy !== 'System' && f.createdBy !== userName);
          const sections = [
            { key: 'examples', label: 'Examples', list: exampleFolders },
            { key: 'mine',     label: 'Added by you', list: mineFolders },
            { key: 'others',   label: 'Added by others', list: othersFolders },
          ].filter(s => s.list.length > 0);
          if (sections.length === 0) return null;
          return (
            <>
              {sections.map(s => (
                <div key={s.key} className="fl-section">
                  <div className="fl-section-head">
                    <span className="fl-section-title">{s.label}</span>
                    <span className="fl-section-count">{s.list.length}</span>
                  </div>
                  <div className="fl-section-grid">{s.list.map(renderFolderCard)}</div>
                </div>
              ))}
            </>
          );
        })()}
      </div>

      {/* Create modal */}
      {showModal && (
        <div className="fl-modal-overlay" onClick={() => setShowModal(false)}>
          <div className="fl-modal" onClick={e => e.stopPropagation()}>
            <div className="fl-modal-eyebrow">{modalMode === 'folder' ? 'New folder' : 'New file'}</div>
            <p className="fl-modal-desc">{modalMode === 'folder'
              ? (skillsRevealed
                  ? 'Each folder at root holds a knowledge folder (reference material) and a skills folder (instructions). Coworkers read from both.'
                  : 'Each folder at root holds a knowledge folder for reference material your coworkers can read.')
              : 'Markdown only. The AI reads what you write here as plain text — formatting matters.'}
            </p>
            <input
              className="fl-modal-input"
              type="text"
              placeholder={modalMode === 'folder' ? 'Folder name' : 'filename.md'}
              value={newName}
              onChange={e => setNewName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleCreate()}
              autoFocus
            />
            <div className="fl-modal-actions">
              <button className="fl-modal-btn fl-modal-btn-cancel" onClick={() => setShowModal(false)}>Cancel</button>
              <button className="fl-modal-btn fl-modal-btn-primary" onClick={handleCreate} disabled={!newName.trim()}>
                Create
                <span className="fl-modal-btn-arrow" aria-hidden>{'→'}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {aiModalOpen && (
        <div className="fl-modal-overlay" onClick={() => !aiBusy && setAiModalOpen(false)}>
          <div className="fl-modal fl-modal-ai" onClick={e => e.stopPropagation()}>
            <div className="fl-modal-eyebrow">
              <span className="fl-modal-spark" aria-hidden>✦</span>
              Create with AI · {isKnowledgeFolder ? 'knowledge file' : 'skills file'}
            </div>
            <p className="fl-modal-desc">
              {isKnowledgeFolder
                ? 'Describe what this knowledge file should cover. Foundry will draft a structured policy/rules document for your coworker to read.'
                : 'Describe what this skills file should do. Foundry will draft a structured instruction (Role / Inputs / Steps / Output) for your coworker to follow.'}
            </p>
            <textarea
              className="fl-modal-input fl-modal-textarea"
              placeholder={isKnowledgeFolder
                ? 'e.g. Our policy on cross-border wire transfers above $50,000'
                : 'e.g. How an underwriter writes a credit memo from an application'}
              value={aiPrompt}
              onChange={e => setAiPrompt(e.target.value)}
              rows={4}
              autoFocus
              disabled={aiBusy}
            />
            <input
              className="fl-modal-input"
              type="text"
              placeholder={`Filename (auto: ${slugifyPrompt(aiPrompt)})`}
              value={aiName}
              onChange={e => setAiName(e.target.value)}
              disabled={aiBusy}
            />
            {aiError && <p className="fl-modal-error">{aiError}</p>}
            <div className="fl-modal-actions">
              <button className="fl-modal-btn fl-modal-btn-cancel" onClick={() => setAiModalOpen(false)} disabled={aiBusy}>Cancel</button>
              <button
                className="fl-modal-btn fl-modal-btn-primary"
                onClick={handleAiGenerate}
                disabled={!aiPrompt.trim() || aiBusy}
              >
                {aiBusy ? 'Drafting…' : 'Generate'}
                {!aiBusy && <span className="fl-modal-btn-arrow" aria-hidden>✦</span>}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
