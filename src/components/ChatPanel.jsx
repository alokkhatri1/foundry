import { useState, useRef, useEffect, useMemo } from 'react';
import { parseFile, getFileCategory, getFileIcon } from '../utils/fileParser';
import RevealAt, { stageReached } from './RevealAt';
import ToolExecutionCard from './ToolExecutionCard';
import EducationalCue from './EducationalCue';
import RichText from './RichText';
import { CoworkerGlyph } from './Icon';

function parseConfidence(text) {
  const match = text.match(/[Cc]onfidence\s*[Ss]core[:\s]*([01]?\.\d+|[01])/);
  if (!match) return null;
  const val = parseFloat(match[1]);
  if (isNaN(val) || val < 0 || val > 1) return null;
  return val;
}

function ConfidenceBadge({ score }) {
  if (score === null || score === undefined) return null;
  const level = score >= 0.8 ? 'high' : score >= 0.5 ? 'medium' : 'low';
  return (
    <div className="cl-confidence">
      <span className={`cl-confidence-dot ${level}`}></span>
      Confidence: {score.toFixed(2)}
    </div>
  );
}

function UserAvatar({ name, color }) {
  return (
    <div className="cl-avatar cl-avatar-user" style={color ? { background: color } : undefined}>
      {(name || 'You').charAt(0).toUpperCase()}
    </div>
  );
}

function AssistantAvatar({ label, coworkerAvatar }) {
  if (coworkerAvatar) {
    return (
      <div className="cl-avatar cl-avatar-ai">
        <CoworkerGlyph avatar={coworkerAvatar} size={18} color="#ffffff" />
      </div>
    );
  }
  const letter = (label || 'AI').charAt(0).toUpperCase();
  return <div className="cl-avatar cl-avatar-ai">{letter}</div>;
}

function ChatMessage({ msg, onApprovalAction, onPickRecipient, onNudgeRecipient, onGoToFiles, onRetry, participants, currentUserName, showEducationalCues }) {
  const [comment, setComment] = useState('');
  const sender = msg.participantName ? participants?.find(p => p.name === msg.participantName) : null;

  if (msg.type === 'status') return <div className="cl-status"><span>{msg.content}</span></div>;

  if (msg.type === 'user') {
    return (
      <div className="cl-row cl-row-user">
        <UserAvatar name={msg.participantName} color={sender?.color} />
        <div className="cl-bubble cl-bubble-user">
          {msg.participantName && <div className="cl-bubble-sender">{msg.participantName}</div>}
          {msg.attachments && msg.attachments.length > 0 && (
            <div className="cl-attachments">
              {msg.attachments.map((att, i) => (
                <span key={i} className="cl-attachment-chip">
                  <span className="cl-attachment-icon">{getFileIcon(att.category)}</span>
                  {att.fileName}
                </span>
              ))}
            </div>
          )}
          <div>{msg.content}</div>
        </div>
      </div>
    );
  }

  if (msg.type === 'agent') {
    const confidence = parseConfidence(msg.content);
    return (
      <div className="cl-row cl-row-ai">
        <AssistantAvatar label={msg.label} coworkerAvatar={msg.coworkerAvatar} />
        <div className="cl-bubble cl-bubble-ai">
          <div className="cl-bubble-label agent">{msg.label || 'Agent'}</div>
          <ConfidenceBadge score={confidence} />
          {confidence !== null && <EducationalCue cueId="chat-confidence" show={showEducationalCues} />}
          <RichText content={msg.content} />
        </div>
      </div>
    );
  }

  if (msg.type === 'approval') {
    const isActive = !msg.resolved;
    return (
      <div className="cl-row cl-row-ai">
        <AssistantAvatar label="!" />
        <div className="cl-bubble cl-bubble-approval">
          <div className="cl-bubble-label approval">Review step</div>
          <div className="cl-bubble-content">{msg.prompt || 'Review the upstream output and approve or reject with feedback.'}</div>
          <EducationalCue cueId="chat-approval-gate" show={showEducationalCues} />
          {msg.previousOutput && (
            <div className="cl-approval-context">
              {msg.previousOutput.length > 400 ? msg.previousOutput.slice(0, 400) + '...' : msg.previousOutput}
            </div>
          )}
          {isActive && (
            <>
              <textarea className="cl-approval-comment" placeholder="Feedback (required if rejecting)..." value={comment} onChange={e => setComment(e.target.value)} rows={2} />
              <EducationalCue cueId="chat-approval-actions" show={showEducationalCues} />
              <div className="cl-approval-actions">
                <button
                  className="cl-send-btn-approve"
                  onClick={() => onApprovalAction(msg.runId, msg.id, 'Approve', comment)}
                >
                  Approve
                </button>
                <button
                  className="cl-send-btn-cancel"
                  disabled={!comment.trim()}
                  title={comment.trim() ? '' : 'Add feedback before rejecting'}
                  onClick={() => onApprovalAction(msg.runId, msg.id, 'Reject', comment)}
                >
                  Reject with feedback
                </button>
              </div>
            </>
          )}
          {msg.resolved && (
            <div className="cl-approval-resolved">
              {msg.resolvedAction}
              {msg.resolvedComment && <span className="cl-approval-resolved-comment"> — "{msg.resolvedComment}"</span>}
            </div>
          )}
        </div>
      </div>
    );
  }

  if (msg.type === 'system') {
    return (
      <div className="cl-row cl-row-ai"><AssistantAvatar label="S" />
        <div className="cl-bubble cl-bubble-system"><div className="cl-bubble-label system">System</div><div className="cl-bubble-content cl-mono">{msg.content}</div></div>
      </div>
    );
  }

  if (msg.type === 'error') {
    return (
      <div className="cl-row cl-row-ai"><AssistantAvatar label="!" />
        <div className="cl-bubble cl-bubble-error"><div className="cl-bubble-label error">Error</div><div className="cl-bubble-content">{msg.content}</div>
          {onRetry && <button className="cl-retry-btn" onClick={() => onRetry(msg.stepId)}>Retry</button>}
        </div>
      </div>
    );
  }

  if (msg.type === 'loading') {
    return (
      <div className="cl-row cl-row-ai"><AssistantAvatar label={msg.label} />
        <div className="cl-bubble cl-bubble-ai"><div className="cl-bubble-label agent">{msg.label || 'AI'}</div><div className="cl-loading"><span></span><span></span><span></span></div></div>
      </div>
    );
  }

  if (msg.type === 'tool_execution') {
    return <ToolExecutionCard msg={msg} />;
  }

  if (msg.type === 'recipient-picker') {
    const status = msg.status || 'pending';
    const allowedSet = msg.allowedParticipantIds && msg.allowedParticipantIds.length > 0
      ? new Set(msg.allowedParticipantIds)
      : null;
    const onlineHumans = (participants || []).filter(p =>
      p.online
      && (p.kind || 'human') === 'human'
      && p.name !== currentUserName
      && (!allowedSet || allowedSet.has(p.id))
    );
    const coworkerLabel = msg.coworkerName || 'Coworker';

    const label =
      status === 'pending' ? `${coworkerLabel} needs a human`
      : status === 'waiting' ? `${coworkerLabel} is waiting on ${msg.resolvedRecipient}`
      : status === 'resolved' ? `${msg.resolvedRecipient} replied to ${coworkerLabel}`
      : status === 'error' ? `Couldn't reach ${msg.resolvedRecipient || 'recipient'}`
      : '';

    return (
      <div className="cl-row cl-row-ai">
        <AssistantAvatar label={coworkerLabel} coworkerAvatar={msg.coworkerAvatar} />
        <div className="cl-bubble cl-bubble-approval">
          <div className="cl-bubble-label approval">{label}</div>
          <div className="cl-bubble-content">{msg.question}</div>

          {status === 'pending' && (
            <>
              <div className="cl-picker-prompt">Pick who to ask:</div>
              {onlineHumans.length === 0 ? (
                <div className="cl-picker-empty">No allowed humans are currently online.</div>
              ) : (
                <div className="cl-picker-list">
                  {onlineHumans.map(p => (
                    <button
                      key={p.id || p.name}
                      className="cl-picker-chip"
                      style={p.color ? { borderColor: p.color } : undefined}
                      onClick={() => onPickRecipient && onPickRecipient(msg.id, p.name)}
                    >
                      <span className="cl-picker-dot" style={{ background: p.color || '#5a9e6f' }} />
                      {p.name}
                    </button>
                  ))}
                </div>
              )}
            </>
          )}

          {status === 'waiting' && (
            <>
              <div className="cl-picker-prompt">
                DM sent to <strong>{msg.resolvedRecipient}</strong>. Waiting for their decision
                {msg.nudgeCount > 0 && <> · nudged {msg.nudgeCount}×</>}…
              </div>
              <div className="cl-dm-review-actions">
                <button
                  className="cl-picker-chip"
                  onClick={() => onNudgeRecipient && onNudgeRecipient(msg.id)}
                  title="Re-send the question with a nudge"
                >
                  Nudge {msg.resolvedRecipient}
                </button>
              </div>
            </>
          )}

          {status === 'resolved' && msg.reply && (
            <div className="cl-picker-reply">
              <div className="cl-picker-reply-label">{msg.resolvedRecipient} said</div>
              <div className="cl-picker-reply-text">{msg.reply}</div>
            </div>
          )}

          {status === 'error' && (
            <div className="cl-approval-resolved">{msg.errorOutput || 'Could not send the question.'}</div>
          )}
        </div>
      </div>
    );
  }

  if (msg.type === 'direct-response') {
    return (
      <div className="cl-row cl-row-ai">
        <AssistantAvatar label={msg.label || 'AI'} coworkerAvatar={msg.coworkerAvatar} />
        <div className="cl-bubble cl-bubble-ai">
          {msg.label && <div className="cl-bubble-label agent">{msg.label}</div>}
          <RichText content={msg.content} />
        </div>
      </div>
    );
  }

  return (
    <div className="cl-row cl-row-ai"><AssistantAvatar label="AI" />
      <div className="cl-bubble cl-bubble-ai"><RichText content={msg.content} /></div>
    </div>
  );
}

// ===== Helper: find node in tree =====
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

// ===== Slack-style Context Sidebar =====
function ContextSidebar({ fileTree, selectedFileIds, onToggleFile, onToggleFolder, onToggleSubfolder, onOpenFile, editingFileId, participants, currentUserName, coworkers, activeCoworkerId, onSelectCoworker, showEducationalCues, conversations, activeConvoId, onNewChat, onSelectConvo, onDeleteConvo, onOpenDm, activeDm, unreadDmCounts, currentStage, sb }) {
  const [collapsedSections, setCollapsedSections] = useState(() => {
    // Default all folders to collapsed
    const collapsed = {};
    if (fileTree?.children) {
      fileTree.children.forEach(dept => {
        collapsed[dept.id] = true;
        if (dept.children) dept.children.forEach(sub => { collapsed[sub.id] = true; });
      });
    }
    return collapsed;
  });
  const [searchFilter, setSearchFilter] = useState('');

  if (!fileTree) return null;

  function getAllFiles(node) {
    const results = [];
    if (node.type === 'file') results.push(node);
    if (node.children) node.children.forEach(c => results.push(...getAllFiles(c)));
    return results;
  }

  function toggleSection(id) {
    setCollapsedSections(prev => ({ ...prev, [id]: !prev[id] }));
  }

  // Build department-level groups with their subfolders
  function getDepartments() {
    return (fileTree.children || []).map(dept => ({
      id: dept.id,
      name: dept.name,
      subfolders: (dept.children || []).map(subfolder => ({
        id: subfolder.id,
        name: subfolder.name,
        files: (subfolder.children || []).filter(c => c.type === 'file'),
      })),
    }));
  }

  const departments = getDepartments();
  // Humans only — AI coworker mirror participants (kind='ai') are rendered
  // via the separate AI Coworkers section.
  const humanParticipants = (participants || []).filter(p => (p.kind || 'human') === 'human');
  const online = humanParticipants.filter(p => p.online);
  const offline = humanParticipants.filter(p => !p.online);
  const activeCount = selectedFileIds.length;
  const filterTerm = searchFilter.toLowerCase().trim();

  // Resolve active files for pinned section
  const activeFiles = selectedFileIds.map(id => findNode(fileTree, id)).filter(Boolean);

  const sortedConvos = [...(conversations || [])].reverse();

  return (
    <div className="sl-sidebar">
      {/* Files — Stage 3 */}
      {stageReached(currentStage, '3') && (
      <div className="sl-section sl-context-section">
        <div className="sl-section-header">
          <span className="sl-section-name">Files</span>
        </div>

        {departments.map(dept => {
          const isDeptCollapsed = collapsedSections[dept.id];
          return (
            <div key={dept.id} className="sl-dept">
              <div className="sl-dept-header" onClick={() => toggleSection(dept.id)}>
                <span className={`sl-group-caret${!isDeptCollapsed ? ' open' : ''}`}>{'\u25B6'}</span>
                <span className="sl-dept-name">{dept.name}</span>
              </div>
              {!isDeptCollapsed && dept.subfolders.map(subfolder => {
                const isCollapsed = collapsedSections[subfolder.id];
                const subfolderFileIds = subfolder.files.map(f => f.id);
                const folderAllOn = subfolderFileIds.length > 0 && subfolderFileIds.every(id => selectedFileIds.includes(id));
                return (
                  <div key={subfolder.id} className="sl-channel-group">
                    <div className="sl-group-header" onClick={() => toggleSection(subfolder.id)}>
                      <span className={`sl-group-caret${!isCollapsed ? ' open' : ''}`}>{'\u25B6'}</span>
                      <span className="sl-group-name">{subfolder.name}</span>
                      {subfolderFileIds.length > 0 && (
                        <span
                          className={`sl-channel-dot${folderAllOn ? ' on' : ''}`}
                          onClick={e => { e.stopPropagation(); onToggleSubfolder(subfolderFileIds); }}
                          title={folderAllOn ? 'Remove folder from context' : `Add all ${subfolderFileIds.length} file${subfolderFileIds.length === 1 ? '' : 's'} as context`}
                        ></span>
                      )}
                    </div>
                    {!isCollapsed && subfolder.files.map(file => {
                      const isActive = selectedFileIds.includes(file.id);
                      const displayName = file.name.replace(/\.md$/, '');
                      return (
                        <div key={file.id} className={`sl-channel${isActive ? ' active' : ''}`}>
                          <span className={`sl-channel-hash${isActive ? ' on' : ''}`}>#</span>
                          <span className="sl-channel-name" onClick={() => onOpenFile(file.id)}>{displayName}</span>
                          <span className={`sl-channel-dot${isActive ? ' on' : ''}`} onClick={e => { e.stopPropagation(); onToggleFile(file.id); }} title={isActive ? 'Remove from context' : 'Add to context'}></span>
                        </div>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
      )}

      {/* Chat History */}
      <div className="sl-section sl-chats-section">
        <div className="sl-section-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span className="sl-section-name">Chats</span>
          <button className="sl-new-chat-btn" onClick={onNewChat}>+ New</button>
        </div>
        <div className="sl-chat-list">
          {sortedConvos.map(c => (
            <div
              key={c.id}
              className={`sl-chat-item${activeConvoId === c.id ? ' active' : ''}`}
              onClick={() => onSelectConvo(c.id)}
            >
              <span className="sl-chat-title">{c.title || 'New Chat'}</span>
              <span className="sl-chat-meta">{c.messages?.length || 0} msgs</span>
              {sortedConvos.length > 1 && (
                <button className="sl-chat-delete" onClick={e => { e.stopPropagation(); onDeleteConvo(c.id); }}>{'\u2715'}</button>
              )}
            </div>
          ))}
          {sortedConvos.length === 0 && (
            <div className="sl-chat-empty" onClick={onNewChat}>Start a conversation</div>
          )}
        </div>
      </div>

      <div className="sl-spacer" />

      {/* AI Coworkers — Stage 5a */}
      {stageReached(currentStage, '5a') && coworkers && coworkers.length > 0 && (
        <div className="sl-section sl-agents-section">
          <div className="sl-section-header" onClick={() => toggleSection('agents')}>
            <span className="sl-section-name">AI Coworkers</span>
            <span className="sl-section-count">{coworkers.length}</span>
          </div>
          {!collapsedSections['agents'] && coworkers.map(cw => {
            const unread = (unreadDmCounts && unreadDmCounts[cw.name]) || 0;
            const canDm = stageReached(currentStage, '5a') && sb?.getCoworkerParticipantId;
            const isMine = cw.createdBy && cw.createdBy === currentUserName;
            const handleOpenAiDm = async (e) => {
              if (e) e.stopPropagation();
              const mirrorId = await sb.getCoworkerParticipantId(cw.id);
              if (mirrorId && onOpenDm) {
                onOpenDm({ id: mirrorId, name: cw.name, color: cw.color, kind: 'ai', coworkerId: cw.id });
              }
            };
            // Row-click routing:
            //   - My own coworker → main chat (the "Talking to X" flow)
            //   - Someone else's coworker → DM thread (the persisted history
            //     of everything that's happened between me and that coworker,
            //     including review requests, approvals, and replies). Chat
            //     mode for someone else's coworker would spin up an empty
            //     conversation and make the real DM history look lost.
            //   - An unread badge always forces DM so replies route back
            //     to direct_messages.
            const handleRowClick = () => {
              if (canDm && (unread > 0 || !isMine)) {
                handleOpenAiDm();
              } else {
                onSelectCoworker(cw.id);
              }
            };
            return (
              <div
                key={cw.id}
                className={`sl-dm sl-agent-item${activeCoworkerId === cw.id ? ' active-agent' : ''}${unread > 0 ? ' has-unread' : ''}`}
                onClick={handleRowClick}
              >
                <span className="sl-agent-emoji"><CoworkerGlyph avatar={cw.avatar} size={14} color="currentColor" /></span>
                <span className="sl-dm-name">{cw.name}</span>
                {unread > 0 && <span className="sl-dm-badge">{unread}</span>}
                {canDm && (
                  <button className="sl-ai-dm-btn" onClick={handleOpenAiDm} title={`DM ${cw.name}`}>{'\u2709\uFE0F'}</button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Co-workers / People */}
      <div className="sl-section sl-people-section">
        <div className="sl-section-header" onClick={() => toggleSection('people')}>
          <span className="sl-section-name">Coworkers</span>
          <span className="sl-section-count">{online.length}</span>
        </div>
        {!collapsedSections['people'] && (
          <>
            {online.map(p => {
              const isMe = p.name === currentUserName;
              const isActive = activeDm?.name === p.name;
              const unread = (unreadDmCounts && unreadDmCounts[p.name]) || 0;
              return (
                <div
                  key={p.id}
                  className={`sl-dm online${isActive ? ' active-agent' : ''}${unread > 0 ? ' has-unread' : ''}`}
                  style={{ cursor: isMe ? 'default' : 'pointer' }}
                  onClick={() => !isMe && onOpenDm && onOpenDm(p)}
                >
                  <span className="sl-dm-status on"></span>
                  <span className="sl-dm-name">{p.name}{isMe ? ' (you)' : ''}</span>
                  {unread > 0 && <span className="sl-dm-badge">{unread}</span>}
                </div>
              );
            })}
            {offline.map(p => {
              const isActive = activeDm?.name === p.name;
              const unread = (unreadDmCounts && unreadDmCounts[p.name]) || 0;
              return (
                <div
                  key={p.id}
                  className={`sl-dm${isActive ? ' active-agent' : ''}${unread > 0 ? ' has-unread' : ''}`}
                  style={{ cursor: 'pointer' }}
                  onClick={() => onOpenDm && onOpenDm(p)}
                >
                  <span className="sl-dm-status"></span>
                  <span className="sl-dm-name">{p.name}</span>
                  {unread > 0 && <span className="sl-dm-badge">{unread}</span>}
                </div>
              );
            })}
          </>
        )}
      </div>
    </div>
  );
}

// ===== Inline File Editor =====
function InlineEditor({ file, onUpdateContent, onClose }) {
  const [mode, setMode] = useState('view');
  const isEmpty = !file.content || file.content.trim() === '';

  return (
    <div className="ctx-editor">
      <div className="ctx-editor-header">
        <span className="ctx-editor-filename">{file.name}</span>
        <div className="file-editor-modes">
          <button
            className={`file-editor-mode${mode === 'view' ? ' active' : ''}`}
            onClick={() => setMode('view')}
          >View</button>
          <button
            className={`file-editor-mode${mode === 'edit' ? ' active' : ''}`}
            onClick={() => setMode('edit')}
          >Edit</button>
        </div>
        <button className="ctx-editor-close" onClick={onClose}>{'\u2715'}</button>
      </div>
      {mode === 'view' ? (
        <div className="ctx-editor-view md-doc">
          {isEmpty ? (
            <p style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>This file is empty. Click Edit to add content.</p>
          ) : (
            <RichText content={file.content} />
          )}
        </div>
      ) : (
        <textarea
          className="ctx-editor-textarea"
          value={file.content || ''}
          onChange={e => onUpdateContent(file.id, e.target.value)}
          spellCheck={false}
        />
      )}
    </div>
  );
}

// ===== Main ChatPanel =====
export default function ChatPanel({ messages, onSendMessage, onApprovalAction, onPickRecipient, onNudgeRecipient, onGoToFiles, onRetry, isLoading, participants, currentUserName, fileTree, onUpdateFileContent, coworkers, showEducationalCues, conversations, activeConvoId, onNewChat, onSelectConvo, onDeleteConvo, onCoworkerChange, currentStage, activeDm, onOpenDm, onCloseDm, myParticipantId, sb, unreadDmCounts }) {
  const [input, setInput] = useState('');
  const [selectedFileIds, setSelectedFileIds] = useState([]);
  const [editingFileId, setEditingFileId] = useState(null);
  const [attachedFiles, setAttachedFiles] = useState([]);
  const [parsingFiles, setParsingFiles] = useState(false);
  const [dmMessages, setDmMessages] = useState([]);
  const messagesRef = useRef(null);

  // Single source of truth: the active conversation owns its coworker. Deriving
  // activeCoworkerId from the conversation avoids a two-state race where the
  // "clear on convo change" effect used to wipe a local coworker selection the
  // moment App created a new convo for that coworker — which cost the user a
  // second click to get into the chat.
  const activeCoworkerId = (conversations || []).find(c => c.id === activeConvoId)?.coworkerId || null;

  // Derive which files are skills (anywhere inside a `skills` subfolder) vs context.
  const skillFileIds = useMemo(() => {
    const ids = [];
    const walk = (n, inSkills) => {
      const here = inSkills || (n.type === 'folder' && n.name === 'skills');
      if (n.type === 'file' && here) ids.push(n.id);
      (n.children || []).forEach(c => walk(c, here));
    };
    (fileTree?.children || []).forEach(c => walk(c, false));
    return ids;
  }, [fileTree]);
  const greeting = useMemo(() => {
    const firstName = (currentUserName || '').split(' ')[0] || 'there';
    const hour = new Date().getHours();
    const timeGreetings = hour < 12
      ? [`Good morning, ${firstName}`, `Morning, ${firstName}`, `Rise and build, ${firstName}`]
      : hour < 17
        ? [`Good afternoon, ${firstName}`, `Hey ${firstName}, what are we building?`, `Ready to create, ${firstName}?`]
        : [`Good evening, ${firstName}`, `Evening, ${firstName}`, `Still going, ${firstName}?`];
    const general = [
      `What's on your mind, ${firstName}?`,
      `Let's build something, ${firstName}.`,
      `What are we working on, ${firstName}?`,
      `How can I help, ${firstName}?`,
    ];
    const all = [...timeGreetings, ...general];
    return all[Math.floor(Math.random() * all.length)];
  }, [currentUserName, messages.length === 0]);
  const fileInputRef = useRef(null);
  const activeCoworker = activeCoworkerId ? coworkers?.find(c => c.id === activeCoworkerId) : null;

  // Clear context when switching conversations (activeCoworkerId is derived
  // from the conversation itself, so it doesn't need to be reset here).
  useEffect(() => {
    setSelectedFileIds([]);
    setAttachedFiles([]);
    setInput('');
  }, [activeConvoId]);

  useEffect(() => {
    if (messagesRef.current) messagesRef.current.scrollTop = messagesRef.current.scrollHeight;
  }, [messages.length, dmMessages.length]);

  // When entering DM mode: clear AI-side selections so the UI stays simple.
  useEffect(() => {
    if (activeDm) {
      setAttachedFiles([]);
      setSelectedFileIds([]);
    }
  }, [activeDm]);

  // Load and subscribe to DM messages when a DM is active.
  useEffect(() => {
    if (!activeDm?.id || !myParticipantId) { setDmMessages([]); return; }
    let cancelled = false;
    sb.fetchDmThread(myParticipantId, activeDm.id).then(initial => {
      if (!cancelled) setDmMessages(initial);
    });
    const unsub = sb.subscribeToDms(myParticipantId, (dm) => {
      const belongs = (dm.from_participant_id === activeDm.id && dm.to_participant_id === myParticipantId)
                    || (dm.from_participant_id === myParticipantId && dm.to_participant_id === activeDm.id);
      if (belongs) setDmMessages(prev => prev.some(m => m.id === dm.id) ? prev : [...prev, dm]);
    });
    return () => { cancelled = true; unsub(); };
  }, [sb, myParticipantId, activeDm?.id]);

  async function handleSend() {
    if ((!input.trim() && attachedFiles.length === 0) || isLoading || parsingFiles) return;
    const text = input.trim() || (attachedFiles.length > 0 ? `Analyze the attached file${attachedFiles.length > 1 ? 's' : ''}.` : '');
    if (activeDm) {
      if (!myParticipantId) return;
      const result = await sb.sendDm(myParticipantId, activeDm.id, text);
      if (result?.data) {
        setDmMessages(prev => prev.some(m => m.id === result.data.id) ? prev : [...prev, result.data]);
        setInput('');
      }
      return;
    }
    onSendMessage(text, selectedFileIds, activeCoworkerId, attachedFiles, skillFileIds);
    setInput('');
    setAttachedFiles([]);
  }

  async function handleFileSelect(e) {
    const files = Array.from(e.target.files);
    if (files.length === 0) return;
    setParsingFiles(true);
    const parsed = [];
    for (const file of files) {
      const result = await parseFile(file);
      parsed.push({
        ...result,
        category: getFileCategory(file),
        originalName: file.name,
      });
    }
    setAttachedFiles(prev => [...prev, ...parsed]);
    setParsingFiles(false);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  function removeAttachment(index) {
    setAttachedFiles(prev => prev.filter((_, i) => i !== index));
  }

  function handleSelectCoworker(cwId) {
    // Clicking a coworker always activates it. Closing happens via the banner
    // X. App resolves or creates the conversation; activeCoworkerId is derived
    // from the resulting conversation, so a single click is enough.
    if (onCoworkerChange) onCoworkerChange(cwId);
  }

  function handleToggleFile(fileId) {
    setSelectedFileIds(prev => prev.includes(fileId) ? prev.filter(id => id !== fileId) : [...prev, fileId]);
  }

  function handleToggleFolder(folder) {
    function getAllFileIds(node) {
      const ids = [];
      if (node.type === 'file') ids.push(node.id);
      if (node.children) node.children.forEach(c => ids.push(...getAllFileIds(c)));
      return ids;
    }
    const folderFileIds = getAllFileIds(folder);
    const allSelected = folderFileIds.every(id => selectedFileIds.includes(id));
    if (allSelected) setSelectedFileIds(prev => prev.filter(id => !folderFileIds.includes(id)));
    else setSelectedFileIds(prev => [...new Set([...prev, ...folderFileIds])]);
  }

  function handleToggleSubfolder(fileIds) {
    if (!fileIds || fileIds.length === 0) return;
    const allSelected = fileIds.every(id => selectedFileIds.includes(id));
    if (allSelected) setSelectedFileIds(prev => prev.filter(id => !fileIds.includes(id)));
    else setSelectedFileIds(prev => [...new Set([...prev, ...fileIds])]);
  }

  function handleOpenFile(fileId) {
    setEditingFileId(editingFileId === fileId ? null : fileId);
  }

  const isEmpty = messages.length === 0 && !isLoading;

  function renderInputArea() {
    const placeholder = isLoading ? 'Thinking...'
      : parsingFiles ? 'Reading files...'
      : activeDm ? `Message ${activeDm.name}...`
      : activeCoworker ? `Ask ${activeCoworker.name}...`
      : 'How can I help you today?';

    return (
      <div className="cl-input-area">
        <input type="file" ref={fileInputRef} style={{ display: 'none' }} multiple onChange={handleFileSelect}
          accept=".pdf,.doc,.docx,.xls,.xlsx,.csv,.txt,.md,.json,.png,.jpg,.jpeg,.gif,.webp" />
        <div className="cl-input-row">
          <div className="cl-context-info">
            {activeDm
              ? <span className="cl-context-active">
                  <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: activeDm.color || '#888', marginRight: 6, verticalAlign: 'middle' }}></span>
                  Talking to {activeDm.name}
                </span>
              : activeCoworker
                ? <span className="cl-context-active"><CoworkerGlyph avatar={activeCoworker.avatar} size={14} color="currentColor" /> Talking to {activeCoworker.name}</span>
                : activeContextCount > 0
                  ? <div className="cl-context-files-list">
                      {(() => {
                        const handled = new Set();
                        const chips = [];
                        ((fileTree && fileTree.children) || []).forEach(dept => {
                          ((dept.children) || []).forEach(sub => {
                            const ids = ((sub.children) || []).filter(c => c.type === 'file').map(f => f.id);
                            if (ids.length === 0) return;
                            const allSelected = ids.every(id => selectedFileIds.includes(id));
                            if (allSelected && ids.length > 1) {
                              chips.push({ kind: 'folder', key: `folder-${sub.id}`, name: `${dept.name}/${sub.name}`, count: ids.length, fileIds: ids });
                              ids.forEach(id => handled.add(id));
                            }
                          });
                        });
                        selectedFileIds.forEach(id => {
                          if (handled.has(id)) return;
                          const node = findNode(fileTree, id);
                          if (!node) return;
                          chips.push({ kind: 'file', key: id, id, node });
                        });
                        const stage4Open = stageReached(currentStage, '4');
                        return chips.map(chip => {
                          if (chip.kind === 'folder') {
                            return (
                              <span key={chip.key} className="cl-context-file-chip folder" title={`All ${chip.count} file${chip.count === 1 ? '' : 's'} in ${chip.name} attached`}>
                                <span className="cl-context-file-chip-role">{chip.count}</span>
                                <span className="cl-context-file-chip-name">{chip.name}</span>
                                <button className="cl-context-file-chip-remove" onClick={() => handleToggleSubfolder(chip.fileIds)}>{'\u2715'}</button>
                              </span>
                            );
                          }
                          const isSkill = skillFileIds.includes(chip.id);
                          return (
                            <span key={chip.key} className={`cl-context-file-chip${isSkill ? ' skill' : ''}`}>
                              {stage4Open && (
                                <span className="cl-context-file-chip-role" title={isSkill ? 'Skill file (from skills folder)' : 'Knowledge file (from knowledge folder)'}>
                                  {isSkill ? 'skill' : 'knowledge'}
                                </span>
                              )}
                              <span className="cl-context-file-chip-name">{chip.node.name.replace(/\.md$/, '')}</span>
                              <button className="cl-context-file-chip-remove" onClick={() => handleToggleFile(chip.id)}>{'\u2715'}</button>
                            </span>
                          );
                        });
                      })()}
                    </div>
                  : null
            }
          </div>
        </div>
        {(() => {
          if (activeContextCount === 0) return null;
          const totalChars = selectedFileIds.reduce((sum, id) => {
            const node = findNode(fileTree, id);
            return sum + (node?.content?.length || 0);
          }, 0);
          const CONTEXT_WARN_CHARS = 80000;
          if (totalChars < CONTEXT_WARN_CHARS) return null;
          const approxTokens = Math.round(totalChars / 4000);
          return (
            <div className="cl-context-warning" title="The AI sees everything you attach. Very large contexts can slow replies or hit the model's context limit.">
              Heads up — {activeContextCount} file{activeContextCount === 1 ? '' : 's'} attached, roughly {approxTokens}k tokens. Consider unselecting some to keep answers snappy.
            </div>
          );
        })()}
        {attachedFiles.length > 0 && (
          <div className="cl-attached-files">
            <EducationalCue cueId="chat-attachment" show={showEducationalCues} />
            {attachedFiles.map((f, i) => (
              <span key={i} className="cl-attached-chip">
                <span className="cl-attached-chip-icon">{getFileIcon(f.category)}</span>
                <span className="cl-attached-chip-name">{f.fileName}</span>
                <button className="cl-attached-chip-remove" onClick={() => removeAttachment(i)}>{'\u2715'}</button>
              </span>
            ))}
          </div>
        )}
        <div className="cl-input-box">
          {!activeDm && (
            <button className="cl-attach-btn" onClick={() => fileInputRef.current?.click()} disabled={isLoading || parsingFiles} title="Attach file">
              <svg width="18" height="18" viewBox="0 0 18 18" fill="none"><path d="M15.75 8.49L9.12 15.12C7.56 16.68 5.04 16.68 3.48 15.12C1.92 13.56 1.92 11.04 3.48 9.48L10.11 2.85C11.1 1.86 12.72 1.86 13.71 2.85C14.7 3.84 14.7 5.46 13.71 6.45L7.78 12.38C7.29 12.87 6.48 12.87 5.99 12.38C5.5 11.89 5.5 11.08 5.99 10.59L11.22 5.36" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
            </button>
          )}
          <textarea className="cl-input" placeholder={placeholder} value={input} onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
            disabled={isLoading || parsingFiles} rows={1} />
          <button className="cl-send-btn" onClick={handleSend} disabled={(!input.trim() && attachedFiles.length === 0) || isLoading || parsingFiles}>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M3 13L13 8L3 3V7L9 8L3 9V13Z" fill="currentColor"/></svg>
          </button>
        </div>
      </div>
    );
  }
  const activeContextCount = selectedFileIds.length;
  const editingFile = editingFileId ? findNode(fileTree, editingFileId) : null;

  return (
    <div className="cl-chat-teams">
      {/* Left: context sidebar */}
      <ContextSidebar
        fileTree={fileTree}
        selectedFileIds={selectedFileIds}
        onToggleFile={handleToggleFile}
        onToggleFolder={handleToggleFolder}
        onToggleSubfolder={handleToggleSubfolder}
        onOpenFile={handleOpenFile}
        editingFileId={editingFileId}
        participants={participants}
        currentUserName={currentUserName}
        coworkers={coworkers}
        activeCoworkerId={activeCoworkerId}
        onSelectCoworker={handleSelectCoworker}
        showEducationalCues={showEducationalCues}
        conversations={conversations}
        activeConvoId={activeConvoId}
        onNewChat={onNewChat}
        onSelectConvo={onSelectConvo}
        onDeleteConvo={onDeleteConvo}
        onOpenDm={onOpenDm}
        activeDm={activeDm}
        unreadDmCounts={unreadDmCounts}
        currentStage={currentStage}
        sb={sb}
      />

      {/* Middle: file editor (when open) */}
      {editingFile && onUpdateFileContent && (
        <InlineEditor
          file={editingFile}
          onUpdateContent={onUpdateFileContent}
          onClose={() => setEditingFileId(null)}
        />
      )}

      {/* Right: main chat area — one interface; context swaps via banner */}
      <div className="cl-chat-main">
        {(activeDm || activeCoworker) && (
          <div className="cl-agent-banner">
            {activeDm ? (
              <>
                <span className="cl-agent-banner-avatar" style={{ background: activeDm.color || '#888', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 600, fontSize: 13 }}>
                  {activeDm.name?.charAt(0)?.toUpperCase() || '?'}
                </span>
                <div className="cl-agent-banner-info">
                  <span className="cl-agent-banner-name">Talking to {activeDm.name}</span>
                </div>
                <button className="cl-agent-banner-close" onClick={onCloseDm}>{'\u2715'}</button>
              </>
            ) : (
              <>
                <span className="cl-agent-banner-avatar" style={{ background: activeCoworker.color || '#4a7fb5' }}>
                  <CoworkerGlyph avatar={activeCoworker.avatar} size={18} color="#ffffff" />
                </span>
                <div className="cl-agent-banner-info">
                  <span className="cl-agent-banner-name">Talking to {activeCoworker.name}</span>
                </div>
                <button className="cl-agent-banner-close" onClick={() => { if (onNewChat) onNewChat(); }} title="Close chat">{'\u2715'}</button>
              </>
            )}
          </div>
        )}

        {activeDm ? (
          <>
            <div className="dm-messages" ref={messagesRef}>
              <div className="dm-messages-inner">
                {dmMessages.length === 0 ? (
                  <div className="dm-empty">No messages yet. Send the first one.</div>
                ) : (
                  dmMessages.map(m => {
                    const isMine = m.from_participant_id === myParticipantId;
                    const senderName = isMine ? (currentUserName || 'Me') : activeDm.name;
                    const senderColor = isMine ? '#4a7fb5' : (activeDm.color || '#888');

                    return (
                      <div key={m.id} className={`cl-dm-flat${isMine ? ' mine' : ''}`}>
                        <div className="cl-dm-flat-header">
                          <span className="cl-dm-flat-avatar" style={{ background: senderColor }}>
                            {senderName?.charAt(0)?.toUpperCase()}
                          </span>
                          <span className="cl-dm-flat-name">{senderName?.toUpperCase()}</span>
                        </div>
                        <div className="cl-dm-flat-body">{m.content}</div>
                        <div className="cl-dm-flat-time">{new Date(m.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
            {renderInputArea()}
          </>
        ) : isEmpty ? (
          <div className="cl-center-layout">
            <div className="cl-welcome">
              <h2 className="cl-welcome-greeting">{greeting}</h2>
            </div>
            {renderInputArea()}
          </div>
        ) : (
          <>
            <div className="cl-messages" ref={messagesRef}>
              <div className="cl-messages-inner">
                {messages.filter(m => {
                  // Hide platform-tool executions before Stage 5a (tools aren't revealed yet).
                  if (m.type === 'tool_execution' && !stageReached(currentStage, '5a')) return false;
                  // Hide orchestration / approval messages before Stage 7 (Orchestration).
                  if ((m.type === 'approval' || m.type === 'workflow_start' || m.type === 'workflow_end') && !stageReached(currentStage, '6')) return false;
                  return true;
                }).map((msg, i) => (
                  <ChatMessage key={msg.id || i} msg={msg} onApprovalAction={onApprovalAction} onPickRecipient={onPickRecipient} onNudgeRecipient={onNudgeRecipient} onGoToFiles={onGoToFiles} onRetry={onRetry} participants={participants} currentUserName={currentUserName} showEducationalCues={showEducationalCues} />
                ))}
              </div>
            </div>
            {renderInputArea()}
          </>
        )}
      </div>
    </div>
  );
}
