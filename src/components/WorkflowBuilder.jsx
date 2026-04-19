import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import ReactFlow, { Background, Controls, applyNodeChanges } from 'reactflow';
import 'reactflow/dist/style.css';
import { parseFile, getFileIcon, getFileCategory } from '../utils/fileParser';
import EducationalCue from './EducationalCue';
import { CoworkerGlyph } from './Icon';
import RichText from './RichText';

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

// ===== React Flow node wrapper =====
// Each step renders inside a React Flow node as a StepCard. The node's
// position comes from workflow.nodes[i].position; the step's config lives in
// data.stepCardProps. The drag-handle and drop-zone behavior inside StepCard
// is suppressed when onCanvas is true — position drag happens via React Flow.
function StepNode({ data }) {
  return (
    <div className="wf-canvas-node" style={{ width: 420 }}>
      <StepCard {...data.stepCardProps} onCanvas />
    </div>
  );
}

const nodeTypes = { agent: StepNode, approval: StepNode };

// ===== Step Card =====
function StepCard({ step, index, coworkers, tools, participants, onUpdate, onDelete, expanded, onToggleExpand, validationErrors, allSteps, currentStepId, stepResult, isDragging, dragOverPos, onDragStart, onDragOver, onDragEnd, onDrop, showEducationalCues, onCanvas }) {
  const isRunning = currentStepId === step.id;
  const assignedCw = step.coworkerId ? coworkers?.find(c => c.id === step.coworkerId) : null;
  const assignedPerson = step.assigneeId ? participants?.find(p => p.id === step.assigneeId) : null;

  // Live run state derived from the run's stepResults entry.
  const runStatus = stepResult?.status || 'pending';
  const isWaiting = runStatus === 'waiting';
  const isCompleted = runStatus === 'completed';
  const isRejected = runStatus === 'rejected' || runStatus === 'error';
  const cardStateClass = isWaiting ? ' waiting'
    : isCompleted ? ' completed'
    : isRejected ? ' rejected'
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

  const statusBadge = isRunning || runStatus === 'running' ? <span className="step-status-badge running"><span className="step-status-spinner" /> Running</span>
    : isWaiting ? <span className="step-status-badge waiting">Waiting on {assignedPerson?.name || 'a reviewer'}</span>
    : isCompleted ? <span className="step-status-badge done">{'\u2713'} Done</span>
    : isRejected ? <span className="step-status-badge rejected">Rejected</span>
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
          {!onCanvas && <span className="step-drag-handle" title="Drag to reorder">{'\u2630'}</span>}
          <span className={`step-number ${step.type}${isCompleted ? ' done' : ''}`}>
            {isCompleted ? '\u2713' : index + 1}
          </span>
          <span className={`step-type-label ${step.type}`}>
            {step.type === 'agent' ? 'Coworker' : 'Review'}
          </span>
          {assignee && (
            <span className="step-assignee-badge" style={{ background: assignee.color || '#ccc' }}>
              {assignee.icon}
            </span>
          )}
          <span className="step-name">{step.name}</span>
          {assignee && <span className="step-assignee-name">{assignee.name}</span>}
          {statusBadge}
          <span className="step-actions">
            {!stepResult && (
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
        {expanded && stepResult && stepResult.output && (
          <div className="step-card-body">
            <div className="step-output-label">Output</div>
            <div className="step-output-body md-doc"><RichText content={String(stepResult.output)} /></div>
            {stepResult.completedAt && (
              <div className="step-output-time">{new Date(stepResult.completedAt).toLocaleTimeString()}</div>
            )}
          </div>
        )}
        {expanded && !stepResult && (
          <div className="step-card-body">
            <div className="step-config-row">
              <label>Step Name</label>
              <input type="text" value={step.name} onChange={e => onUpdate({ ...step, name: e.target.value })} />
            </div>

            {step.type === 'agent' && (
              <>
                <EducationalCue cueId="step-type-agent" show={showEducationalCues} />
                <div className="step-config-row">
                  <label>Assign Coworker</label>
                  <select value={step.coworkerId || ''} onChange={e => onUpdate({ ...step, coworkerId: e.target.value })}>
                    <option value="">Select a coworker...</option>
                    {(coworkers || []).map(c => (
                      <option key={c.id} value={c.id}>{c.name} — {c.role}</option>
                    ))}
                  </select>
                  {(coworkers || []).length === 0 && <div className="validation-error" style={{ background: '#f5f0e8', color: 'var(--text-body)' }}>No coworkers yet. Go to the Coworkers tab to add one.</div>}
                  {validationErrors?.noAgent && <div className="validation-error">Coworker is required</div>}
                </div>
                {assignedCw && (
                  <div className="step-agent-info">
                    <span className="step-agent-info-avatar" style={{ background: assignedCw.color }}>
                      <CoworkerGlyph avatar={assignedCw.avatar} size={16} color="#ffffff" />
                    </span>
                    <div>
                      <div className="step-agent-info-name">{assignedCw.name}</div>
                      <div className="step-agent-info-role">{assignedCw.role}</div>
                    </div>
                  </div>
                )}
                <div className="step-config-row">
                  <label>Input Description</label>
                  <textarea value={step.inputDescription || ''} onChange={e => onUpdate({ ...step, inputDescription: e.target.value })} placeholder="What does this step process?" />
                </div>
              </>
            )}

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

          </div>
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
function WorkflowCanvas({ workflow, onUpdateWorkflow, coworkers, tools, participants, activeRun, currentStepId, expandedStep, setExpandedStep, updateStep, deleteStep, validationErrors, showEducationalCues }) {
  const [nodes, setNodes] = useState([]);
  const [edges, setEdges] = useState([]);

  // Derive canvas nodes from workflow.steps preserving any stored positions.
  const { derivedNodes, derivedEdges } = useMemo(() => {
    const positions = new Map((workflow.nodes || []).map(n => [n.id, n.position]));
    const steps = workflow.steps || [];
    const nextNodes = steps.map((step, i) => ({
      id: step.id,
      type: step.type,
      position: positions.get(step.id) || { x: 80, y: i * 240 },
      data: {
        stepCardProps: {
          step, index: i, coworkers, tools, participants,
          onUpdate: (updated) => updateStep(i, updated),
          onDelete: () => deleteStep(i),
          expanded: expandedStep === i,
          onToggleExpand: () => setExpandedStep(expandedStep === i ? null : i),
          validationErrors: validationErrors[step.id],
          allSteps: steps, currentStepId,
          stepResult: activeRun?.stepResults?.[i],
          showEducationalCues,
        },
      },
    }));
    const nextEdges = (workflow.edges || []).map(e => ({ ...e, type: 'default' }));
    return { derivedNodes: nextNodes, derivedEdges: nextEdges };
  }, [workflow, coworkers, tools, participants, activeRun, currentStepId, expandedStep, setExpandedStep, updateStep, deleteStep, validationErrors, showEducationalCues]);

  useEffect(() => {
    setNodes(derivedNodes);
    setEdges(derivedEdges);
  }, [derivedNodes, derivedEdges]);

  const handleNodesChange = useCallback((changes) => {
    setNodes(ns => applyNodeChanges(changes, ns));
    const committed = changes.filter(c => c.type === 'position' && c.dragging === false && c.position);
    if (committed.length > 0) {
      const updatedNodes = (workflow.nodes || []).map(n => {
        const change = committed.find(c => c.id === n.id);
        return change ? { ...n, position: change.position } : n;
      });
      // Include any nodes currently on the canvas that aren't in workflow.nodes yet
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

  return (
    <div className="wf-canvas-wrap">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={handleNodesChange}
        nodesConnectable={false}
        fitView
        fitViewOptions={{ padding: 0.2, maxZoom: 1 }}
        proOptions={{ hideAttribution: true }}
      >
        <Background gap={20} size={1} color="#d4ccc2" />
        <Controls showInteractive={false} />
      </ReactFlow>
      {workflow.steps.length === 0 && (
        <div className="wf-canvas-empty">
          <p style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>Build your process</p>
          <p>Click + Add Step below to chain coworker steps and human reviews.</p>
        </div>
      )}
    </div>
  );
}

// ===== Workflow Editor =====
function WorkflowEditor({ workflow, onUpdateWorkflow, fileTree, coworkers, tools, participants, onRun, isRunning, currentStepId, activeRun, onBack, showEducationalCues }) {
  const [expandedStep, setExpandedStep] = useState(null);
  const [showAddMenu, setShowAddMenu] = useState(false);
  const [validationErrors, setValidationErrors] = useState({});
  const [dragIndex, setDragIndex] = useState(null);
  const [dragOverIndex, setDragOverIndex] = useState(null);
  const [dragOverHalf, setDragOverHalf] = useState(null);
  const [showSubmit, setShowSubmit] = useState(false);
  const [submitText, setSubmitText] = useState('');
  const [submitFiles, setSubmitFiles] = useState([]);
  const [parsingFiles, setParsingFiles] = useState(false);
  const submitFileRef = useRef(null);

  function updateStep(index, updatedStep) {
    const steps = [...workflow.steps];
    steps[index] = updatedStep;
    onUpdateWorkflow({ ...workflow, steps });
  }

  function deleteStep(index) {
    if (!confirm('Delete this step?')) return;
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
    const newStep = {
      id: genStepId(), type,
      name: type === 'agent' ? 'New Coworker Step' : 'Human Review',
      ...(type === 'agent' && { coworkerId: '', inputDescription: '' }),
      ...(type === 'approval' && { assigneeId: '', prompt: '', actions: ['Approve', 'Reject'] }),
    };
    onUpdateWorkflow({ ...workflow, steps: [...workflow.steps, newStep] });
    setShowAddMenu(false);
    setExpandedStep(workflow.steps.length);
  }

  function validate() {
    const errors = {}; let valid = true;
    if (workflow.steps.length === 0) return { valid: false, errors };
    workflow.steps.forEach((step) => {
      errors[step.id] = {};
      if (step.type === 'agent' && !step.coworkerId) { errors[step.id].noAgent = true; valid = false; }
    });
    setValidationErrors(errors);
    return { valid, errors };
  }

  function handleRun() {
    const { valid } = validate();
    if (!valid) return;
    onRun(workflow.id);
  }

  return (
    <div className="workflow-builder">
      <div className="workflow-header-bar">
        <button className="files-back-btn" onClick={onBack}>{'\u2190'} All Orchestrations</button>
        <input
          className="workflow-name-input"
          value={workflow.name}
          onChange={e => onUpdateWorkflow({ ...workflow, name: e.target.value })}
          placeholder="Orchestration name..."
        />
        <button className="run-btn" onClick={() => setShowSubmit(true)} disabled={isRunning || workflow.steps.length === 0}>
          {isRunning ? 'Running\u2026' : 'Run'}
        </button>
      </div>

      {/* Destination for final output — set once per workflow, used to auto-save on completion */}
      <div className="wf-destination-bar">
        <span className="wf-destination-label">Saves to</span>
        <select
          className="wf-destination-select"
          value={workflow.destination?.folderId || ''}
          onChange={e => onUpdateWorkflow({
            ...workflow,
            destination: { ...(workflow.destination || {}), folderId: e.target.value },
          })}
        >
          <option value="">First available folder</option>
          {(fileTree?.children || []).filter(c => c.type === 'folder').map(f => (
            <option key={f.id} value={f.id}>{f.name}</option>
          ))}
        </select>
        <div className="wf-destination-subfolder">
          {['knowledge', 'skills'].map(sub => {
            const active = (workflow.destination?.subfolder || 'knowledge') === sub;
            return (
              <button
                key={sub}
                type="button"
                className={`wf-destination-sub-pill${active ? ' active' : ''}`}
                onClick={() => onUpdateWorkflow({
                  ...workflow,
                  destination: { ...(workflow.destination || {}), subfolder: sub },
                })}
              >
                {sub}
              </button>
            );
          })}
        </div>
      </div>

      {/* Submit Case Modal */}
      {showSubmit && (
        <div className="modal-overlay" onClick={() => setShowSubmit(false)}>
          <div className="modal-box" style={{ maxWidth: 520 }} onClick={e => e.stopPropagation()}>
            <h3>Run orchestration</h3>
            <p>Describe the input for this run. Step 1 sees this; subsequent steps receive upstream outputs automatically.</p>

            <div className="submit-case-field">
              <label>Case Description (optional)</label>
              <textarea
                value={submitText}
                onChange={e => setSubmitText(e.target.value)}
                placeholder="Describe the case, or leave blank and upload documents..."
                rows={3}
                style={{ width: '100%', padding: '10px 12px', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-sm)', fontSize: 14, outline: 'none', resize: 'vertical', fontFamily: 'inherit' }}
              />
            </div>

            <div className="submit-case-field">
              <label>Documents</label>
              <input type="file" ref={submitFileRef} style={{ display: 'none' }} multiple
                accept=".pdf,.doc,.docx,.xls,.xlsx,.csv,.txt,.md,.json,.png,.jpg,.jpeg,.gif,.webp"
                onChange={async (e) => {
                  const files = Array.from(e.target.files);
                  if (files.length === 0) return;
                  setParsingFiles(true);
                  const parsed = [];
                  for (const file of files) {
                    const result = await parseFile(file);
                    parsed.push({ ...result, category: getFileCategory(file) });
                  }
                  setSubmitFiles(prev => [...prev, ...parsed]);
                  setParsingFiles(false);
                  if (submitFileRef.current) submitFileRef.current.value = '';
                }}
              />
              <button className="submit-case-upload" onClick={() => submitFileRef.current?.click()} disabled={parsingFiles}>
                {parsingFiles ? 'Reading files...' : '+ Upload Documents'}
              </button>
              {submitFiles.length > 0 && (
                <div className="submit-case-files">
                  {submitFiles.map((f, i) => (
                    <span key={i} className="cl-attached-chip">
                      <span className="cl-attached-chip-icon">{getFileIcon(f.category)}</span>
                      <span className="cl-attached-chip-name">{f.fileName}</span>
                      <button className="cl-attached-chip-remove" onClick={() => setSubmitFiles(prev => prev.filter((_, j) => j !== i))}>{'\u2715'}</button>
                    </span>
                  ))}
                </div>
              )}
            </div>

            <div className="modal-actions" style={{ marginTop: 16 }}>
              <button className="modal-btn cancel" onClick={() => { setShowSubmit(false); setSubmitText(''); setSubmitFiles([]); }}>Cancel</button>
              <button
                className="modal-btn primary"
                disabled={!submitText.trim() && submitFiles.length === 0}
                onClick={() => {
                  // Build case input from text + documents
                  const parts = [];
                  if (submitText.trim()) parts.push(submitText.trim());
                  if (submitFiles.length > 0) {
                    parts.push('\n## Submitted Documents\n');
                    submitFiles.forEach(f => {
                      if (f.type === 'text') parts.push(f.content);
                    });
                  }
                  const caseInput = parts.join('\n\n');
                  onRun(workflow.id, caseInput);
                  setShowSubmit(false);
                  setSubmitText('');
                  setSubmitFiles([]);
                }}
              >
                Run
              </button>
            </div>
          </div>
        </div>
      )}

      {(activeRun && activeRun.status === 'completed') && (
        <div className="wf-run-banner success wf-run-banner-canvas">
          <div className="wf-run-banner-title">{'\u2713'} Run complete</div>
          <div className="wf-run-banner-body">
            Started by {activeRun.startedBy} at {new Date(activeRun.startedAt).toLocaleTimeString()}.
            Final output saved to the destination folder.
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
      />

      <div className="workflow-actions-bar">
        <div className="add-step-dropdown">
          <button className="add-step-btn" onClick={() => setShowAddMenu(!showAddMenu)} disabled={isRunning}>+ Add Step</button>
          {showAddMenu && (
            <div className="add-step-menu">
              <button className="add-step-option" onClick={() => addStep('agent')}><span className="dot agent"></span> Coworker Step</button>
              <button className="add-step-option" onClick={() => addStep('approval')}><span className="dot approval"></span> Human Review</button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ===== Workflow Card =====
function WorkflowCard({ workflow, coworkers, participants, onSelect, onDelete, onDuplicate, isRunning }) {
  return (
    <div className="wf-card" onClick={() => onSelect(workflow.id)}>
      <div className="wf-card-top">
        <div className="wf-card-name">{workflow.name || 'Untitled Orchestration'}</div>
        {isRunning && <span className="wf-card-running">Running</span>}
      </div>
      {/* Mini flow preview */}
      <div className="wf-card-flow">
        {(workflow.steps || []).map((step, i) => {
          const cw = step.coworkerId ? coworkers?.find(c => c.id === step.coworkerId) : null;
          const icon = step.type === 'agent'
            ? <CoworkerGlyph avatar={cw?.avatar} size={12} color="#ffffff" />
            : step.type === 'approval' ? '\uD83D\uDC64'
            : '\u2699\uFE0F';
          return (
            <span key={step.id} className="wf-card-flow-item">
              {i > 0 && <span className="wf-card-flow-arrow">{'\u2192'}</span>}
              <span className={`wf-card-flow-dot ${step.type}`} title={step.name}>{icon}</span>
            </span>
          );
        })}
        {(!workflow.steps || workflow.steps.length === 0) && <span className="wf-card-empty">No steps yet</span>}
      </div>
      <div className="wf-card-meta">
        <span>{workflow.steps?.length || 0} steps</span>
      </div>
      <div className="wf-card-actions">
        <button className="wf-card-action" onClick={e => { e.stopPropagation(); onDuplicate(workflow.id); }} title="Duplicate">Copy</button>
        <button className="wf-card-action wf-card-action-delete" onClick={e => { e.stopPropagation(); onDelete(workflow.id); }} title="Delete">{'\u2715'}</button>
      </div>
    </div>
  );
}

// ===== Main Export =====
export default function WorkflowBuilder({ workflows, onUpdateWorkflows, fileTree, coworkers, tools, onRun, workflowRuns = [], participants, currentUserName, showEducationalCues }) {
  const [selectedWorkflowId, setSelectedWorkflowId] = useState(null);

  const selectedWorkflow = selectedWorkflowId ? workflows.find(w => w.id === selectedWorkflowId) : null;

  function handleUpdateWorkflow(updatedWf) {
    onUpdateWorkflows(workflows.map(w => w.id === updatedWf.id ? updatedWf : w));
  }

  function handleCreateWorkflow() {
    const newWf = { id: genWfId(), name: 'New Orchestration', steps: [] };
    onUpdateWorkflows([...workflows, newWf]);
    setSelectedWorkflowId(newWf.id);
  }

  function handleDeleteWorkflow(wfId) {
    if (!confirm('Delete this workflow?')) return;
    onUpdateWorkflows(workflows.filter(w => w.id !== wfId));
    if (selectedWorkflowId === wfId) setSelectedWorkflowId(null);
  }

  function handleDuplicateWorkflow(wfId) {
    const original = workflows.find(w => w.id === wfId);
    if (!original) return;
    const copy = {
      ...JSON.parse(JSON.stringify(original)),
      id: genWfId(),
      name: original.name + ' (copy)',
      steps: original.steps.map(s => ({ ...s, id: genStepId() })),
    };
    onUpdateWorkflows([...workflows, copy]);
  }

  if (selectedWorkflow) {
    return (
      <div className="panel panel-center">
        <WorkflowEditor
          workflow={selectedWorkflow}
          onUpdateWorkflow={handleUpdateWorkflow}
          fileTree={fileTree}
          coworkers={coworkers}
          tools={tools}
          participants={participants}
          onRun={onRun}
          isRunning={workflowRuns.some(r => r.workflowId === selectedWorkflow.id && (r.status === 'running' || r.status === 'waiting_approval'))}
          currentStepId={(() => { const run = workflowRuns.find(r => r.workflowId === selectedWorkflow.id && r.status === 'running'); return run ? run.stepResults.find(s => s.status === 'running')?.stepId : null; })()}
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
        />
      </div>
    );
  }

  return (
    <div className="panel panel-center">
      <div className="wf-list">
        <div className="wf-list-header">
          <div>
            <h2 className="wf-list-title">Orchestrations</h2>
            <p className="wf-list-subtitle">Multi-step processes with AI coworkers, human approvals, and system actions.</p>
            <EducationalCue cueId="workflow-overview" show={showEducationalCues} />
          </div>
          <button className="wf-create-btn" onClick={handleCreateWorkflow}>+ New Orchestration</button>
        </div>
        <div className="wf-list-grid">
          {workflows.length === 0 && (
            <div className="wf-list-empty">
              <p>No orchestrations yet.</p>
              <button className="setup-btn-primary" onClick={handleCreateWorkflow} style={{ marginTop: 16 }}>
                + Create your first orchestration
                <span className="btn-arrow">&#x2197;</span>
              </button>
            </div>
          )}
          {workflows.map(wf => (
            <WorkflowCard
              key={wf.id}
              workflow={wf}
              coworkers={coworkers}
              participants={participants}
              onSelect={setSelectedWorkflowId}
              onDelete={handleDeleteWorkflow}
              onDuplicate={handleDuplicateWorkflow}
              isRunning={workflowRuns.some(r => r.workflowId === wf.id && (r.status === 'running' || r.status === 'waiting_approval'))}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
