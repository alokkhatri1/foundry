import { useState, useRef, useEffect, useMemo } from 'react';
import { parseFile, getFileCategory, getFileIcon } from '../utils/fileParser';
import RevealAt, { stageReached } from './RevealAt';
import ToolExecutionCard from './ToolExecutionCard';
import EducationalCue from './EducationalCue';
import RichText from './RichText';
import { CoworkerGlyph } from './Icon';
import useFileDraft from '../hooks/useFileDraft';
import { submitDm } from '../utils/dmOutbox';

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
  const [contextExpanded, setContextExpanded] = useState(false);
  const sender = msg.participantName ? participants?.find(p => p.name === msg.participantName) : null;

  if (msg.type === 'status') return <div className="cl-status"><span>{msg.content}</span></div>;

  if (msg.type === 'final_rejected') {
    const isSelf = msg.reviewerName && msg.reviewerName === currentUserName;
    const subject = isSelf ? 'You' : (msg.reviewerName || 'The reviewer');
    return (
      <div className="cl-row cl-row-ai">
        <div className="cl-final-rejected">
          <div className="cl-final-rejected-icon">{'✕'}</div>
          <div className="cl-final-rejected-body">
            <div className="cl-final-rejected-headline">
              {subject} rejected the workflow step.
            </div>
            {msg.comment && <div className="cl-final-rejected-comment">&ldquo;{msg.comment}&rdquo;</div>}
          </div>
        </div>
      </div>
    );
  }

  if (msg.type === 'nudge') {
    return (
      <div className="cl-row cl-row-ai">
        <div className="cl-nudge">
          <div className="cl-nudge-icon">{'\uD83D\uDD14'}</div>
          <div className="cl-nudge-body">
            <div className="cl-nudge-headline"><strong>{msg.fromName}</strong> nudged you</div>
            <div className="cl-nudge-sub">Please review this step.</div>
          </div>
        </div>
      </div>
    );
  }

  if (msg.type === 'user') {
    // Same transcript shape as an agent message (avatar + name + body,
    // no bubble), but right-aligned — name+body column sits to the
    // left of the avatar so the row mirrors the agent variant.
    return (
      <div className="cl-msg-row cl-msg-row-user">
        <div className="cl-msg-row-text">
          <div className="cl-msg-ai-name">{msg.participantName || 'You'}</div>
          <div className="cl-msg-ai-body">
            <div>{msg.content}</div>
            {msg.attachments && msg.attachments.length > 0 && (
              <div className="cl-msg-attachments">
                {msg.attachments.map((att, i) => (
                  <span key={i} className="cl-msg-attachment">
                    <span aria-hidden>{getFileIcon(att.category)}</span>
                    {att.fileName}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
        <UserAvatar name={msg.participantName} color={sender?.color} />
      </div>
    );
  }

  if (msg.type === 'agent') {
    const confidence = parseConfidence(msg.content);
    return (
      <div className="cl-msg-ai">
        <AssistantAvatar label={msg.label} coworkerAvatar={msg.coworkerAvatar} />
        <div>
          <div className="cl-msg-ai-name">{msg.label || 'Agent'}</div>
          <div className="cl-msg-ai-body">
            <RichText content={msg.content} />
          </div>
          {confidence !== null && (
            <div className="cl-msg-ai-status">
              <ConfidenceBadge score={confidence} />
              <EducationalCue cueId="chat-confidence" show={showEducationalCues} />
            </div>
          )}
        </div>
      </div>
    );
  }

  if (msg.type === 'approval') {
    const isActive = !msg.resolved;
    // Buttons render only for the assigned reviewer. The run starter still
    // sees the card (so they can monitor the upstream output and the
    // pending decision) but can't accidentally act on a review that
    // belongs to someone else. When no assignee is set, treat as
    // "anyone can review" — show buttons. The Approve/Reject by the
    // actual assignee fires handleRemoteApprove on their tab, which
    // round-trips through the approvals table and the realtime echo
    // resolves the executor on the run starter's tab.
    const hasAssignee = !!msg.assigneeName;
    const viewerIsAssignee = !hasAssignee || msg.assigneeName === currentUserName;
    const rawContext = msg.previousOutput || '';
    const CONTEXT_PREVIEW_CHARS = 600;
    const isLong = rawContext.length > CONTEXT_PREVIEW_CHARS;
    const previewText = isLong && !contextExpanded
      ? rawContext.slice(0, CONTEXT_PREVIEW_CHARS).replace(/\s+\S*$/, '')
      : rawContext;
    return (
      <div className="cl-row cl-row-ai">
        <AssistantAvatar label="!" />
        <div className="cl-bubble cl-bubble-approval">
          <div className="cl-bubble-label approval">Review step</div>
          <div className="cl-approval-prompt">{msg.prompt || 'Review the upstream output and approve or reject with feedback.'}</div>
          <EducationalCue cueId="chat-approval-gate" show={showEducationalCues} />
          {rawContext && (
            <div className="cl-approval-context-wrap">
              <div className="cl-approval-context-label">Upstream output</div>
              <div className={`cl-approval-context md-doc${contextExpanded ? ' expanded' : ''}`}>
                <RichText content={previewText} />
              </div>
              {isLong && (
                <button
                  className="cl-approval-context-toggle"
                  onClick={() => setContextExpanded(v => !v)}
                >
                  {contextExpanded ? 'Show less' : 'Show full output'}
                </button>
              )}
            </div>
          )}
          {isActive && viewerIsAssignee && (
            <>
              <textarea className="cl-approval-comment" placeholder="Feedback (required if rejecting)..." value={comment} onChange={e => setComment(e.target.value)} rows={2} />
              <EducationalCue cueId="chat-approval-actions" show={showEducationalCues} />
              <div className="cl-approval-actions">
                <button
                  className="cl-send-btn-approve"
                  onClick={() => onApprovalAction(msg.runId, msg.id, 'Approve', comment, { stepId: msg.stepId, stepName: msg.stepName, assigneeName: msg.assigneeName })}
                >
                  Approve
                </button>
                <button
                  className="cl-send-btn-cancel"
                  disabled={!comment.trim()}
                  title={comment.trim() ? '' : 'Add feedback before rejecting'}
                  onClick={() => onApprovalAction(msg.runId, msg.id, 'Reject', comment, { stepId: msg.stepId, stepName: msg.stepName, assigneeName: msg.assigneeName })}
                >
                  Reject with feedback
                </button>
              </div>
            </>
          )}
          {isActive && !viewerIsAssignee && (
            <div className="cl-approval-waiting">
              {'⏳'} Waiting for <strong>{msg.assigneeName}</strong> to review. They'll see the request in their Chat tab.
            </div>
          )}
          {msg.resolved && (() => {
            const a = msg.resolvedAction;
            if (a === 'Stale') {
              return (
                <div className="cl-approval-resolved stale">
                  <span className="cl-approval-resolved-action">{'\u231B'} This review is no longer live</span>
                  <div className="cl-approval-resolved-note">
                    The run that requested this review ended before you could respond (the page was refreshed). Start a new run if you still need this reviewed.
                  </div>
                </div>
              );
            }
            const kind = a === 'Approve' ? 'approved' : a === 'Cancelled' ? 'cancelled' : 'rejected';
            const label = a === 'Approve' ? '✓ Approved' : a === 'Cancelled' ? '\u2298 Cancelled' : '✕ Rejected';
            return (
              <div className={`cl-approval-resolved ${kind}`}>
                <span className="cl-approval-resolved-action">{label}</span>
                {msg.resolvedBy && <span className="cl-approval-resolved-by"> by {msg.resolvedBy}</span>}
                {msg.resolvedComment && <div className="cl-approval-resolved-comment">"{msg.resolvedComment}"</div>}
              </div>
            );
          })()}
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
    const isDm = msg.kind === 'dm';
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
      status === 'pending' && isDm ? `${coworkerLabel} wants to send a message`
      : status === 'pending' ? `${coworkerLabel} needs a human`
      : status === 'waiting' && isDm ? `Sending to ${msg.resolvedRecipient}…`
      : status === 'waiting' ? `${coworkerLabel} is waiting on ${msg.resolvedRecipient}`
      : status === 'sent' ? `Message delivered to ${msg.resolvedRecipient}`
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
              <div className="cl-picker-prompt">{isDm ? 'Pick who to send to:' : 'Pick who to ask:'}</div>
              {onlineHumans.length === 0 ? (
                <div className="cl-picker-empty">No humans are currently online.</div>
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

          {status === 'waiting' && !isDm && (
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
            <div className="cl-approval-resolved">{msg.errorOutput || 'Could not send the message.'}</div>
          )}
        </div>
      </div>
    );
  }

  if (msg.type === 'direct-response') {
    return (
      <div className="cl-msg-ai">
        <AssistantAvatar label={msg.label || 'AI'} coworkerAvatar={msg.coworkerAvatar} />
        <div>
          {msg.label && <div className="cl-msg-ai-name">{msg.label}</div>}
          <div className="cl-msg-ai-body">
            <RichText content={msg.content} />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="cl-msg-ai">
      <AssistantAvatar label="AI" />
      <div>
        <div className="cl-msg-ai-name">AI</div>
        <div className="cl-msg-ai-body"><RichText content={msg.content} /></div>
      </div>
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
function ContextSidebar({ fileTree, selectedFileIds, onToggleFile, onToggleFolder, onToggleSubfolder, onOpenFile, editingFileId, participants, currentUserName, coworkers, activeCoworkerId, onSelectCoworker, showEducationalCues, conversations, activeConvoId, onNewChat, onSelectConvo, onDeleteConvo, onOpenDm, activeDm, unreadDmCounts, currentStage, sb, workflowRuns }) {
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
  // One sidebar-wide search term: filters Files, Chats, and AI Coworkers
  // simultaneously so the sidebar doesn't grow multiple input chrome.
  const [searchFilter, setSearchFilter] = useState('');
  // Sidebar tabs: only one section visible at a time so each gets the
  // full sidebar height. 'chats' default; switches to humans / ai /
  // files on demand. The tab buttons sit between search and content.
  const [sidebarTab, setSidebarTab] = useState('chats');
  // If the active tab is gated by a stage that hasn't unlocked yet
  // (Files=Stage 3, AI Coworkers=Stage 5), fall back to Chats so the
  // participant doesn't land on a blank section.
  useEffect(() => {
    if (sidebarTab === 'files' && !stageReached(currentStage, '3')) setSidebarTab('chats');
    else if (sidebarTab === 'ai' && !stageReached(currentStage, '5')) setSidebarTab('chats');
  }, [sidebarTab, currentStage]);

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

  // Two-state sidebar:
  //   • Idle (no search): "my workspace" — only files, folders, and AI
  //     coworkers the current participant created show up. Humans and
  //     chats are user-local already.
  //   • Typing a query: scope widens to the whole workshop so anything
  //     anyone built that matches the query becomes reachable. Search is
  //     an explicit "show me everything" affordance, not a filter on the
  //     already-scoped list.
  const q = searchFilter.trim().toLowerCase();
  const matchesQuery = (text) => !q || (text || '').toLowerCase().includes(q);
  const ownedByMe = (node) => node?.createdBy === currentUserName;
  const hasMyFileDeep = (node) => {
    if (!node) return false;
    if (node.type === 'file') return ownedByMe(node);
    if (!Array.isArray(node.children)) return false;
    return node.children.some(hasMyFileDeep);
  };
  function getDepartments() {
    if (q) {
      // Search-wide view: every dept/subfolder/file in the workshop is
      // eligible; results narrow down to whatever matches the query.
      const deptRaw = (fileTree.children || []).map(dept => {
        const subfolders = (dept.children || []).map(subfolder => {
          const files = (subfolder.children || []).filter(c => c.type === 'file');
          const filtered = files.filter(f => matchesQuery(f.name.replace(/\.md$/, '')));
          return { id: subfolder.id, name: subfolder.name, files: filtered, hasMatch: filtered.length > 0 };
        });
        return { id: dept.id, name: dept.name, subfolders };
      });
      return deptRaw
        .filter(dept => dept.subfolders.some(sf => sf.hasMatch))
        .map(dept => ({
          ...dept,
          subfolders: dept.subfolders.filter(sf => sf.hasMatch),
        }));
    }
    // Idle view: only my own folders/files.
    return (fileTree.children || [])
      .filter(dept => ownedByMe(dept) || hasMyFileDeep(dept))
      .map(dept => ({
        id: dept.id,
        name: dept.name,
        subfolders: (dept.children || [])
          .filter(sub => ownedByMe(sub) || hasMyFileDeep(sub))
          .map(subfolder => ({
            id: subfolder.id,
            name: subfolder.name,
            files: (subfolder.children || []).filter(c => c.type === 'file' && ownedByMe(c)),
          })),
      }));
  }

  const departments = getDepartments();
  // Humans only — AI coworker mirror participants (kind='ai') are rendered
  // via the separate AI Coworkers section.
  const humanParticipants = (participants || []).filter(p => (p.kind || 'human') === 'human');
  // Sort so anyone with an unread DM floats to the top of their online/
  // offline bucket — this makes nudges and fresh replies visibly bubble up
  // instead of being buried mid-list. Within each tier (unread > read)
  // keep stable alphabetical order so the list doesn't shuffle randomly.
  const sortByUnread = (a, b) => {
    const ua = (unreadDmCounts && unreadDmCounts[a.name]) || 0;
    const ub = (unreadDmCounts && unreadDmCounts[b.name]) || 0;
    if (ua !== ub) return ub - ua;
    return (a.name || '').localeCompare(b.name || '');
  };
  // Unified search also narrows the humans list by name.
  const visibleHumans = humanParticipants.filter(p => matchesQuery(p.name));
  const online = visibleHumans.filter(p => p.online).sort(sortByUnread);
  const offline = visibleHumans.filter(p => !p.online).sort(sortByUnread);
  const activeCount = selectedFileIds.length;

  // Resolve active files for pinned section
  const activeFiles = selectedFileIds.map(id => findNode(fileTree, id)).filter(Boolean);

  // Chats render newest-first, active chat hoisted to the top. Full history
  // stays available — the list itself scrolls when it gets long. The unified
  // sidebar search also filters by chat title.
  const sortedConvos = (() => {
    let base = [...(conversations || [])].reverse();
    if (activeConvoId) {
      const active = base.find(c => c.id === activeConvoId);
      if (active) base = [active, ...base.filter(c => c.id !== activeConvoId)];
    }
    if (!q) return base;
    return base.filter(c => matchesQuery(c.title || 'New Chat'));
  })();

  // AI Coworkers follow the same two-state rule as Files: idle shows the
  // ones I built; typing a query widens to the whole roster so any peer's
  // coworker matching the term is reachable.
  const visibleCoworkers = q
    ? (coworkers || []).filter(cw => matchesQuery(cw.name))
    : (coworkers || []).filter(ownedByMe);

  // Flatten the file tree into a flat list with folder labels for the v3
  // sidebar. We lose the dept/subfolder collapse, but the workshop tree
  // is shallow (knowledge / skills) so we don't lose meaningful structure.
  const flatFiles = [];
  departments.forEach(dept => {
    dept.subfolders.forEach(sf => {
      sf.files.forEach(f => flatFiles.push({ id: f.id, name: f.name, folder: sf.name }));
    });
  });
  const initials = (name) => (name || '?').trim().split(/\s+/).slice(0, 2).map(s => s[0]?.toUpperCase()).join('');
  const showFiles = stageReached(currentStage, '3');
  const showCoworkersSection = stageReached(currentStage, '5');

  return (
    <aside className="cl-sidebar">
      {/* Unified search — filters chats / teammates / coworkers / files. */}
      <div className="cl-search">
        <span className="cl-search-icon" aria-hidden>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="7" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
        </span>
        <input
          className="cl-search-input"
          placeholder={'Search files, chats, coworkers'}
          value={searchFilter}
          onChange={e => setSearchFilter(e.target.value)}
        />
        {searchFilter && (
          <button className="cl-search-clear" onClick={() => setSearchFilter('')} aria-label="Clear">{'✕'}</button>
        )}
      </div>

      {/* Sidebar tabs — 2×2 grid, stage-gated:
          row 1: Chats (always) | Files (Stage 3+)
          row 2: Coworkers (always) | AI Coworkers (Stage 5+)
          When a tab's stage hasn't unlocked, the tab is hidden from
          the strip entirely so the participant only sees what they
          actually have access to. */}
      <div className="cl-sidebar-tabs">
        <button
          type="button"
          className={`cl-sidebar-tab${sidebarTab === 'chats' ? ' is-active' : ''}`}
          onClick={() => setSidebarTab('chats')}
        >Chats</button>
        {showFiles && (
          <button
            type="button"
            className={`cl-sidebar-tab${sidebarTab === 'files' ? ' is-active' : ''}`}
            onClick={() => setSidebarTab('files')}
          >Files</button>
        )}
        <button
          type="button"
          className={`cl-sidebar-tab${sidebarTab === 'humans' ? ' is-active' : ''}`}
          onClick={() => setSidebarTab('humans')}
        >Coworkers</button>
        {showCoworkersSection && (
          <button
            type="button"
            className={`cl-sidebar-tab${sidebarTab === 'ai' ? ' is-active' : ''}`}
            onClick={() => setSidebarTab('ai')}
          >AI&nbsp;Coworkers</button>
        )}
      </div>

      <div className="cl-sections">

      {/* Chats */}
      {sidebarTab === 'chats' && (
      <div className="cl-section">
        <div className="cl-section-head">
          <div className="cl-section-label">Chats</div>
          <button className="cl-section-action" onClick={onNewChat}>+ New</button>
        </div>
        <div className="cl-section-body">
          {sortedConvos.length === 0 && q && (
            <div className="cl-section-empty">No chats match &ldquo;{searchFilter}&rdquo;</div>
          )}
          {sortedConvos.length === 0 && !q && (
            <div className="cl-section-empty">Start a conversation</div>
          )}
          {sortedConvos.map(c => {
            const isRun = typeof c.id === 'string' && c.id.startsWith('convo-run-');
            let runLive = false;
            if (isRun) {
              const runId = c.id.slice('convo-run-'.length);
              const run = (workflowRuns || []).find(r => r.id === runId);
              runLive = !!(run && (run.status === 'running' || run.status === 'waiting_approval'));
            }
            const tsLabel = isRun ? (runLive ? 'Live' : 'Done') : `${c.messages?.length || 0}`;
            return (
              <button
                key={c.id}
                type="button"
                className={`cl-list-row${activeConvoId === c.id ? ' is-active' : ''}`}
                onClick={() => onSelectConvo(c.id)}
              >
                <div className="cl-list-row-title">{c.title || 'New Chat'}</div>
                <div className="cl-list-row-time">{tsLabel}</div>
              </button>
            );
          })}
        </div>
      </div>
      )}

      {/* Coworkers (humans in the room) */}
      {sidebarTab === 'humans' && visibleHumans.length > 0 && (
        <div className="cl-section">
          <div className="cl-section-head">
            <div className="cl-section-label">Coworkers</div>
            <span className="cl-section-tag">Human</span>
          </div>
          <div className="cl-section-body">
            {[...online, ...offline].map(p => {
              const isMe = p.name === currentUserName;
              const isActive = activeDm?.name === p.name;
              const unread = (unreadDmCounts && unreadDmCounts[p.name]) || 0;
              return (
                <button
                  key={p.id}
                  type="button"
                  className={`cl-list-row${isActive ? ' is-active' : ''}`}
                  style={{ cursor: isMe ? 'default' : 'pointer' }}
                  onClick={() => !isMe && onOpenDm && onOpenDm(p)}
                >
                  <span className="cl-avatar cl-avatar-human">
                    {initials(p.name)}
                    <span className={`cl-avatar-dot${p.online ? '' : ' is-off'}`} aria-hidden></span>
                  </span>
                  <div className="cl-list-row-meta">
                    <div className="cl-list-row-name">{p.name}{isMe ? ' (you)' : ''}</div>
                    <div className="cl-list-row-sub">
                      {p.online ? 'Online' : 'Offline'}
                      {unread > 0 ? ` · ${unread} new` : ''}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* AI Coworkers — Stage 5+ */}
      {sidebarTab === 'ai' && showCoworkersSection && visibleCoworkers.length > 0 && (
        <div className="cl-section">
          <div className="cl-section-head">
            <div className="cl-section-label">AI Coworkers</div>
            <span className="cl-section-tag is-ai">Agent</span>
          </div>
          <div className="cl-section-body">
            {[...visibleCoworkers].sort(sortByUnread).map(cw => {
              const unread = (unreadDmCounts && unreadDmCounts[cw.name]) || 0;
              const canDm = sb?.getCoworkerParticipantId;
              const isMine = cw.createdBy && cw.createdBy === currentUserName;
              const handleOpenAiDm = async () => {
                const mirrorId = await sb.getCoworkerParticipantId(cw.id);
                if (mirrorId && onOpenDm) {
                  onOpenDm({ id: mirrorId, name: cw.name, color: cw.color, kind: 'ai', coworkerId: cw.id });
                }
              };
              const handleRowClick = () => {
                if (canDm && (unread > 0 || !isMine)) {
                  handleOpenAiDm();
                } else {
                  onSelectCoworker(cw.id);
                }
              };
              return (
                <button
                  key={cw.id}
                  type="button"
                  className={`cl-list-row${activeCoworkerId === cw.id ? ' is-active' : ''}`}
                  onClick={handleRowClick}
                >
                  <span className="cl-avatar cl-avatar-ai" style={{ background: cw.color || '#4a7fb5' }}>
                    <CoworkerGlyph avatar={cw.avatar} size={12} color="#ffffff" />
                    <span className="cl-avatar-spark" aria-hidden>{'✦'}</span>
                  </span>
                  <div className="cl-list-row-meta">
                    <div className="cl-list-row-name">{cw.name}</div>
                    <div className="cl-list-row-sub">
                      {isMine ? 'Yours' : 'Shared'}
                      {unread > 0 ? ` · ${unread} new` : ''}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Files in context — Stage 3+ */}
      {sidebarTab === 'files' && showFiles && (
        <div className="cl-section">
          <div className="cl-section-head">
            <div className="cl-section-label">Files in context</div>
            {selectedFileIds.length > 0 && (
              <span className="cl-section-tag">{selectedFileIds.length}</span>
            )}
          </div>
          <div className="cl-section-body">
            {flatFiles.length === 0 && (
              <div className="cl-section-empty">No files yet — open the Files tab to add some.</div>
            )}
            {/* Group files by their parent subfolder (knowledge / skills /
                blueprints) so the picker reads as a structured list. The
                checkbox toggles the file into the current chat's context
                (handleToggleFile in ChatPanel). */}
            {departments.map(dept =>
              dept.subfolders.map(sf => {
                if (sf.files.length === 0) return null;
                const sfFileIds = sf.files.map(f => f.id);
                const selectedCount = sfFileIds.filter(id => selectedFileIds.includes(id)).length;
                return (
                  <div key={sf.id} className="cl-file-group">
                    <div className="cl-file-group-head">
                      <span className="cl-file-group-icon" aria-hidden>
                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                        </svg>
                      </span>
                      <span className="cl-file-group-name">{sf.name}</span>
                      <span className="cl-file-group-count">{selectedCount}/{sf.files.length}</span>
                    </div>
                    {sf.files.map(f => {
                      const isSelected = selectedFileIds.includes(f.id);
                      return (
                        <label key={f.id} className="cl-file">
                          <span className={`cl-file-check${isSelected ? ' is-checked' : ''}`}>
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={() => onToggleFile(f.id)}
                            />
                            {isSelected && (
                              <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                                <polyline points="20 6 9 17 4 12" />
                              </svg>
                            )}
                          </span>
                          <span className="cl-file-name">{f.name.replace(/\.md$/, '')}</span>
                        </label>
                      );
                    })}
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}
      </div>
    </aside>
  );
}

// ===== Inline File Editor =====
function InlineEditor({ file, onUpdateContent, onClose }) {
  const [mode, setMode] = useState('view');
  const isEmpty = !file.content || file.content.trim() === '';
  const { draft, isDirty, updateDraft, save, confirmDiscard } = useFileDraft(
    file.id,
    file.content,
    onUpdateContent,
  );

  async function switchMode(next) {
    if (next === 'view' && isDirty) {
      const ok = await confirmDiscard('You have unsaved changes. Discard them?');
      if (!ok) return;
    }
    setMode(next);
  }

  function handleSave() {
    if (save()) setMode('view');
  }

  async function tryClose() {
    const ok = await confirmDiscard('You have unsaved changes. Close without saving?');
    if (!ok) return;
    onClose();
  }

  function handleKeyDown(e) {
    if ((e.metaKey || e.ctrlKey) && e.key === 's') {
      e.preventDefault();
      handleSave();
    }
  }

  return (
    <div className="ctx-editor">
      <div className="ctx-editor-header">
        <span className="ctx-editor-filename">
          {file.name}
          {isDirty && <span style={{ color: 'var(--text-muted)', fontWeight: 400, fontSize: 12, marginLeft: 8 }}>• unsaved</span>}
        </span>
        <div className="file-editor-modes">
          <button
            className={`file-editor-mode${mode === 'view' ? ' active' : ''}`}
            onClick={() => switchMode('view')}
          >View</button>
          <button
            className={`file-editor-mode${mode === 'edit' ? ' active' : ''}`}
            onClick={() => switchMode('edit')}
          >Edit</button>
          {mode === 'edit' && (
            <button
              className="file-editor-save"
              onClick={handleSave}
              disabled={!isDirty}
              style={{ marginLeft: 6 }}
            >Save</button>
          )}
        </div>
        <button className="ctx-editor-close" onClick={tryClose}>{'✕'}</button>
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
          value={draft}
          onChange={e => updateDraft(e.target.value)}
          onKeyDown={handleKeyDown}
          spellCheck={false}
        />
      )}
    </div>
  );
}

// Inline approval actions for review_request DMs in the assignee's chat
// thread. Same wiring as PendingReviewCard below — fires onRemoteApprove,
// which writes to the approvals table and lets the initiator's tab
// resolve the executor via the realtime echo.
function ReviewRequestActions({ run, stepResult, onRemoteApprove }) {
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  async function act(action) {
    if (busy) return;
    setBusy(true);
    try { await onRemoteApprove(run, stepResult, action, comment); }
    finally { setBusy(false); }
  }
  return (
    <>
      <textarea
        className="cl-approval-comment"
        value={comment}
        onChange={e => setComment(e.target.value)}
        placeholder="Feedback (required if rejecting)…"
        rows={2}
      />
      <div className="cl-approval-actions">
        <button
          className="cl-send-btn-approve"
          onClick={() => act('Approve')}
          disabled={busy}
        >
          Approve
        </button>
        <button
          className="cl-send-btn-cancel"
          onClick={() => act('Reject')}
          disabled={busy || !comment.trim()}
          title={comment.trim() ? '' : 'Add feedback before rejecting'}
        >
          Reject with feedback
        </button>
      </div>
    </>
  );
}

// ===== Cross-user review surface =====
// Rendered at the top of the chat body when the current user is the waiting
// assignee on any workflow_run. Gives the reviewer a place to click Approve
// or Reject — the initiator's tab owns the Promise resolver and picks up the
// decision via the `approvals` realtime subscription.
function PendingReviewCard({ run, step, onRemoteApprove }) {
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  async function act(action) {
    if (busy) return;
    setBusy(true);
    try { await onRemoteApprove(run, step, action, comment); }
    finally { setBusy(false); }
  }
  return (
    <div style={{ marginBottom: 8, padding: 10, background: '#fff', border: '1px solid #e5d4a8', borderRadius: 6 }}>
      <div style={{ fontSize: 13, color: '#5a5048', marginBottom: 4 }}>
        Workflow <strong>{run.workflowName}</strong> · Step <strong>{step.stepName || 'Review'}</strong> · Requested by <strong>{run.startedBy || 'someone'}</strong>
      </div>
      <textarea
        value={comment}
        onChange={e => setComment(e.target.value)}
        placeholder="Optional comment (required for Reject)"
        rows={2}
        style={{ width: '100%', marginTop: 6, padding: 6, fontSize: 13, border: '1px solid #ddd', borderRadius: 4, resize: 'vertical', fontFamily: 'inherit' }}
      />
      <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
        <button onClick={() => act('Approve')} disabled={busy} style={{ background: '#3f8f4a', color: '#fff', border: 0, padding: '6px 14px', borderRadius: 4, cursor: busy ? 'wait' : 'pointer' }}>Approve</button>
        <button onClick={() => act('Reject')} disabled={busy || !comment.trim()} style={{ background: '#b8453d', color: '#fff', border: 0, padding: '6px 14px', borderRadius: 4, cursor: (busy || !comment.trim()) ? 'not-allowed' : 'pointer', opacity: (busy || !comment.trim()) ? 0.6 : 1 }}>Reject</button>
      </div>
    </div>
  );
}

function PendingReviewsBanner({ myPendingReviews, onRemoteApprove }) {
  if (!myPendingReviews?.length) return null;
  return (
    <div style={{ padding: '12px 16px', background: '#fff8e6', borderBottom: '1px solid #f0e1b8' }}>
      <div style={{ fontWeight: 600, marginBottom: 8, color: '#7a5a12', fontSize: 13 }}>
        {myPendingReviews.length} review{myPendingReviews.length === 1 ? '' : 's'} waiting for you
      </div>
      {myPendingReviews.map(({ run, step }) => (
        <PendingReviewCard key={`${run.id}-${step.stepId}`} run={run} step={step} onRemoteApprove={onRemoteApprove} />
      ))}
    </div>
  );
}

// Orphaned-run banner: a run this user started left mid-flight (page
// refresh, tab crash, laptop sleep). The in-memory executor is gone and
// nothing will advance the workflow. Let the user cancel cleanly so the
// run state isn't "waiting_approval" forever.
function OrphanedRunsBanner({ myOrphanedRuns, onCancelOrphanedRun }) {
  if (!myOrphanedRuns?.length) return null;
  return (
    <div style={{ padding: '12px 16px', background: '#fce8e5', borderBottom: '1px solid #f0b8ad' }}>
      <div style={{ fontWeight: 600, marginBottom: 8, color: '#8a2e22', fontSize: 13 }}>
        {myOrphanedRuns.length} workflow run{myOrphanedRuns.length === 1 ? '' : 's'} interrupted — the executor was lost (refresh / tab closed). Cancel to clean up.
      </div>
      {myOrphanedRuns.map(run => (
        <div key={run.id} style={{ marginBottom: 6, padding: 8, background: '#fff', border: '1px solid #f0b8ad', borderRadius: 6, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: 13 }}><strong>{run.workflowName}</strong></span>
          <button onClick={() => onCancelOrphanedRun(run.id)} style={{ background: '#b8453d', color: '#fff', border: 0, padding: '4px 10px', borderRadius: 4, cursor: 'pointer', fontSize: 12 }}>Cancel</button>
        </div>
      ))}
    </div>
  );
}

// DM outbox indicator: shows when messages are queued locally waiting
// for network recovery. Silent when empty so we don't clutter the UI.
function OutboxIndicator({ count }) {
  if (!count) return null;
  return (
    <div style={{ padding: '6px 16px', background: '#eef4ff', borderBottom: '1px solid #cfd8e8', fontSize: 12, color: '#4a6b96' }}>
      {count} message{count === 1 ? '' : 's'} pending delivery — will retry automatically.
    </div>
  );
}

// ===== Main ChatPanel =====
export default function ChatPanel({ messages, onSendMessage, onApprovalAction, onPickRecipient, onNudgeRecipient, onGoToFiles, onRetry, isLoading, participants, currentUserName, fileTree, onUpdateFileContent, onEnsureFileContent, coworkers, showEducationalCues, conversations, activeConvoId, onNewChat, onSelectConvo, onDeleteConvo, onCoworkerChange, currentStage, activeDm, latestIncomingDm, onOpenDm, onCloseDm, myParticipantId, sb, unreadDmCounts, workflowRuns, myPendingReviews, onRemoteApprove, myOrphanedRuns, onCancelOrphanedRun, dmOutboxCount }) {
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

  // Load the DM thread when a DM opens. Live updates arrive via the
  // `latestIncomingDm` prop (App.jsx owns the single subscription); a second
  // useEffect below watches that prop and appends.
  // `dmHasMoreEarlier` tracks whether the initial 100-message page
  // completely covered the thread; if not, a "Load earlier" affordance
  // appears at the top so long 6-hour-workshop coworker threads aren't
  // silently truncated.
  const [dmHasMoreEarlier, setDmHasMoreEarlier] = useState(false);
  const [dmLoadingEarlier, setDmLoadingEarlier] = useState(false);
  useEffect(() => {
    if (!activeDm?.id || !myParticipantId) { setDmMessages([]); setDmHasMoreEarlier(false); return; }
    let cancelled = false;
    sb.fetchDmThread(myParticipantId, activeDm.id).then(initial => {
      if (cancelled) return;
      setDmMessages(initial);
      // If the server returned exactly 100, there's likely more behind it.
      setDmHasMoreEarlier(initial.length >= 100);
    });
    return () => { cancelled = true; };
  }, [sb, myParticipantId, activeDm?.id]);

  async function handleLoadEarlierDms() {
    if (!activeDm?.id || !myParticipantId || dmLoadingEarlier || !dmHasMoreEarlier) return;
    const oldest = dmMessages[0];
    if (!oldest?.created_at) return;
    setDmLoadingEarlier(true);
    try {
      const older = await sb.fetchDmThread(myParticipantId, activeDm.id, { beforeCreatedAt: oldest.created_at });
      setDmMessages(prev => {
        const seen = new Set(prev.map(m => m.id));
        const merged = [...older.filter(m => !seen.has(m.id)), ...prev];
        return merged;
      });
      setDmHasMoreEarlier(older.length >= 100);
    } finally {
      setDmLoadingEarlier(false);
    }
  }

  // Realtime DM append: App.jsx fans the latest incoming DM event here via
  // props. We dedupe by id because the sender also appends optimistically
  // after sendDm resolves, and we want both sides' UI to converge without
  // duplicate rows.
  useEffect(() => {
    if (!latestIncomingDm || !activeDm?.id || !myParticipantId) return;
    const dm = latestIncomingDm;
    const belongs = (dm.from_participant_id === activeDm.id && dm.to_participant_id === myParticipantId)
                  || (dm.from_participant_id === myParticipantId && dm.to_participant_id === activeDm.id);
    if (belongs) setDmMessages(prev => {
      if (prev.some(m => m.id === dm.id)) return prev;
      // Cap at 500 messages in memory. AI coworker threads can accumulate
      // hundreds during a 6h workshop; "Load earlier" walks the older ones
      // back in if the user scrolls. Without the cap, render time on each
      // new message scales linearly with thread length.
      const next = [...prev, dm];
      return next.length > 500 ? next.slice(-500) : next;
    });
  }, [latestIncomingDm, activeDm?.id, myParticipantId]);

  async function handleSend() {
    if ((!input.trim() && attachedFiles.length === 0) || isLoading || parsingFiles) return;
    const text = input.trim() || (attachedFiles.length > 0 ? `Analyze the attached file${attachedFiles.length > 1 ? 's' : ''}.` : '');
    if (activeDm) {
      if (!myParticipantId) return;
      // Use submitDm (outbox-backed) instead of sb.sendDm directly: on
      // transient network failure the message gets queued to localStorage
      // and retried on reconnect, rather than silently vanishing.
      const result = await submitDm(sb, myParticipantId, activeDm.id, text);
      if (result?.data) {
        setDmMessages(prev => {
          if (prev.some(m => m.id === result.data.id)) return prev;
          const next = [...prev, result.data];
          return next.length > 500 ? next.slice(-500) : next;
        });
        setInput('');
      } else if (result?.pending) {
        // Queued optimistically. Show it locally with a pending marker so
        // the user knows it will deliver once connectivity returns.
        const optimistic = {
          id: result.clientId,
          from_participant_id: myParticipantId,
          to_participant_id: activeDm.id,
          content: text,
          created_at: new Date().toISOString(),
          _pending: true,
        };
        setDmMessages(prev => {
          if (prev.some(m => m.id === optimistic.id)) return prev;
          const next = [...prev, optimistic];
          return next.length > 500 ? next.slice(-500) : next;
        });
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
    if (fileId && fileId !== editingFileId) onEnsureFileContent?.(fileId);
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
        <input type="file" ref={fileInputRef} style={{ display: 'none' }} multiple onChange={handleFileSelect} />
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
                                <button className="cl-context-file-chip-remove" onClick={() => handleToggleSubfolder(chip.fileIds)}>{'✕'}</button>
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
                              <button className="cl-context-file-chip-remove" onClick={() => handleToggleFile(chip.id)}>{'✕'}</button>
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
                <button className="cl-attached-chip-remove" onClick={() => removeAttachment(i)}>{'✕'}</button>
              </span>
            ))}
          </div>
        )}
        <div className="cl-composer">
          {!activeDm && (
            <button
              className="cl-composer-attach"
              onClick={() => fileInputRef.current?.click()}
              disabled={isLoading || parsingFiles}
              aria-label="Attach"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
              </svg>
            </button>
          )}
          <textarea
            className="cl-composer-input"
            placeholder={placeholder}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
            disabled={isLoading || parsingFiles}
            rows={1}
          />
          <button
            className="cl-composer-send"
            onClick={handleSend}
            disabled={(!input.trim() && attachedFiles.length === 0) || isLoading || parsingFiles}
            aria-label="Send"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="5" y1="12" x2="19" y2="12" />
              <polyline points="12 5 19 12 12 19" />
            </svg>
          </button>
        </div>
      </div>
    );
  }
  const activeContextCount = selectedFileIds.length;
  const editingFile = editingFileId ? findNode(fileTree, editingFileId) : null;

  return (
    <div className="cl-app">
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
        workflowRuns={workflowRuns}
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
      <div className="cl-main cl-chat-main">
        {(activeDm || activeCoworker) && (
          <div className="cl-thread-banner">
            {activeDm ? (
              <>
                <span className="cl-thread-banner-avatar" style={{ background: activeDm.color || '#888', color: '#fff' }}>
                  {activeDm.name?.charAt(0)?.toUpperCase() || '?'}
                </span>
                <div className="cl-thread-banner-text">Talking to <em>{activeDm.name}</em></div>
                <button className="cl-thread-banner-close" onClick={onCloseDm} aria-label="Close DM">{'✕'}</button>
              </>
            ) : (
              <>
                <span className="cl-thread-banner-avatar" style={{ background: activeCoworker.color || '#4a7fb5' }}>
                  <CoworkerGlyph avatar={activeCoworker.avatar} size={16} color="#ffffff" />
                </span>
                <div className="cl-thread-banner-text">Talking to <em>{activeCoworker.name}</em></div>
                <button className="cl-thread-banner-close" onClick={() => { if (onNewChat) onNewChat(); }} aria-label="Close chat">{'✕'}</button>
              </>
            )}
          </div>
        )}

        {/* Files-in-context strip — visible across the top of the thread
            so the participant always sees what's attached to the current
            chat. Sidebar checkboxes write into selectedFileIds; this strip
            reads from it. Hidden in DM mode (DMs don't carry file context). */}
        {!activeDm && activeContextCount > 0 && (
          <div className="cl-context-strip">
            <span className="cl-context-strip-label">Files in context</span>
            {selectedFileIds.map(id => {
              const node = findNode(fileTree, id);
              if (!node) return null;
              const isSkill = skillFileIds.includes(id);
              const showRole = stageReached(currentStage, '4');
              return (
                <span key={id} className={`cl-context-chip${isSkill ? ' is-skill' : ''}`}>
                  {showRole && (
                    <span className="cl-context-chip-role" title={isSkill ? 'Skill file (from skills folder)' : 'Knowledge file (from knowledge folder)'}>
                      {isSkill ? 'skill' : 'knowledge'}
                    </span>
                  )}
                  <span className="cl-context-chip-name">{node.name.replace(/\.md$/, '')}</span>
                  <button
                    type="button"
                    className="cl-context-chip-remove"
                    onClick={() => handleToggleFile(id)}
                    aria-label={`Remove ${node.name} from context`}
                  >{'✕'}</button>
                </span>
              );
            })}
          </div>
        )}

        {activeDm ? (
          <>
            <div className="dm-messages" ref={messagesRef}>
              <div className="dm-messages-inner">
                {dmHasMoreEarlier && (
                  <div style={{ textAlign: 'center', padding: '8px 0' }}>
                    <button
                      onClick={handleLoadEarlierDms}
                      disabled={dmLoadingEarlier}
                      style={{ background: 'transparent', border: '1px solid #ddd', borderRadius: 4, padding: '4px 12px', fontSize: 12, color: '#666', cursor: dmLoadingEarlier ? 'wait' : 'pointer' }}
                    >
                      {dmLoadingEarlier ? 'Loading…' : 'Load earlier messages'}
                    </button>
                  </div>
                )}
                {dmMessages.length === 0 ? (
                  <div className="dm-empty">No messages yet. Send the first one.</div>
                ) : (
                  dmMessages.map(m => {
                    const isMine = m.from_participant_id === myParticipantId;
                    const senderName = isMine ? (currentUserName || 'Me') : activeDm.name;
                    const senderColor = isMine ? '#4a7fb5' : (activeDm.color || '#888');

                    // Inline approval card for review_request DMs addressed
                    // to me. Three guards:
                    //   - metadata present (skip malformed rows)
                    //   - !isMine (I didn't send this myself)
                    //   - to_participant_id matches my id (the DM is *to* me)
                    // The third guard is belt-and-suspenders against id
                    // drift: if my local myParticipantId is a synthetic
                    // 'p-…' fallback while the DB row has the real uuid,
                    // !isMine alone could fail open. Requiring the explicit
                    // to-me match closes that.
                    const addressedToMe = m.kind === 'review_request'
                      && !isMine
                      && m.metadata
                      && m.to_participant_id === myParticipantId;
                    if (addressedToMe) {
                      const runId = m.metadata.runId;
                      const run = (workflowRuns || []).find(r => r.id === runId);
                      const stepResult = run?.stepResults?.find(s => s.stepId === m.metadata.stepId);
                      const stillPending = run?.status === 'waiting_approval' && stepResult?.status === 'waiting';
                      // Resolved review_request DMs collapse to a single
                      // line so a thread with many past runs isn't a wall
                      // of stale "No longer pending" cards.
                      if (!stillPending) {
                        const verb = run?.status === 'rejected' ? 'rejected'
                          : run?.status === 'completed' ? 'resolved'
                          : run?.status === 'cancelled' ? 'cancelled'
                          : 'no longer pending';
                        return (
                          <div key={m.id} className="cl-dm-flat" style={{ opacity: 0.55 }}>
                            <div className="cl-dm-flat-header">
                              <span className="cl-dm-flat-avatar" style={{ background: senderColor }}>
                                {senderName?.charAt(0)?.toUpperCase()}
                              </span>
                              <span className="cl-dm-flat-name">{senderName?.toUpperCase()}</span>
                            </div>
                            <div className="cl-dm-flat-body" style={{ fontStyle: 'italic', fontSize: 12 }}>
                              Review request for {m.metadata.workflowName || 'workflow'} · step "{m.metadata.stepName}" — {verb}
                            </div>
                            <div className="cl-dm-flat-time">{new Date(m.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
                          </div>
                        );
                      }
                      return (
                        <div key={m.id} className={`cl-dm-flat`}>
                          <div className="cl-dm-flat-header">
                            <span className="cl-dm-flat-avatar" style={{ background: senderColor }}>
                              {senderName?.charAt(0)?.toUpperCase()}
                            </span>
                            <span className="cl-dm-flat-name">{senderName?.toUpperCase()}</span>
                          </div>
                          <div className="cl-bubble cl-bubble-approval" style={{ marginTop: 4 }}>
                            <div className="cl-bubble-label approval">Review request</div>
                            <div className="cl-approval-prompt">
                              <strong>{m.metadata.workflowName || 'Workflow'}</strong> · step "{m.metadata.stepName}"
                            </div>
                            {m.metadata.prompt && (
                              <div className="cl-approval-prompt" style={{ marginTop: 6 }}>{m.metadata.prompt}</div>
                            )}
                            {m.metadata.previousOutput && (
                              <div className="cl-approval-context-wrap">
                                <div className="cl-approval-context-label">Upstream output</div>
                                <div className="cl-approval-context md-doc">
                                  <RichText content={String(m.metadata.previousOutput)} />
                                </div>
                              </div>
                            )}
                            <ReviewRequestActions
                              run={run}
                              stepResult={stepResult}
                              onRemoteApprove={onRemoteApprove}
                            />
                          </div>
                          <div className="cl-dm-flat-time">{new Date(m.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
                        </div>
                      );
                    }
                    // Sender's view of a review_request DM — collapse to a
                    // single one-liner so the same content doesn't fill
                    // the thread on both sides.
                    if (m.kind === 'review_request' && isMine) {
                      return (
                        <div key={m.id} className="cl-dm-flat mine" style={{ opacity: 0.6 }}>
                          <div className="cl-dm-flat-header">
                            <span className="cl-dm-flat-avatar" style={{ background: senderColor }}>
                              {senderName?.charAt(0)?.toUpperCase()}
                            </span>
                            <span className="cl-dm-flat-name">{senderName?.toUpperCase()}</span>
                          </div>
                          <div className="cl-dm-flat-body" style={{ fontStyle: 'italic', fontSize: 12 }}>
                            Sent review request · {m.metadata?.stepName || 'step'} ({m.metadata?.workflowName || 'workflow'})
                          </div>
                          <div className="cl-dm-flat-time">{new Date(m.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
                        </div>
                      );
                    }

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
            <OutboxIndicator count={dmOutboxCount} />
            <OrphanedRunsBanner myOrphanedRuns={myOrphanedRuns} onCancelOrphanedRun={onCancelOrphanedRun} />
            <PendingReviewsBanner myPendingReviews={myPendingReviews} onRemoteApprove={onRemoteApprove} />
            <div className="cl-welcome">
              <h2 className="cl-welcome-greeting">{greeting}</h2>
            </div>
            {renderInputArea()}
          </div>
        ) : (
          <>
            <OutboxIndicator count={dmOutboxCount} />
            <OrphanedRunsBanner myOrphanedRuns={myOrphanedRuns} onCancelOrphanedRun={onCancelOrphanedRun} />
            <PendingReviewsBanner myPendingReviews={myPendingReviews} onRemoteApprove={onRemoteApprove} />
            <div className="cl-messages" ref={messagesRef}>
              <div className="cl-messages-inner">
                {messages.filter(m => {
                  // Hide platform-tool executions before Stage 5 (tools aren't revealed yet).
                  if (m.type === 'tool_execution' && !stageReached(currentStage, '5')) return false;
                  // Hide orchestration / approval messages before Stage 7 (Orchestration).
                  if ((m.type === 'approval' || m.type === 'workflow_start' || m.type === 'workflow_end') && !stageReached(currentStage, '6')) return false;
                  // Drop the legacy "runtime isn't active" error bubbles left
                  // in history by earlier Approve clicks on orphaned runs —
                  // the approval card now shows this state inline instead.
                  if (m.type === 'error' && typeof m.content === 'string'
                      && m.content.includes("run's runtime isn't active")) return false;
                  // Drop the legacy jargon "Workflow finally rejected (...)"
                  // status line — superseded by the final_rejected card type.
                  if (m.type === 'status' && typeof m.content === 'string'
                      && m.content.startsWith('Workflow finally rejected')) return false;
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
