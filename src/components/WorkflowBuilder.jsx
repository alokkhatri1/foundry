import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import ReactFlow, { Background, Controls, MiniMap, Handle, Position, applyNodeChanges, applyEdgeChanges, addEdge, BaseEdge, EdgeLabelRenderer, getBezierPath } from 'reactflow';
import 'reactflow/dist/style.css';
import EducationalCue from './EducationalCue';
import { CoworkerGlyph } from './Icon';
import RichText from './RichText';
import { AvatarDisplay, AvatarPicker, DescriptionSection, FilePicker } from './CoworkerBuilder';
import { runCopilotTurn } from '../utils/workflowCopilot';
import { useConfirm } from './ConfirmDialog';

// Resolve a step's coworker data. New-style steps embed the full coworker
// config at step.coworker (self-contained, decoupled from the shared pool).
// Old-style steps stored only step.coworkerId pointing at the shared pool —
// fall back to looking it up until the user edits the step, at which point
// the editor writes step.coworker and this branch stops mattering.
function resolveStepCoworker(step, coworkers) {
  if (step?.coworker) return step.coworker;
  if (step?.coworkerId) return (coworkers || []).find(c => c.id === step.coworkerId) || null;
  return null;
}

function emptyCoworker() {
  return {
    name: '',
    role: '',
    avatar: 'icon:user',
    color: '#4a7fb5',
    instructionFileIds: [],
    knowledgeFileIds: [],
    toolIds: [],
    toolConfigs: {},
  };
}

let stepCounter = Date.now();
function genStepId() { return 'step-' + (stepCounter++); }

let wfCounter = Date.now();
function genWfId() { return 'wf-' + (wfCounter++); }

function getAllFolders(tree, path = []) {
  const folders = [];
  if (tree.type === 'folder') {
    folders.push({ id: tree.id, name: tree.name, path: [...path, tree.name].join(' / ') });
    if (tree.children) {
      tree.children.forEach(c => folders.push(...getAllFolders(c, [...path, tree.name])));
    }
  }
  return folders;
}

// ===== React Flow node wrappers =====
// Each step renders inside a React Flow node as a StepCard. The node's
// position comes from workflow.nodes[i].position; the step's config lives in
// data.stepCardProps. The drag-handle and drop-zone behavior inside StepCard
// is suppressed when onCanvas is true — position drag happens via React Flow.
// Small X button rendered at the top-right of each deletable node. Stays
// hidden until the user hovers the node, then fades in red. Calls the same
// onDelete the step card's header uses so confirmation + removal stay in
// sync. Not rendered for the Trigger — it's pre-seeded and removing it
// would break the whole run contract.
function NodeDeleteButton({ onDelete }) {
  if (!onDelete) return null;
  return (
    <button
      className="wf-node-delete-btn"
      onClick={(e) => { e.stopPropagation(); onDelete(); }}
      title="Delete step"
    >{'\u2715'}</button>
  );
}

function CoworkerStepNode({ data }) {
  return (
    <div className="wf-canvas-node" style={{ width: 420 }}>
      <Handle type="target" position={Position.Top} id="in" className="wf-handle wf-handle-in" />
      <NodeDeleteButton onDelete={data.stepCardProps?.onDelete} />
      <StepCard {...data.stepCardProps} onCanvas />
      <Handle type="source" position={Position.Bottom} id="out" className="wf-handle wf-handle-out" />
    </div>
  );
}

// Review node — two typed outputs: approved (green) and rejected (red).
// Phase 6 wires the rejected path through the runtime; for now this node
// just exposes the handles so the user can draw both paths on the canvas.
function ReviewStepNode({ data }) {
  return (
    <div className="wf-canvas-node wf-review-node" style={{ width: 420 }}>
      <Handle type="target" position={Position.Top} id="in" className="wf-handle wf-handle-in" />
      <NodeDeleteButton onDelete={data.stepCardProps?.onDelete} />
      <StepCard {...data.stepCardProps} onCanvas />
      <div className="wf-review-outputs">
        <span className="wf-review-output-label approved">Approved</span>
        <span className="wf-review-output-label rejected">Rejected</span>
      </div>
      <Handle
        type="source"
        position={Position.Bottom}
        id="approved"
        className="wf-handle wf-handle-out wf-handle-approved"
        style={{ left: '30%' }}
      />
      <Handle
        type="source"
        position={Position.Bottom}
        id="rejected"
        className="wf-handle wf-handle-out wf-handle-rejected"
        style={{ left: '70%' }}
      />
    </div>
  );
}

// Trigger node — the canonical entry point. No input handle (nothing upstream),
// one output wire carrying the case input into the first real step. Not
// deletable — the runtime requires a trigger on every workflow.
function TriggerNode({ data }) {
  return (
    <div className="wf-canvas-node wf-trigger-node" style={{ width: 420 }}>
      <StepCard {...data.stepCardProps} onCanvas />
      <Handle type="source" position={Position.Bottom} id="out" className="wf-handle wf-handle-out" />
    </div>
  );
}

// Capture node — a terminal step that writes the upstream output into a
// workspace file and (optionally) wires that file into a coworker's
// knowledge. Meant to be the final step: the loop that lets the system
// get smarter with every run. No output handle — runs stop here.
function CaptureStepNode({ data }) {
  return (
    <div className="wf-canvas-node wf-capture-node" style={{ width: 420 }}>
      <Handle type="target" position={Position.Top} id="in" className="wf-handle wf-handle-in" />
      <NodeDeleteButton onDelete={data.stepCardProps?.onDelete} />
      <StepCard {...data.stepCardProps} onCanvas />
    </div>
  );
}

const nodeTypes = { agent: CoworkerStepNode, approval: ReviewStepNode, trigger: TriggerNode, capture: CaptureStepNode };

// Cycle prevention: before adding a new edge A→B, walk forward from B via
// the existing edges and reject if we can reach A. Rejected-path edges are
// allowed to close cycles — that's how revision loops get expressed (Phase 6:
// "reject bounces back to this coworker"). So the forward walk only follows
// approved/default edges when looking for a cycle closure.
function wouldCreateCycle(edges, sourceId, targetId, sourceHandle) {
  if (sourceId === targetId) return true;
  if (sourceHandle === 'rejected') return false;
  const adj = new Map();
  for (const e of edges) {
    if ((e.sourceHandle || '') === 'rejected') continue;
    if (!adj.has(e.source)) adj.set(e.source, []);
    adj.get(e.source).push(e.target);
  }
  const seen = new Set();
  const stack = [targetId];
  while (stack.length) {
    const node = stack.pop();
    if (node === sourceId) return true;
    if (seen.has(node)) continue;
    seen.add(node);
    for (const next of (adj.get(node) || [])) stack.push(next);
  }
  return false;
}

// Edge styling hook — approved/default edges stay gold, rejected edges are
// red. Keeps the visual language consistent with the handle colors so users
// can trace a rejection path at a glance.
function styleEdge(e) {
  const isRejected = (e.sourceHandle || '') === 'rejected';
  return {
    ...e,
    type: 'deletable',
    style: {
      stroke: isRejected ? '#c45c5c' : '#c8956c',
      strokeWidth: 2,
    },
  };
}

// Custom edge with a hover-revealed X button so users can delete connections
// without having to discover the React Flow "select + Backspace" keyboard
// shortcut. The button rides at the midpoint of the bezier curve.
function DeletableEdge({ id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, style, markerEnd, data }) {
  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition,
  });
  return (
    <>
      <BaseEdge id={id} path={edgePath} style={style} markerEnd={markerEnd} />
      <EdgeLabelRenderer>
        <button
          className="wf-edge-delete-btn"
          style={{
            position: 'absolute',
            transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
            pointerEvents: 'all',
          }}
          onClick={(e) => {
            e.stopPropagation();
            if (data?.onDelete) data.onDelete(id);
          }}
          title="Delete connection"
        >{'\u2715'}</button>
      </EdgeLabelRenderer>
    </>
  );
}

const wfEdgeTypes = { deletable: DeletableEdge };

// ===== Step Card =====
function StepCard({ step, index, coworkers, tools, participants, onUpdate, onDelete, expanded, onToggleExpand, validationErrors, allSteps, currentStepId, stepResult, isDragging, dragOverPos, onDragStart, onDragOver, onDragEnd, onDrop, showEducationalCues, onCanvas, fileTree, callClaudeAPI, onUpdateFileContent, readOnly }) {
  const isRunning = currentStepId === step.id;
  const assignedCw = step.type === 'agent' ? resolveStepCoworker(step, coworkers) : null;
  const assignedPerson = step.assigneeId ? participants?.find(p => p.id === step.assigneeId) : null;
  const [showAvatarPicker, setShowAvatarPicker] = useState(false);

  // Ensure the agent step has an embedded coworker object before edits fire.
  // Old-style steps that only have coworkerId seed their embedded coworker
  // from the shared pool on first interaction, so later edits stay local
  // (the "decoupled after touch" contract).
  function updateCoworker(updater) {
    const current = step.coworker || (assignedCw
      ? { name: assignedCw.name, role: assignedCw.role, avatar: assignedCw.avatar, color: assignedCw.color,
          instructionFileIds: assignedCw.instructionFileIds || [], knowledgeFileIds: assignedCw.knowledgeFileIds || [],
          toolIds: assignedCw.toolIds || [], toolConfigs: assignedCw.toolConfigs || {} }
      : emptyCoworker());
    const next = typeof updater === 'function' ? updater(current) : { ...current, ...updater };
    // Drop the legacy coworkerId reference once we own a local copy.
    const { coworkerId: _drop, ...rest } = step;
    onUpdate({ ...rest, coworker: next });
  }

  // Live run state derived from the run's stepResults entry.
  const runStatus = stepResult?.status || 'pending';
  const isWaiting = runStatus === 'waiting';
  const isCompleted = runStatus === 'completed';
  const isRejected = runStatus === 'rejected' || runStatus === 'error';
  const isSkipped = runStatus === 'skipped';
  const cardStateClass = isWaiting ? ' waiting'
    : isCompleted ? ' completed'
    : isRejected ? ' rejected'
    : isSkipped ? ' skipped'
    : isRunning ? ' running'
    : '';

  // What to show on the collapsed card
  const assignee = step.type === 'agent' && assignedCw
    ? { icon: <CoworkerGlyph avatar={assignedCw.avatar} size={12} color="#ffffff" />, name: assignedCw.name, color: assignedCw.color }
    : step.type === 'approval' && assignedPerson
      ? { icon: assignedPerson.name.charAt(0).toUpperCase(), name: assignedPerson.name, color: assignedPerson.color }
      : null;

  // Condensed output summary shown under a completed step (collapsed view).
  const outputPreview = stepResult?.output
    ? String(stepResult.output).replace(/\s+/g, ' ').slice(0, 140) + (String(stepResult.output).length > 140 ? '\u2026' : '')
    : null;

  // Warn when a Capture step has no target file picked — it will soft-land
  // at runtime (no-op with a status message) so the run still finishes, but
  // the user probably didn't mean that. Shown on the collapsed card so it's
  // visible without having to expand.
  const captureNotConfigured = step.type === 'capture' && !step.targetFileId && !stepResult;

  const statusBadge = isRunning || runStatus === 'running' ? <span className="step-status-badge running"><span className="step-status-spinner" /> Running</span>
    : isWaiting ? <span className="step-status-badge waiting">Waiting on {assignedPerson?.name || 'a reviewer'}</span>
    : isCompleted ? <span className="step-status-badge done">{'\u2713'} Done</span>
    : isRejected ? <span className="step-status-badge rejected">Rejected</span>
    : isSkipped ? <span className="step-status-badge skipped">Skipped</span>
    : captureNotConfigured ? <span className="step-status-badge unconfigured">Not configured</span>
    : null;

  return (
    <div
      className={`step-drag-wrapper${isDragging ? ' dragging' : ''}${dragOverPos === 'above' ? ' drag-over-above' : ''}${dragOverPos === 'below' ? ' drag-over-below' : ''}`}
      draggable={!stepResult && !onCanvas}
      onDragStart={e => !stepResult && !onCanvas && onDragStart(e, index)}
      onDragOver={e => !stepResult && !onCanvas && onDragOver(e, index)}
      onDragEnd={onDragEnd}
      onDrop={e => !stepResult && !onCanvas && onDrop(e, index)}
    >
      <div className={`workflow-step-card ${step.type}${cardStateClass}${expanded ? ' expanded' : ''}${onCanvas ? ' on-canvas' : ''}`}>
        <div className="step-card-header" onClick={onToggleExpand}>
          {!onCanvas && step.type !== 'trigger' && <span className="step-drag-handle" title="Drag to reorder">{'\u2630'}</span>}
          <span className={`step-number ${step.type}${isCompleted ? ' done' : ''}`}>
            {isCompleted
              ? '\u2713'
              : step.type === 'trigger'
                ? '\u25B6'
                : ((allSteps || []).filter(s => s.type !== 'trigger').findIndex(s => s.id === step.id) + 1)}
          </span>
          <span className={`step-type-label ${step.type}`}>
            {step.type === 'agent' ? 'Coworker'
              : step.type === 'approval' ? 'Review'
              : step.type === 'capture' ? 'Capture'
              : 'Trigger'}
          </span>
          {assignee && (
            <span className="step-assignee-badge" style={{ background: assignee.color || '#ccc' }}>
              {assignee.icon}
            </span>
          )}
          <span className="step-name">
            {step.type === 'agent'
              ? (assignedCw?.name?.trim() || 'New Coworker')
              : step.type === 'approval'
                ? (assignedPerson?.name || 'Review')
                : step.type === 'capture'
                  ? (step.name || 'Capture Learning')
                  : step.name}
          </span>
          {statusBadge}
          <span className="step-actions">
            {!onCanvas && !stepResult && step.type !== 'trigger' && (
              <button className="step-action-btn step-delete-btn" onClick={e => { e.stopPropagation(); onDelete(); }} title="Delete">{'\u2715'}</button>
            )}
            <span className={`step-chevron${expanded ? ' open' : ''}`}>{'\u25BE'}</span>
          </span>
        </div>
        {!expanded && outputPreview && (
          <div className="step-output-preview" onClick={onToggleExpand}>{outputPreview}</div>
        )}
        {!expanded && isRejected && stepResult?.output && (
          <div className="step-output-preview rejected" onClick={onToggleExpand}>
            Rejected: {String(stepResult.output).slice(0, 160)}
          </div>
        )}
        {expanded && stepResult?.output && (
          <div className="step-card-body">
            <div className="step-output-label">Output</div>
            <div className="step-output-body md-doc"><RichText content={String(stepResult.output)} /></div>
            {stepResult.completedAt && (
              <div className="step-output-time">{new Date(stepResult.completedAt).toLocaleTimeString()}</div>
            )}
          </div>
        )}
        {expanded && !stepResult?.output && (
          <fieldset className="step-card-body step-card-fieldset" disabled={readOnly}>

            {step.type === 'trigger' && (
              <>
                <div className="step-config-row">
                  <label>Instructions</label>
                  <textarea
                    value={step.caseInput || ''}
                    onChange={e => onUpdate({ ...step, caseInput: e.target.value })}
                    placeholder="What should the first coworker do with the documents? e.g., 'Review the contract and flag any non-standard clauses.'"
                    rows={4}
                  />
                </div>
                <div className="step-config-row">
                  <label>Documents</label>
                  <FilePicker
                    fileTree={fileTree}
                    selectedIds={step.fileIds || []}
                    onChange={ids => onUpdate({ ...step, fileIds: ids })}
                    onUpdateContent={onUpdateFileContent}
                  />
                </div>
                <div className="step-config-hint">
                  Both flow into the first coworker step when you press Run.
                </div>
              </>
            )}

            {step.type === 'agent' && (() => {
              // Inline coworker editor — same pattern as the Coworkers tab.
              // Embedded on the step so the node is self-contained; saving
              // to the library (button below) pushes a decoupled copy to
              // the shared pool.
              const cw = step.coworker || assignedCw || emptyCoworker();
              return (
                <>
                  <EducationalCue cueId="step-type-agent" show={showEducationalCues} />
                  <div className="cwb-section cwb-section-identity">
                    <div className="cwb-identity">
                      <div
                        className="cwb-identity-avatar-btn"
                        style={{ background: cw.color || '#4a7fb5' }}
                        onClick={() => setShowAvatarPicker(!showAvatarPicker)}
                      >
                        <AvatarDisplay avatar={cw.avatar} color={cw.color} size={44} />
                      </div>
                      <div className="cwb-identity-fields">
                        <input
                          className="cwb-name-input"
                          type="text"
                          value={cw.name || ''}
                          onChange={e => updateCoworker({ name: e.target.value })}
                          placeholder="Coworker name"
                        />
                      </div>
                    </div>
                    {showAvatarPicker && (
                      <AvatarPicker
                        avatar={cw.avatar}
                        color={cw.color}
                        onChangeAvatar={avatar => updateCoworker({ avatar })}
                        onChangeColor={color => updateCoworker({ color })}
                      />
                    )}
                  </div>

                  <DescriptionSection
                    role={cw.role || ''}
                    onChangeRole={role => updateCoworker({ role })}
                    callClaudeAPI={callClaudeAPI}
                  />

                  <div className="cwb-section">
                    <h3 className="cwb-section-title">Skills</h3>
                    <p className="cwb-section-desc">How this coworker behaves — its process and output format.</p>
                    <FilePicker
                      fileTree={fileTree}
                      selectedIds={cw.instructionFileIds || []}
                      onChange={ids => updateCoworker({ instructionFileIds: ids })}
                      folderName="skills"
                      onUpdateContent={onUpdateFileContent}
                    />
                  </div>

                  <div className="cwb-section">
                    <h3 className="cwb-section-title">Knowledge</h3>
                    <p className="cwb-section-desc">Reference material — policies, rules, criteria.</p>
                    <FilePicker
                      fileTree={fileTree}
                      selectedIds={cw.knowledgeFileIds || []}
                      onChange={ids => updateCoworker({ knowledgeFileIds: ids })}
                      folderName="knowledge"
                      onUpdateContent={onUpdateFileContent}
                    />
                  </div>

                  {validationErrors?.noAgent && <div className="validation-error">Name the coworker before running</div>}
                </>
              );
            })()}

            {step.type === 'capture' && (() => {
              const mode = step.mode || 'knowledge';
              return (
                <>
                  <div className="step-config-row">
                    <label>What kind of learning?</label>
                    <div className="capture-mode-toggle">
                      <button
                        type="button"
                        className={`capture-mode-btn${mode === 'knowledge' ? ' active' : ''}`}
                        onClick={() => onUpdate({ ...step, mode: 'knowledge', targetFileId: mode === 'knowledge' ? step.targetFileId : '' })}
                      >
                        <span className="capture-mode-title">Append to knowledge</span>
                        <span className="capture-mode-desc">Each run adds a precedent to the file.</span>
                      </button>
                      <button
                        type="button"
                        className={`capture-mode-btn${mode === 'skills' ? ' active' : ''}`}
                        onClick={() => onUpdate({ ...step, mode: 'skills', targetFileId: mode === 'skills' ? step.targetFileId : '' })}
                      >
                        <span className="capture-mode-title">Refine skills</span>
                        <span className="capture-mode-desc">AI edits the instructions based on this run.</span>
                      </button>
                    </div>
                  </div>
                  <div className="step-config-row">
                    <label>{mode === 'skills' ? 'Instructions file to refine' : 'Append output to file'}</label>
                    <FilePicker
                      fileTree={fileTree}
                      selectedIds={step.targetFileId ? [step.targetFileId] : []}
                      onChange={ids => onUpdate({ ...step, targetFileId: ids[ids.length - 1] || '' })}
                      onUpdateContent={onUpdateFileContent}
                      folderName={mode === 'skills' ? 'skills' : 'knowledge'}
                    />
                  </div>
                  <div className="step-config-hint">
                    {mode === 'skills'
                      ? 'An AI reads the current instructions and the latest run, proposes a minimal edit, and overwrites the file. Point it at a coworker\u2019s instructions file to sharpen how they work. Leave the file blank and the run completes without refining.'
                      : 'The upstream output is appended to the file with a timestamp. Pick a file in the knowledge folder of a coworker to grow what they know run-over-run. Leaving the file blank is fine \u2014 the run completes, nothing captured.'}
                  </div>
                </>
              );
            })()}

            {step.type === 'approval' && (
              <>
                <EducationalCue cueId="workflow-approval-step" show={showEducationalCues} />
                <div className="step-config-row">
                  <label>Assign Reviewer</label>
                  <select value={step.assigneeId || ''} onChange={e => onUpdate({ ...step, assigneeId: e.target.value })}>
                    <option value="">Anyone can review</option>
                    {(participants || []).map(p => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </select>
                </div>
                {assignedPerson && (
                  <div className="step-agent-info">
                    <span className="step-agent-info-avatar" style={{ background: assignedPerson.color }}>{assignedPerson.name.charAt(0).toUpperCase()}</span>
                    <div>
                      <div className="step-agent-info-name">{assignedPerson.name}</div>
                      <div className="step-agent-info-role">Reviewer</div>
                    </div>
                  </div>
                )}
                <div className="step-config-row">
                  <label>Review prompt</label>
                  <textarea value={step.prompt || ''} onChange={e => onUpdate({ ...step, prompt: e.target.value })} placeholder="What should the reviewer check?" />
                </div>
                <div className="step-config-hint">
                  On reject the run bounces back to the previous review step for revision (or final-rejects if there's no prior human review).
                </div>
              </>
            )}

            {/* Save output toggle — off by default. When on, the step's output
                (for coworker: what the coworker produced; for review: the
                upstream draft at the moment of approval) is saved to the
                configured folder on run completion. Not applicable to the
                trigger (it has no output of its own). */}
            {step.type !== 'trigger' && step.type !== 'capture' && (
            <div className="step-save-block">
              <label className="step-save-toggle">
                <input
                  type="checkbox"
                  checked={!!step.save?.enabled}
                  onChange={e => onUpdate({
                    ...step,
                    save: { ...(step.save || {}), enabled: e.target.checked },
                  })}
                />
                <span>Save this step's output to the workspace</span>
              </label>
              {step.save?.enabled && (
                <div className="step-save-fields">
                  <select
                    className="wf-destination-select"
                    value={step.save?.folderId || ''}
                    onChange={e => onUpdate({
                      ...step,
                      save: { ...(step.save || {}), folderId: e.target.value },
                    })}
                  >
                    <option value="">First available folder</option>
                    {(fileTree?.children || []).filter(c => c.type === 'folder').map(f => (
                      <option key={f.id} value={f.id}>{f.name}</option>
                    ))}
                  </select>
                  <div className="wf-destination-subfolder">
                    {['knowledge', 'skills'].map(sub => {
                      const active = (step.save?.subfolder || 'knowledge') === sub;
                      return (
                        <button
                          key={sub}
                          type="button"
                          className={`wf-destination-sub-pill${active ? ' active' : ''}`}
                          onClick={() => onUpdate({
                            ...step,
                            save: { ...(step.save || {}), subfolder: sub },
                          })}
                        >
                          {sub}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
            )}

          </fieldset>
        )}
      </div>
    </div>
  );
}

// ===== Workflow Canvas =====
// Renders the workflow as a React Flow graph. In phase 2 this is just
// visual — nodes are draggable and their positions persist, edges are
// drawn read-only from the linear auto-migration. Wiring, typed handles,
// and DAG runtime arrive in later phases.
function WorkflowCanvas({ workflow, onUpdateWorkflow, readOnly, fileTree, coworkers, tools, participants, activeRun, currentStepId, expandedStep, setExpandedStep, updateStep, deleteStep, validationErrors, showEducationalCues, callClaudeAPI, onSaveCoworkerToLibrary, onUpdateFileContent, apiKey, onCopilotUsage, copilotState, onCopilotPatch, copilotHistoriesRef, copilotWfId }) {
  const [nodes, setNodes] = useState([]);
  const [edges, setEdges] = useState([]);
  // Copilot state lives in the parent (WorkflowBuilder) so the transcript
  // survives closing the panel and navigating back to the workflow list.
  // If `open` is null, fall back to the auto-open heuristic: open when the
  // workflow has no real steps yet — the panel acts as the empty state.
  const copilotMessages = copilotState?.messages || [];
  const copilotInput = copilotState?.input || '';
  const copilotBusy = !!copilotState?.busy;
  const copilotOpen = copilotState?.open == null
    ? (workflow?.steps || []).filter(s => s.type !== 'trigger').length === 0
    : !!copilotState.open;
  const setCopilotOpen = useCallback((val) => {
    const next = typeof val === 'function' ? val(copilotOpen) : val;
    onCopilotPatch({ open: next });
  }, [onCopilotPatch, copilotOpen]);
  const setCopilotInput = useCallback((val) => onCopilotPatch({ input: val }), [onCopilotPatch]);
  const setCopilotMessages = useCallback((val) => {
    onCopilotPatch(prev => ({ messages: typeof val === 'function' ? val(prev.messages) : val }));
  }, [onCopilotPatch]);
  const setCopilotBusy = useCallback((val) => onCopilotPatch({ busy: val }), [onCopilotPatch]);
  const copilotScrollRef = useRef(null);

  const handleDeleteEdge = useCallback((edgeId) => {
    const nextEdges = (workflow.edges || []).filter(e => e.id !== edgeId);
    onUpdateWorkflow({ ...workflow, edges: nextEdges });
  }, [workflow, onUpdateWorkflow]);

  // Derive canvas nodes from workflow.steps preserving any stored positions.
  const { derivedNodes, derivedEdges } = useMemo(() => {
    const positions = new Map((workflow.nodes || []).map(n => [n.id, n.position]));
    const steps = workflow.steps || [];
    const nextNodes = steps.map((step, i) => {
      const isExpanded = expandedStep === i;
      return {
        id: step.id,
        type: step.type,
        position: positions.get(step.id) || { x: 80, y: i * 240 },
        // Lock dragging while the node is open for editing — prevents a click
        // into an input field from being interpreted as a drag and shifting
        // the node around the canvas. Collapsing re-enables drag. Also
        // locked whenever readOnly so shared workflows can't be rearranged.
        draggable: !isExpanded && !readOnly,
        data: {
          stepCardProps: {
            step, index: i, coworkers, tools, participants, fileTree,
            onUpdate: readOnly ? () => {} : (updated) => updateStep(i, updated),
            // Hide the hover-X on shared workflows — pass undefined so the
            // node wrapper doesn't render its delete button.
            onDelete: readOnly ? undefined : () => deleteStep(i),
            expanded: isExpanded,
            onToggleExpand: () => setExpandedStep(isExpanded ? null : i),
            validationErrors: validationErrors[step.id],
            allSteps: steps, currentStepId,
            stepResult: activeRun?.stepResults?.[i],
            showEducationalCues,
            callClaudeAPI,
            onSaveCoworkerToLibrary,
            onUpdateFileContent,
            readOnly,
          },
        },
      };
    });
    const nextEdges = (workflow.edges || []).map(e => {
      const styled = styleEdge(e);
      // Same story on edges — no hover-X when read-only.
      return { ...styled, data: { ...(styled.data || {}), onDelete: readOnly ? undefined : handleDeleteEdge } };
    });
    return { derivedNodes: nextNodes, derivedEdges: nextEdges };
  }, [workflow, fileTree, coworkers, tools, participants, activeRun, currentStepId, expandedStep, setExpandedStep, updateStep, deleteStep, validationErrors, showEducationalCues, callClaudeAPI, onSaveCoworkerToLibrary, onUpdateFileContent, handleDeleteEdge, readOnly]);

  useEffect(() => {
    // Don't blow away React Flow's internal node state on every render. When
    // the derived set has the same ids as what's already on the canvas, patch
    // each node in place (position, data, draggable) so mid-flight interactions
    // (selection, hover, drag state) survive. Only replace wholesale when the
    // id set actually changes — a node was added or removed.
    setNodes(existing => {
      const existingIds = new Set(existing.map(n => n.id));
      const incomingIds = new Set(derivedNodes.map(n => n.id));
      const sameIds =
        existingIds.size === incomingIds.size &&
        derivedNodes.every(n => existingIds.has(n.id));
      if (!sameIds) return derivedNodes;
      const byId = new Map(derivedNodes.map(n => [n.id, n]));
      return existing.map(n => {
        const d = byId.get(n.id);
        if (!d) return n;
        return { ...n, data: d.data, position: d.position, draggable: d.draggable };
      });
    });
    setEdges(existing => {
      const existingIds = new Set(existing.map(e => e.id));
      const incomingIds = new Set(derivedEdges.map(e => e.id));
      const sameIds =
        existingIds.size === incomingIds.size &&
        derivedEdges.every(e => existingIds.has(e.id));
      if (!sameIds) return derivedEdges;
      const byId = new Map(derivedEdges.map(e => [e.id, e]));
      return existing.map(e => {
        const d = byId.get(e.id);
        return d ? { ...e, data: d.data, style: d.style, type: d.type } : e;
      });
    });
  }, [derivedNodes, derivedEdges]);

  const handleNodesChange = useCallback((changes) => {
    setNodes(ns => applyNodeChanges(changes, ns));
    const committed = changes.filter(c => c.type === 'position' && c.dragging === false && c.position);
    if (committed.length > 0) {
      const updatedNodes = (workflow.nodes || []).map(n => {
        const change = committed.find(c => c.id === n.id);
        return change ? { ...n, position: change.position } : n;
      });
      const existingIds = new Set(updatedNodes.map(n => n.id));
      committed.forEach(c => {
        if (!existingIds.has(c.id)) {
          const step = (workflow.steps || []).find(s => s.id === c.id);
          if (step) updatedNodes.push({ id: step.id, type: step.type, position: c.position, data: { ...step } });
        }
      });
      onUpdateWorkflow({ ...workflow, nodes: updatedNodes });
    }
  }, [workflow, onUpdateWorkflow]);

  const handleEdgesChange = useCallback((changes) => {
    setEdges(es => applyEdgeChanges(changes, es));
    const removed = changes.filter(c => c.type === 'remove');
    if (removed.length > 0) {
      const removeIds = new Set(removed.map(c => c.id));
      const nextEdges = (workflow.edges || []).filter(e => !removeIds.has(e.id));
      onUpdateWorkflow({ ...workflow, edges: nextEdges });
    }
  }, [workflow, onUpdateWorkflow]);

  const handleConnect = useCallback((params) => {
    const currentEdges = workflow.edges || [];
    if (params.source === params.target) return;
    // Skip duplicate edges (same source/target/handles).
    const exists = currentEdges.some(e =>
      e.source === params.source && e.target === params.target
      && (e.sourceHandle || null) === (params.sourceHandle || null)
      && (e.targetHandle || null) === (params.targetHandle || null)
    );
    if (exists) return;
    if (wouldCreateCycle(currentEdges, params.source, params.target, params.sourceHandle)) {
      // Could surface a toast here; for now we just refuse the wire.
      return;
    }
    const sourceStep = (workflow.steps || []).find(s => s.id === params.source);
    // Default sourceHandle depends on node type: Review's default is
    // 'approved' (Phase 4 split), everything else stays 'out'.
    const defaultHandle = sourceStep?.type === 'approval' ? 'approved' : 'out';
    const newEdge = {
      id: `edge-${params.source}-${params.target}-${Date.now()}`,
      source: params.source,
      target: params.target,
      sourceHandle: params.sourceHandle || defaultHandle,
      targetHandle: params.targetHandle || 'in',
    };
    setEdges(es => addEdge(styleEdge(newEdge), es));
    onUpdateWorkflow({ ...workflow, edges: [...currentEdges, newEdge] });
  }, [workflow, onUpdateWorkflow]);

  // Auto-scroll the copilot transcript to the bottom whenever it grows.
  useEffect(() => {
    const el = copilotScrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [copilotMessages]);

  const handleCopilotSend = useCallback(async () => {
    const text = copilotInput.trim();
    if (!text || copilotBusy) return;
    setCopilotInput('');
    setCopilotMessages(prev => [...prev, { kind: 'user', text }]);
    setCopilotBusy(true);

    const workflowRef = { current: workflow };
    const priorHistory = (copilotHistoriesRef && copilotWfId)
      ? (copilotHistoriesRef.current[copilotWfId] || [])
      : [];
    try {
      const { updatedHistory, updatedWorkflow } = await runCopilotTurn({
        apiKey,
        userMessage: text,
        conversationHistory: priorHistory,
        workflow,
        coworkers,
        participants,
        fileTree,
        onWorkflowUpdate: (next) => {
          workflowRef.current = next;
          onUpdateWorkflow(next);
        },
        onNarration: (narration) => {
          setCopilotMessages(prev => [...prev, { kind: 'assistant', text: narration }]);
        },
        onError: (errMsg) => {
          setCopilotMessages(prev => [...prev, { kind: 'error', text: errMsg }]);
        },
        onUsage: onCopilotUsage,
      });
      if (copilotHistoriesRef && copilotWfId) {
        copilotHistoriesRef.current[copilotWfId] = updatedHistory;
      }
      // updatedWorkflow is already committed via onWorkflowUpdate — nothing else to do here.
      void updatedWorkflow;
    } catch (err) {
      setCopilotMessages(prev => [...prev, { kind: 'error', text: `Copilot crashed: ${err.message}` }]);
    } finally {
      setCopilotBusy(false);
    }
  }, [copilotInput, copilotBusy, apiKey, workflow, coworkers, participants, onUpdateWorkflow, setCopilotInput, setCopilotMessages, setCopilotBusy, copilotHistoriesRef, copilotWfId, onCopilotUsage]);

  return (
    <div className={`wf-canvas-layout${copilotOpen ? ' copilot-open' : ''}`}>
    <div className="wf-canvas-wrap">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={wfEdgeTypes}
        onNodesChange={readOnly ? undefined : handleNodesChange}
        onEdgesChange={readOnly ? undefined : handleEdgesChange}
        onConnect={readOnly ? undefined : handleConnect}
        nodesConnectable={!readOnly}
        nodesDraggable={!readOnly}
        edgesFocusable={!readOnly}
        elementsSelectable
        fitView
        fitViewOptions={{ padding: 0.2, maxZoom: 1 }}
        proOptions={{ hideAttribution: true }}
        defaultEdgeOptions={{ type: 'deletable', animated: false, style: { stroke: '#c8956c', strokeWidth: 2 } }}
        nodeDragThreshold={5}
      >
        <Background gap={20} size={1} color="#d4ccc2" />
        <Controls showInteractive={false} />
        <MiniMap
          nodeColor={(n) => {
            // Tint minimap tiles by node type so the overall shape reads at a glance.
            if (n.type === 'trigger') return '#5a8f6b';
            if (n.type === 'approval') return '#c8956c';
            return '#4a7fb5';
          }}
          nodeStrokeWidth={2}
          maskColor="rgba(250, 247, 242, 0.6)"
          pannable
          zoomable
          style={{ background: 'var(--bg-white)', border: '1px solid var(--border-color)', borderRadius: 6 }}
        />
      </ReactFlow>
      {!readOnly && (
        <button
          className={`wf-copilot-toggle${copilotOpen ? ' open' : ''}`}
          onClick={() => setCopilotOpen(o => !o)}
          title={copilotOpen ? 'Hide copilot' : 'Open copilot'}
        >
          {copilotOpen ? '\u2192' : '\u2190'} Copilot
        </button>
      )}
    </div>
    {!readOnly && copilotOpen && (
      <aside className="wf-copilot-panel">
        <div className="wf-copilot-header">
          <span className="wf-copilot-title">Workflow Copilot</span>
          <button className="wf-copilot-close" onClick={() => setCopilotOpen(false)}>{'\u2715'}</button>
        </div>
        <div className="wf-copilot-messages" ref={copilotScrollRef}>
          {copilotMessages.length === 0 && !copilotBusy && (
            <div className="wf-copilot-empty">
              Describe the workflow you want. I'll stitch the DAG — add coworker steps, wire reviews, connect the edges.
              <br /><br />
              Try: <em>"Ravi drafts a risk memo, Priya reviews, then Legal AI checks exceptions, then I sign off."</em>
            </div>
          )}
          {copilotMessages.map((m, i) => (
            <div key={i} className={`wf-copilot-msg wf-copilot-msg-${m.kind}`}>
              <RichText content={m.text} />
            </div>
          ))}
          {copilotBusy && <div className="wf-copilot-msg wf-copilot-msg-thinking">Thinking\u2026</div>}
        </div>
        <div className="wf-copilot-input-row">
          <textarea
            className="wf-copilot-input"
            value={copilotInput}
            onChange={e => setCopilotInput(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleCopilotSend();
              }
            }}
            placeholder={copilotBusy ? 'Copilot is working\u2026' : 'Describe the workflow or a change\u2026'}
            rows={2}
            disabled={copilotBusy}
          />
          <button
            className="wf-copilot-send"
            onClick={handleCopilotSend}
            disabled={copilotBusy || !copilotInput.trim()}
          >Send</button>
        </div>
      </aside>
    )}
    </div>
  );
}

// ===== Workflow Editor =====
function WorkflowEditor({ workflow, onUpdateWorkflow, readOnly, fileTree, coworkers, tools, participants, onRun, onCancelRun, isRunning, currentStepId, activeRun, onBack, showEducationalCues, callClaudeAPI, onSaveCoworkerToLibrary, onUpdateFileContent, apiKey, onCopilotUsage, copilotState, onCopilotPatch, copilotHistoriesRef, copilotWfId }) {
  const confirm = useConfirm();
  const [expandedStep, setExpandedStep] = useState(null);
  const [showAddMenu, setShowAddMenu] = useState(false);
  const [validationErrors, setValidationErrors] = useState({});
  const [dragIndex, setDragIndex] = useState(null);
  const [dragOverIndex, setDragOverIndex] = useState(null);
  const [dragOverHalf, setDragOverHalf] = useState(null);

  const triggerStep = (workflow.steps || []).find(s => s.type === 'trigger');
  const hasTriggerInput = !!triggerStep?.caseInput?.trim() || (triggerStep?.fileIds?.length || 0) > 0;
  const realStepCount = (workflow.steps || []).filter(s => s.type !== 'trigger').length;

  function updateStep(index, updatedStep) {
    const steps = [...workflow.steps];
    steps[index] = updatedStep;
    onUpdateWorkflow({ ...workflow, steps });
  }

  async function deleteStep(index) {
    if (workflow.steps[index]?.type === 'trigger') return;
    const ok = await confirm({ message: 'Delete this step?', danger: true });
    if (!ok) return;
    onUpdateWorkflow({ ...workflow, steps: workflow.steps.filter((_, i) => i !== index) });
    setExpandedStep(null);
  }

  function handleDragStart(e, index) { setDragIndex(index); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', index.toString()); }
  function handleDragOver(e, index) {
    e.preventDefault(); e.dataTransfer.dropEffect = 'move';
    if (dragIndex === null || dragIndex === index) { setDragOverIndex(index); setDragOverHalf(null); return; }
    const rect = e.currentTarget.getBoundingClientRect();
    setDragOverIndex(index);
    setDragOverHalf(e.clientY < rect.top + rect.height / 2 ? 'above' : 'below');
  }
  function handleDragEnd() { setDragIndex(null); setDragOverIndex(null); setDragOverHalf(null); }
  function handleDrop(e, targetIndex) {
    e.preventDefault();
    if (dragIndex === null || dragIndex === targetIndex) { handleDragEnd(); return; }
    const steps = [...workflow.steps]; const [dragged] = steps.splice(dragIndex, 1);
    let insertAt = targetIndex;
    if (dragIndex < targetIndex) { insertAt = dragOverHalf === 'above' ? targetIndex - 1 : targetIndex; }
    else { insertAt = dragOverHalf === 'above' ? targetIndex : targetIndex + 1; }
    insertAt = Math.max(0, Math.min(insertAt, steps.length));
    steps.splice(insertAt, 0, dragged);
    onUpdateWorkflow({ ...workflow, steps });
    if (expandedStep === dragIndex) setExpandedStep(insertAt); else setExpandedStep(null);
    handleDragEnd();
  }

  function addStep(type) {
    const defaultName = type === 'agent' ? 'New Coworker'
      : type === 'approval' ? 'Human Review'
      : type === 'capture' ? 'Capture Learning'
      : 'New Step';
    const newStep = {
      id: genStepId(), type,
      name: defaultName,
      ...(type === 'agent' && { coworker: emptyCoworker() }),
      ...(type === 'approval' && { assigneeId: '', prompt: '' }),
      ...(type === 'capture' && { mode: 'knowledge', targetFileId: '' }),
    };
    onUpdateWorkflow({ ...workflow, steps: [...workflow.steps, newStep] });
    setShowAddMenu(false);
    setExpandedStep(workflow.steps.length);
  }

  function validate() {
    const errors = {}; let valid = true;
    if (realStepCount === 0) return { valid: false, errors };
    workflow.steps.forEach((step) => {
      errors[step.id] = {};
      if (step.type === 'agent') {
        const cw = step.coworker || (step.coworkerId ? (coworkers || []).find(c => c.id === step.coworkerId) : null);
        if (!cw?.name?.trim()) { errors[step.id].noAgent = true; valid = false; }
      }
      if (step.type === 'trigger' && !step.caseInput?.trim() && !(step.fileIds?.length)) { errors[step.id].noCaseInput = true; valid = false; }
      // Capture: no validation block. An unconfigured Capture soft-lands at
      // run time (nothing captured, run completes) so participants can Run
      // freely and come back to configure Capture later.
    });
    setValidationErrors(errors);
    return { valid, errors };
  }

  function handleRun() {
    const { valid, errors } = validate();
    if (!valid) {
      // Expand the first step with an error so the user can see and fix it.
      const firstBadIdx = workflow.steps.findIndex(s => {
        const e = errors[s.id] || {};
        return Object.keys(e).length > 0;
      });
      if (firstBadIdx >= 0) setExpandedStep(firstBadIdx);
      return;
    }
    onRun(workflow.id);
  }

  return (
    <div className={`workflow-builder${readOnly ? ' workflow-builder-readonly' : ''}`}>
      <div className="workflow-header-bar">
        <button className="files-back-btn" onClick={onBack}>{'\u2190'} All Workflows</button>
        <input
          className="workflow-name-input"
          value={workflow.name}
          onChange={e => onUpdateWorkflow({ ...workflow, name: e.target.value })}
          placeholder="Workflow name..."
          disabled={readOnly}
        />
        {readOnly && (
          <div className="wf-readonly-banner">Read-only — built by {workflow.createdBy || 'another participant'}</div>
        )}
        {!readOnly && (
          <div className="add-step-dropdown">
            <button className="add-step-btn" onClick={() => setShowAddMenu(!showAddMenu)} disabled={isRunning}>+ Add Step</button>
            {showAddMenu && (
              <div className="add-step-menu">
                <button className="add-step-option" onClick={() => addStep('agent')}><span className="dot agent"></span> Coworker Step</button>
                <button className="add-step-option" onClick={() => addStep('approval')}><span className="dot approval"></span> Human Review</button>
                <button className="add-step-option" onClick={() => addStep('capture')}><span className="dot capture"></span> Capture Learning</button>
              </div>
            )}
          </div>
        )}
        {isRunning ? (
          <button
            className="run-btn run-btn-stop"
            onClick={() => activeRun && onCancelRun && onCancelRun(activeRun.id)}
            title="Stop this run"
          >
            Stop
          </button>
        ) : (
          <button
            className="run-btn"
            onClick={handleRun}
            disabled={realStepCount === 0 || !hasTriggerInput}
            title={
              realStepCount === 0 ? 'Add at least one step before running'
              : !hasTriggerInput ? 'Add instructions or pick at least one document in the Trigger'
              : ''
            }
          >
            Run
          </button>
        )}
      </div>

      {(activeRun && activeRun.status === 'completed') && (
        <div className="wf-run-banner success wf-run-banner-canvas">
          <div className="wf-run-banner-title">{'\u2713'} Run complete</div>
          <div className="wf-run-banner-body">
            Started by {activeRun.startedBy} at {new Date(activeRun.startedAt).toLocaleTimeString()}.
            Any step with save enabled wrote its output to its chosen folder.
          </div>
        </div>
      )}
      {(activeRun && activeRun.status === 'rejected') && (
        <div className="wf-run-banner rejected wf-run-banner-canvas">
          <div className="wf-run-banner-title">Run rejected</div>
          <div className="wf-run-banner-body">
            A reviewer rejected and there was no previous review step to bounce back to. Revise the workflow or the input and run it again.
          </div>
        </div>
      )}
      {(activeRun && (activeRun.status === 'running' || activeRun.status === 'waiting_approval')) && (
        <div className="wf-run-banner running wf-run-banner-canvas">
          <div className="wf-run-banner-title"><span className="step-status-spinner" /> Run in progress</div>
          <div className="wf-run-banner-body">
            Started by {activeRun.startedBy} at {new Date(activeRun.startedAt).toLocaleTimeString()}. Watch the steps below.
          </div>
        </div>
      )}
      <WorkflowCanvas
        workflow={workflow}
        onUpdateWorkflow={onUpdateWorkflow}
        readOnly={readOnly}
        fileTree={fileTree}
        coworkers={coworkers}
        tools={tools}
        participants={participants}
        activeRun={activeRun}
        currentStepId={currentStepId}
        expandedStep={expandedStep}
        setExpandedStep={setExpandedStep}
        updateStep={updateStep}
        deleteStep={deleteStep}
        validationErrors={validationErrors}
        showEducationalCues={showEducationalCues}
        callClaudeAPI={callClaudeAPI}
        onSaveCoworkerToLibrary={onSaveCoworkerToLibrary}
        onUpdateFileContent={onUpdateFileContent}
        apiKey={apiKey}
        onCopilotUsage={onCopilotUsage}
        copilotState={copilotState}
        onCopilotPatch={onCopilotPatch}
        copilotHistoriesRef={copilotHistoriesRef}
        copilotWfId={copilotWfId}
      />

    </div>
  );
}

// ===== Workflow Card =====
function WorkflowCard({ workflow, coworkers, participants, onSelect, onDelete, onDuplicate, isRunning, readOnly }) {
  return (
    <div className="wf-card" onClick={() => onSelect(workflow.id)}>
      <div className="wf-card-top">
        <div className="wf-card-name">{workflow.name || 'Untitled Workflow'}</div>
        {isRunning && <span className="wf-card-running">Running</span>}
      </div>
      {/* Mini flow preview */}
      <div className="wf-card-flow">
        {(workflow.steps || []).map((step, i) => {
          const cw = resolveStepCoworker(step, coworkers);
          const icon = step.type === 'agent'
            ? <CoworkerGlyph avatar={cw?.avatar} size={12} color="#ffffff" />
            : step.type === 'approval' ? '\uD83D\uDC64'
            : step.type === 'trigger' ? '\u25B6'
            : step.type === 'capture' ? '\uD83D\uDCDA'
            : '\u2699\uFE0F';
          return (
            <span key={step.id} className="wf-card-flow-item">
              {i > 0 && <span className="wf-card-flow-arrow">{'\u2192'}</span>}
              <span className={`wf-card-flow-dot ${step.type}`} title={cw?.name || step.name}>{icon}</span>
            </span>
          );
        })}
        {(workflow.steps || []).filter(s => s.type !== 'trigger').length === 0 && <span className="wf-card-empty">No steps yet</span>}
      </div>
      <div className="wf-card-meta">
        <span>{(workflow.steps || []).filter(s => s.type !== 'trigger').length} steps</span>
      </div>
      <div className="wf-card-actions">
        {/* Duplicate stays enabled either way — cloning a shared workflow
            into your own copy is a legit flow, same as forking. */}
        <button className="wf-card-action" onClick={e => { e.stopPropagation(); onDuplicate(workflow.id); }} title={readOnly ? 'Duplicate into your own copy' : 'Duplicate'}>Copy</button>
        {!readOnly && (
          <button className="wf-card-action wf-card-action-delete" onClick={e => { e.stopPropagation(); onDelete(workflow.id); }} title="Delete">{'\u2715'}</button>
        )}
      </div>
    </div>
  );
}

// ===== Main Export =====
export default function WorkflowBuilder({ workflows, onUpdateWorkflows, fileTree, coworkers, tools, onRun, onCancelRun, onCancelAllRuns, workflowRuns = [], participants, currentUserName, showEducationalCues, callClaudeAPI, onSaveCoworkerToLibrary, onUpdateFileContent, apiKey, onCopilotUsage }) {
  const confirm = useConfirm();
  const [selectedWorkflowId, setSelectedWorkflowId] = useState(null);
  // Copilot transcript state lives up here so it survives closing the panel,
  // navigating back to the list, and switching between workflows. History is
  // a ref per workflow because it only needs to be readable by the async
  // copilot turn, not drive renders.
  const [copilotByWf, setCopilotByWf] = useState({});
  const copilotHistoriesRef = useRef({});

  const selectedWorkflow = selectedWorkflowId ? workflows.find(w => w.id === selectedWorkflowId) : null;

  const COPILOT_DEFAULTS = { messages: [], input: '', busy: false, open: null };
  const copilotState = selectedWorkflowId
    ? { ...COPILOT_DEFAULTS, ...(copilotByWf[selectedWorkflowId] || {}) }
    : COPILOT_DEFAULTS;

  function patchCopilot(patchOrFn) {
    if (!selectedWorkflowId) return;
    setCopilotByWf(prev => {
      const curr = { ...COPILOT_DEFAULTS, ...(prev[selectedWorkflowId] || {}) };
      const patch = typeof patchOrFn === 'function' ? patchOrFn(curr) : patchOrFn;
      return { ...prev, [selectedWorkflowId]: { ...curr, ...patch } };
    });
  }

  function handleUpdateWorkflow(updatedWf) {
    onUpdateWorkflows(workflows.map(w => w.id === updatedWf.id ? updatedWf : w));
  }

  function handleCreateWorkflow() {
    // Seed every new workflow with Trigger + Capture Learning already on the
    // canvas. They're left UNWIRED so the participant draws the edges through
    // whatever Coworker/Review steps they drop in between — which is the
    // whole point of the pattern (and what the Copilot chat helps with).
    // Providing nodes[] with positions tells ensureDagShape to skip its
    // auto-wire step; otherwise it would connect Trigger straight to Capture.
    const wfId = genWfId();
    const triggerStep = { id: 'trigger-' + wfId, type: 'trigger', name: 'Trigger', caseInput: '' };
    const captureStep = { id: genStepId(), type: 'capture', name: 'Capture Learning', mode: 'knowledge', targetFileId: '' };
    const newWf = {
      id: wfId,
      name: 'New Workflow',
      steps: [triggerStep, captureStep],
      nodes: [
        { id: triggerStep.id, type: 'trigger', position: { x: 240, y: 0 }, data: { ...triggerStep } },
        { id: captureStep.id, type: 'capture', position: { x: 240, y: 360 }, data: { ...captureStep } },
      ],
      edges: [],
      createdBy: currentUserName,
      createdAt: Date.now(),
    };
    onUpdateWorkflows([...workflows, newWf]);
    setSelectedWorkflowId(newWf.id);
  }

  async function handleDeleteWorkflow(wfId) {
    const ok = await confirm({ message: 'Delete this workflow?', danger: true });
    if (!ok) return;
    onUpdateWorkflows(workflows.filter(w => w.id !== wfId));
    if (selectedWorkflowId === wfId) setSelectedWorkflowId(null);
  }

  function handleDuplicateWorkflow(wfId) {
    const original = workflows.find(w => w.id === wfId);
    if (!original) return;
    // When cloning a System example, pre-fill the cloner as the reviewer
    // on every approval step so they can run it solo immediately. They
    // can still pick anyone else from the room via the editor's assignee
    // dropdown afterwards.
    const isExample = original.createdBy === 'System';
    const myParticipantId = isExample
      ? (participants || []).find(p => p.name === currentUserName)?.id || ''
      : null;
    // Step ids get rewritten — `nodes` and `edges` reference those ids, so
    // they have to be rewritten in lockstep or the orchestrator can't walk
    // the DAG (forwardOut would be keyed by stale ids and the queue would
    // drain on the trigger).
    const idMap = new Map();
    const newSteps = (original.steps || []).map(s => {
      const newId = genStepId();
      idMap.set(s.id, newId);
      return {
        ...s,
        id: newId,
        ...(isExample && s.type === 'approval' && myParticipantId
          ? { assigneeId: myParticipantId }
          : {}),
      };
    });
    const remap = (id) => idMap.get(id) || id;
    const newNodes = (original.nodes || []).map(n => ({
      ...structuredClone(n),
      id: remap(n.id),
      data: n.data ? { ...structuredClone(n.data), id: remap(n.data.id) } : n.data,
    }));
    const newEdges = (original.edges || []).map(e => {
      const src = remap(e.source);
      const tgt = remap(e.target);
      return {
        ...structuredClone(e),
        id: `edge-${src}-${tgt}${e.sourceHandle ? '-' + e.sourceHandle : ''}`,
        source: src,
        target: tgt,
      };
    });
    const copy = {
      ...structuredClone(original),
      id: genWfId(),
      name: original.name + ' (copy)',
      steps: newSteps,
      nodes: newNodes,
      edges: newEdges,
      createdBy: currentUserName,
    };
    onUpdateWorkflows([...workflows, copy]);
  }

  async function handleClearAll() {
    if (workflows.length === 0) return;
    const ok = await confirm({
      title: 'Clear all workflows',
      message: `Delete all ${workflows.length} workflow${workflows.length === 1 ? '' : 's'} in this room? This affects every participant and cannot be undone.`,
      confirmLabel: 'Delete all',
      danger: true,
    });
    if (!ok) return;
    onUpdateWorkflows([]);
    setSelectedWorkflowId(null);
  }

  if (selectedWorkflow) {
    const editorReadOnly = selectedWorkflow.createdBy !== currentUserName;
    return (
      <div className="panel panel-center">
        <WorkflowEditor
          workflow={selectedWorkflow}
          onUpdateWorkflow={editorReadOnly ? () => {} : handleUpdateWorkflow}
          readOnly={editorReadOnly}
          fileTree={fileTree}
          coworkers={coworkers}
          tools={tools}
          participants={participants}
          onRun={onRun}
          onCancelRun={onCancelRun}
          isRunning={workflowRuns.some(r => r.workflowId === selectedWorkflow.id && (r.status === 'running' || r.status === 'waiting_approval'))}
          currentStepId={(() => { const run = workflowRuns.find(r => r.workflowId === selectedWorkflow.id && r.status === 'running'); return run?.stepResults?.find(s => s.status === 'running')?.stepId ?? null; })()}
          activeRun={(() => {
            // Most recent run for this workflow — shown live while running, and
            // sticks around in "completed"/"rejected" state so the runner sees
            // the final state without switching tabs.
            const runs = (workflowRuns || []).filter(r => r.workflowId === selectedWorkflow.id);
            if (runs.length === 0) return null;
            return runs[runs.length - 1];
          })()}
          onBack={() => setSelectedWorkflowId(null)}
          showEducationalCues={showEducationalCues}
          callClaudeAPI={callClaudeAPI}
          onSaveCoworkerToLibrary={onSaveCoworkerToLibrary}
          onUpdateFileContent={onUpdateFileContent}
          apiKey={apiKey}
          onCopilotUsage={onCopilotUsage}
          copilotState={copilotState}
          onCopilotPatch={patchCopilot}
          copilotHistoriesRef={copilotHistoriesRef}
          copilotWfId={selectedWorkflowId}
        />
      </div>
    );
  }

  return (
    <div className="panel panel-center">
      <div className="wf-list">
        <div className="wf-list-header">
          <div>
            <h2 className="wf-list-title">Workflows</h2>
            <p className="wf-list-subtitle">Multi-step processes with AI coworkers, human approvals, and system actions.</p>
            <EducationalCue cueId="workflow-overview" show={showEducationalCues} />
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="wf-create-btn" onClick={handleCreateWorkflow}>+ New Workflow</button>
          </div>
        </div>
        {workflows.length === 0 ? (
          <div className="wf-list-grid">
            <div className="wf-list-empty">
              <p>No workflows yet.</p>
            </div>
          </div>
        ) : (() => {
          // Three buckets — Examples (System-seeded canonical workflows),
          // Built by you, Built by others. Examples land at the top so the
          // canonical reference shows up first; the existing Copy button on
          // every card is the Clone affordance for examples too.
          const examples = workflows.filter(w => w.createdBy === 'System');
          const mine = workflows.filter(w => w.createdBy && w.createdBy !== 'System' && w.createdBy === currentUserName);
          const others = workflows.filter(w => w.createdBy && w.createdBy !== 'System' && w.createdBy !== currentUserName);
          const renderCard = (wf, readOnly) => (
            <WorkflowCard
              key={wf.id}
              workflow={wf}
              coworkers={coworkers}
              participants={participants}
              onSelect={setSelectedWorkflowId}
              onDelete={handleDeleteWorkflow}
              onDuplicate={handleDuplicateWorkflow}
              isRunning={workflowRuns.some(r => r.workflowId === wf.id && (r.status === 'running' || r.status === 'waiting_approval'))}
              readOnly={readOnly}
            />
          );
          return (
            <>
              {examples.length > 0 && (
                <div className="wf-section">
                  <div className="wf-section-title">Examples <span className="wf-section-count">{examples.length}</span></div>
                  <div className="wf-list-grid">{examples.map(wf => renderCard(wf, true))}</div>
                </div>
              )}
              {mine.length > 0 && (
                <div className="wf-section">
                  <div className="wf-section-title">Built by you <span className="wf-section-count">{mine.length}</span></div>
                  <div className="wf-list-grid">{mine.map(wf => renderCard(wf, false))}</div>
                </div>
              )}
              {others.length > 0 && (
                <div className="wf-section">
                  <div className="wf-section-title">Built by others <span className="wf-section-count">{others.length}</span></div>
                  <div className="wf-list-grid">{others.map(wf => renderCard(wf, true))}</div>
                </div>
              )}
            </>
          );
        })()}
      </div>
    </div>
  );
}
