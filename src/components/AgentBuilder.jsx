import { useState } from 'react';
import EducationalCue from './EducationalCue';

let agentCounter = Date.now();
function genAgentId() { return 'agent-' + (agentCounter++); }

const AVATAR_OPTIONS = [
  '\uD83D\uDCCB', '\uD83C\uDFE6', '\uD83D\uDD0D', '\uD83D\uDCCA', '\uD83D\uDCDD',
  '\uD83D\uDCE7', '\uD83D\uDEE1\uFE0F', '\uD83E\uDDD1\u200D\uD83D\uDCBB', '\uD83E\uDDD0', '\uD83D\uDCB0',
  '\u2696\uFE0F', '\uD83D\uDCC1', '\uD83D\uDD12', '\uD83C\uDFAF', '\uD83E\uDD16',
  '\uD83D\uDCA1',
];

const COLOR_OPTIONS = [
  '#4a7fb5', '#5a9e6f', '#c8956c', '#8b6fb0', '#c45c5c',
  '#4a9e9e', '#b5784a', '#6f8bb0', '#9e6f8b', '#6fb06f',
];

// Get ALL files from the tree with their department path
function getAllFilesWithPath(tree) {
  const files = [];
  function walk(node, path) {
    if (node.type === 'file') {
      files.push({ ...node, path: path.join(' / ') });
    }
    if (node.children) {
      node.children.forEach(c => walk(c, [...path, node.name]));
    }
  }
  if (tree.children) {
    tree.children.forEach(dept => walk(dept, [dept.name]));
  }
  return files;
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

// ===== Agent Card =====
function AgentCard({ agent, onSelect, onDelete, fileTree, showCreatedBy }) {
  const instrFile = agent.instructionFileId ? findNode(fileTree, agent.instructionFileId) : null;
  const knowledgeCount = agent.knowledgeFileIds?.length || 0;
  const isConfigured = agent.instructionFileId && knowledgeCount > 0;

  return (
    <div className="ag-card" onClick={() => onSelect(agent.id)}>
      <div className="ag-card-avatar" style={{ background: agent.color || '#4a7fb5' }}>
        {agent.avatar || '\uD83E\uDD16'}
      </div>
      <div className="ag-card-name">{agent.name}</div>
      <div className="ag-card-role">{agent.role || 'No role defined'}</div>
      <div className="ag-card-tags">
        {instrFile && <span className="ag-tag ag-tag-instr">{instrFile.name.replace(/\.md$/, '')}</span>}
        {knowledgeCount > 0 && <span className="ag-tag ag-tag-know">{knowledgeCount} knowledge</span>}
        {(agent.toolIds?.length || 0) > 0 && <span className="ag-tag ag-tag-tool">{agent.toolIds.length} tools</span>}
        {!isConfigured && <span className="ag-tag ag-tag-warn">Needs setup</span>}
      </div>
      {showCreatedBy && agent.createdBy && <div className="ag-card-by">by {agent.createdBy}</div>}
      <button className="ag-card-delete" onClick={e => { e.stopPropagation(); onDelete(agent.id); }} title="Delete">{'\u2715'}</button>
    </div>
  );
}

// ===== Agent Preview (right side) =====
function AgentPreview({ agent, fileTree }) {
  const instrFile = agent.instructionFileId ? findNode(fileTree, agent.instructionFileId) : null;
  const knowledgeFiles = (agent.knowledgeFileIds || []).map(id => findNode(fileTree, id)).filter(Boolean);
  const isReady = instrFile && knowledgeFiles.length > 0;

  return (
    <div className="ag-preview">
      <div className="ag-preview-header">
        <div className="ag-preview-avatar" style={{ background: agent.color || '#4a7fb5' }}>
          {agent.avatar || '\uD83E\uDD16'}
        </div>
        <div>
          <div className="ag-preview-name">{agent.name}</div>
          <div className="ag-preview-role">{agent.role || 'No role defined yet'}</div>
        </div>
      </div>

      <div className="ag-preview-status">
        <span className={`ag-preview-dot${isReady ? ' ready' : ''}`}></span>
        {isReady ? 'Ready to work' : 'Needs configuration'}
      </div>

      <div className="ag-preview-section">
        <div className="ag-preview-label">Instructions</div>
        {instrFile ? (
          <div className="ag-preview-file">{instrFile.name}</div>
        ) : (
          <div className="ag-preview-empty">No instruction file assigned</div>
        )}
      </div>

      <div className="ag-preview-section">
        <div className="ag-preview-label">Knowledge ({knowledgeFiles.length} files)</div>
        {knowledgeFiles.length > 0 ? (
          knowledgeFiles.map(f => <div key={f.id} className="ag-preview-file">{f.name}</div>)
        ) : (
          <div className="ag-preview-empty">No knowledge files selected</div>
        )}
      </div>

      <div className="ag-preview-section">
        <div className="ag-preview-label">What this agent can do</div>
        {isReady ? (
          <div className="ag-preview-examples">
            <p>Once assigned to a workflow step or chatted with directly, this agent will:</p>
            <ul>
              <li>Read and apply its instructions ({instrFile.name.replace(/\.md$/, '')})</li>
              <li>Reference {knowledgeFiles.length} knowledge document{knowledgeFiles.length > 1 ? 's' : ''} for context</li>
              <li>Analyze cases and provide structured assessments</li>
              <li>Return confidence scores and recommendations</li>
            </ul>
            <p className="ag-preview-hint">Try chatting with this agent in the Chat tab, or assign it to a workflow step.</p>
          </div>
        ) : (
          <div className="ag-preview-examples">
            <p>To get this agent working:</p>
            <ul>
              {!instrFile && <li>Select an instruction file (defines behavior)</li>}
              {knowledgeFiles.length === 0 && <li>Select knowledge files (provides context)</li>}
              {!agent.role && <li>Add a role description</li>}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}

// ===== Agent Editor =====
function AgentEditor({ agent, onUpdate, onBack, fileTree, tools, showEducationalCues }) {
  const allFiles = getAllFilesWithPath(fileTree);
  const allInstructionLike = allFiles; // All files are selectable as instructions
  const allKnowledgeLike = allFiles;   // All files are selectable as knowledge

  return (
    <div className="ag-editor">
      <div className="ag-editor-header">
        <button className="files-back-btn" onClick={onBack}>{'\u2190'} All Agents</button>
        <span className="ag-editor-title">
          <span className="ag-editor-avatar" style={{ background: agent.color || '#4a7fb5' }}>{agent.avatar || '\uD83E\uDD16'}</span>
          {agent.name || 'New Agent'}
        </span>
      </div>

      <div className="ag-editor-layout">
        <div className="ag-editor-body">
          <div className="ag-editor-section">
            <h3>Identity</h3>

            <div className="ag-field">
              <label>Avatar</label>
              <div className="ag-avatar-picker">
                {AVATAR_OPTIONS.map(emoji => (
                  <button key={emoji} className={`ag-avatar-option${agent.avatar === emoji ? ' selected' : ''}`} onClick={() => onUpdate({ ...agent, avatar: emoji })}>
                    {emoji}
                  </button>
                ))}
              </div>
            </div>

            <div className="ag-field">
              <label>Color</label>
              <div className="ag-color-picker">
                {COLOR_OPTIONS.map(color => (
                  <button key={color} className={`ag-color-option${agent.color === color ? ' selected' : ''}`} style={{ background: color }} onClick={() => onUpdate({ ...agent, color })} />
                ))}
              </div>
            </div>

            <div className="ag-field">
              <label>Name</label>
              <input type="text" value={agent.name} onChange={e => onUpdate({ ...agent, name: e.target.value })} placeholder="e.g., Document Verifier" />
            </div>

            <div className="ag-field">
              <label>Role</label>
              <input type="text" value={agent.role} onChange={e => onUpdate({ ...agent, role: e.target.value })} placeholder="Describe what this agent does in one sentence" />
            </div>
          </div>

          <div className="ag-editor-section">
            <h3>Instructions</h3>
            <p className="ag-section-desc">Select any file to use as this agent's instructions.</p>
            <EducationalCue cueId="agent-instructions" show={showEducationalCues} />
            <div className="ag-field">
              <select value={agent.instructionFileId || ''} onChange={e => onUpdate({ ...agent, instructionFileId: e.target.value })}>
                <option value="">Select a file...</option>
                {allInstructionLike.map(f => (
                  <option key={f.id} value={f.id}>{f.path} / {f.name}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="ag-editor-section">
            <h3>Knowledge</h3>
            <p className="ag-section-desc">Select files this agent can reference. You can pick from any folder.</p>
            <EducationalCue cueId="agents-knowledge" show={showEducationalCues} />
            <div className="ag-knowledge-list">
              {allKnowledgeLike.length === 0 && <span className="ag-no-files">No files found. Create them in the Files tab.</span>}
              {allKnowledgeLike.map(f => (
                <label key={f.id} className="ag-knowledge-item">
                  <input
                    type="checkbox"
                    checked={(agent.knowledgeFileIds || []).includes(f.id)}
                    onChange={e => {
                      const ids = agent.knowledgeFileIds || [];
                      onUpdate({
                        ...agent,
                        knowledgeFileIds: e.target.checked ? [...ids, f.id] : ids.filter(id => id !== f.id),
                      });
                    }}
                  />
                  <span className="ag-knowledge-name">{f.name}</span>
                  <span className="ag-knowledge-path">{f.path}</span>
                </label>
              ))}
            </div>
          </div>

          <div className="ag-editor-section">
            <h3>Tools</h3>
            <p className="ag-section-desc">What tools can this agent use?</p>
            <EducationalCue cueId="agents-tools" show={showEducationalCues} />
            <div className="ag-knowledge-list">
              {(!tools || tools.length === 0) && <span className="ag-no-files">No tools created yet. Create them in the Tools tab.</span>}
              {(tools || []).map(t => (
                <label key={t.id} className="ag-knowledge-item">
                  <input
                    type="checkbox"
                    checked={(agent.toolIds || []).includes(t.id)}
                    onChange={e => {
                      const ids = agent.toolIds || [];
                      onUpdate({
                        ...agent,
                        toolIds: e.target.checked ? [...ids, t.id] : ids.filter(id => id !== t.id),
                      });
                    }}
                  />
                  <span style={{ marginRight: 4 }}>{t.icon}</span>
                  <span className="ag-knowledge-name">{t.name}</span>
                  <span className="ag-knowledge-path">{t.type}</span>
                </label>
              ))}
            </div>
          </div>
        </div>

        {/* Live preview */}
        <AgentPreview agent={agent} fileTree={fileTree} />
      </div>
    </div>
  );
}

// ===== Main Export =====
export default function AgentBuilder({ agents, onUpdateAgents, fileTree, tools, userName, showEducationalCues }) {
  const [selectedAgentId, setSelectedAgentId] = useState(null);

  const selectedAgent = selectedAgentId ? agents.find(a => a.id === selectedAgentId) : null;
  const myAgents = agents.filter(a => a.createdBy === userName);
  const hiringAgents = agents.filter(a => a.createdBy && a.createdBy !== userName);

  function handleCreateAgent() {
    const newAgent = {
      id: genAgentId(),
      name: 'New Agent',
      role: '',
      avatar: AVATAR_OPTIONS[Math.floor(Math.random() * AVATAR_OPTIONS.length)],
      color: COLOR_OPTIONS[agents.length % COLOR_OPTIONS.length],
      instructionFileId: '',
      knowledgeFileIds: [],
      toolIds: [],
      createdBy: userName,
      createdAt: Date.now(),
    };
    onUpdateAgents([...agents, newAgent]);
    setSelectedAgentId(newAgent.id);
  }

  function handleUpdateAgent(updatedAgent) {
    onUpdateAgents(agents.map(a => a.id === updatedAgent.id ? updatedAgent : a));
  }

  function handleDeleteAgent(agentId) {
    if (!confirm('Delete this agent?')) return;
    onUpdateAgents(agents.filter(a => a.id !== agentId));
    if (selectedAgentId === agentId) setSelectedAgentId(null);
  }

  if (selectedAgent) {
    return (
      <div className="panel panel-center">
        <AgentEditor
          agent={selectedAgent}
          onUpdate={handleUpdateAgent}
          onBack={() => setSelectedAgentId(null)}
          fileTree={fileTree}
          tools={tools}
          showEducationalCues={showEducationalCues}
        />
      </div>
    );
  }

  return (
    <div className="panel panel-center">
      <div className="ag-list">
        <div className="ag-list-header">
          <div>
            <h2 className="ag-list-title">Your AI Team</h2>
            <p className="ag-list-subtitle">Create agents with knowledge, instructions, and tools.</p>
            <EducationalCue cueId="agents-overview" show={showEducationalCues} />
          </div>
          <button className="ag-hire-btn" onClick={handleCreateAgent}>+ Hire Agent</button>
        </div>
        <div className="ag-list-body">
          {/* My Agents */}
          <div className="ag-section">
            <div className="ag-section-title">My Agents ({myAgents.length})</div>
            <div className="ag-list-grid">
              {myAgents.length === 0 && (
                <div className="ag-list-empty">
                  <p>You haven't hired any agents yet.</p>
                  <button className="setup-btn-primary" onClick={handleCreateAgent} style={{ marginTop: 16 }}>
                    + Hire your first agent
                    <span className="btn-arrow">&#x2197;</span>
                  </button>
                </div>
              )}
              {myAgents.map(agent => (
                <AgentCard key={agent.id} agent={agent} onSelect={setSelectedAgentId} onDelete={handleDeleteAgent} fileTree={fileTree} />
              ))}
            </div>
          </div>

          {/* Hiring / Other Agents */}
          {hiringAgents.length > 0 && (
            <div className="ag-section">
              <div className="ag-section-title">Hiring ({hiringAgents.length})</div>
              <div className="ag-list-grid">
                {hiringAgents.map(agent => (
                  <AgentCard key={agent.id} agent={agent} onSelect={setSelectedAgentId} onDelete={handleDeleteAgent} fileTree={fileTree} showCreatedBy />
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
