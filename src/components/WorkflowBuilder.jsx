import { useState, useRef } from 'react';
import { parseFile, getFileIcon, getFileCategory } from '../utils/fileParser';
import EducationalCue from './EducationalCue';
import { CoworkerGlyph } from './Icon';

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

// ===== Visual Flow Summary =====
function FlowSummary({ steps, coworkers, participants }) {
  if (steps.length === 0) return null;

  return (
    <div className="wf-flow">
      {steps.map((step, i) => {
        const cw = step.coworkerId ? coworkers?.find(c => c.id === step.coworkerId) : null;
        const person = step.assigneeId ? participants?.find(p => p.id === step.assigneeId) : null;
        const color = step.type === 'agent' ? (cw?.color || '#4a7fb5')
          : step.type === 'approval' ? (person?.color || '#e8a87c')
          : '#5a9e6f';
        const label = step.type === 'agent' ? (cw?.name || step.name)
          : step.type === 'approval' ? (person?.name || 'Reviewer')
          : step.name;
        const iconNode = step.type === 'agent'
          ? <CoworkerGlyph avatar={cw?.avatar} size={14} color="#ffffff" />
          : step.type === 'approval'
            ? (person ? person.name.charAt(0).toUpperCase() : '\uD83D\uDC64')
            : '\u2699\uFE0F';

        return (
          <div key={step.id} className="wf-flow-item">
            {i > 0 && <span className="wf-flow-arrow">{'\u2192'}</span>}
            <div className={`wf-flow-node ${step.type}`} style={{ borderColor: color }}>
              <span className="wf-flow-icon" style={{ background: color }}>{iconNode}</span>
              <span className="wf-flow-label">{label}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ===== Step Card =====
function StepCard({ step, index, coworkers, tools, participants, onUpdate, onDelete, expanded, onToggleExpand, validationErrors, allSteps, currentStepId, isDragging, dragOverPos, onDragStart, onDragOver, onDragEnd, onDrop, showEducationalCues }) {
  const isRunning = currentStepId === step.id;
  const assignedCw = step.coworkerId ? coworkers?.find(c => c.id === step.coworkerId) : null;
  const assignedPerson = step.assigneeId ? participants?.find(p => p.id === step.assigneeId) : null;

  // What to show on the collapsed card
  const assignee = step.type === 'agent' && assignedCw
    ? { icon: <CoworkerGlyph avatar={assignedCw.avatar} size={12} color="#ffffff" />, name: assignedCw.name, color: assignedCw.color }
    : step.type === 'approval' && assignedPerson
      ? { icon: assignedPerson.name.charAt(0).toUpperCase(), name: assignedPerson.name, color: assignedPerson.color }
      : null;

  return (
    <div
      className={`step-drag-wrapper${isDragging ? ' dragging' : ''}${dragOverPos === 'above' ? ' drag-over-above' : ''}${dragOverPos === 'below' ? ' drag-over-below' : ''}`}
      draggable
      onDragStart={e => onDragStart(e, index)}
      onDragOver={e => onDragOver(e, index)}
      onDragEnd={onDragEnd}
      onDrop={e => onDrop(e, index)}
    >
      <div className={`workflow-step-card ${step.type}${isRunning ? ' running' : ''}${expanded ? ' expanded' : ''}`}>
        <div className="step-card-header" onClick={onToggleExpand}>
          <span className="step-drag-handle" title="Drag to reorder">{'\u2630'}</span>
          <span className={`step-number ${step.type}`}>{index + 1}</span>
          <span className={`step-type-label ${step.type}`}>
            {step.type === 'agent' ? 'Agent' : step.type === 'approval' ? 'Human' : 'Tool'}
          </span>
          {assignee && (
            <span className="step-assignee-badge" style={{ background: assignee.color || '#ccc' }}>
              {assignee.icon}
            </span>
          )}
          <span className="step-name">{step.name}</span>
          {assignee && <span className="step-assignee-name">{assignee.name}</span>}
          <span className="step-actions">
            <button className="step-action-btn step-delete-btn" onClick={e => { e.stopPropagation(); onDelete(); }} title="Delete">{'\u2715'}</button>
            <span className={`step-chevron${expanded ? ' open' : ''}`}>{'\u25BE'}</span>
          </span>
        </div>
        {expanded && (
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

// ===== Workflow Editor =====
const TRIGGER_TYPES = [
  { value: 'manual', label: 'Manual Submit', icon: '\uD83D\uDCE5', desc: 'Someone uploads documents and submits a case' },
  { value: 'folder', label: 'Folder Upload', icon: '\uD83D\uDCC1', desc: 'In production: files added to a shared drive trigger this workflow' },
  { value: 'api', label: 'API / Webhook', icon: '\uD83D\uDD17', desc: 'In production: your CRM, ERP, or other system sends a request' },
  { value: 'email', label: 'Email', icon: '\uD83D\uDCE7', desc: 'In production: an email to loans@your-bank.com triggers this' },
  { value: 'schedule', label: 'Scheduled', icon: '\u23F0', desc: 'In production: runs automatically on a schedule (e.g., daily at 9 AM)' },
  { value: 'form', label: 'Form Submission', icon: '\uD83D\uDCDD', desc: 'In production: a customer fills out an online form' },
];

function WorkflowEditor({ workflow, onUpdateWorkflow, fileTree, coworkers, tools, participants, onRun, isRunning, currentStepId, onBack, showEducationalCues }) {
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
          {isRunning ? 'Running...' : '\uD83D\uDCE5 Submit Case'}
        </button>
      </div>

      {/* Trigger type config */}
      <div className="wf-trigger-bar">
        <span className="wf-trigger-label">Trigger:</span>
        <div className="wf-trigger-pills">
          {TRIGGER_TYPES.map(t => (
            <button
              key={t.value}
              className={`wf-trigger-pill${(workflow.triggerType || 'manual') === t.value ? ' active' : ''}`}
              onClick={() => onUpdateWorkflow({ ...workflow, triggerType: t.value })}
              title={t.desc}
            >
              <span>{t.icon}</span> {t.label}
            </button>
          ))}
        </div>
      </div>
      {(workflow.triggerType && workflow.triggerType !== 'manual') && (
        <div className="wf-trigger-note">
          <span className="wf-trigger-note-icon">{TRIGGER_TYPES.find(t => t.value === workflow.triggerType)?.icon}</span>
          <span>{TRIGGER_TYPES.find(t => t.value === workflow.triggerType)?.desc}</span>
          <span className="wf-trigger-note-sim">In Foundry, use "Submit Case" to simulate this trigger.</span>
        </div>
      )}
      {/* Destination for final output — set once per workflow, used to auto-save on completion */}
      <div className="wf-trigger-bar">
        <span className="wf-trigger-label">Saves to:</span>
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
              <label key={sub} className={`wf-trigger-pill${active ? ' active' : ''}`}>
                <input
                  type="radio"
                  name="wf-destination-subfolder"
                  checked={active}
                  onChange={() => onUpdateWorkflow({
                    ...workflow,
                    destination: { ...(workflow.destination || {}), subfolder: sub },
                  })}
                  style={{ display: 'none' }}
                />
                {sub}
              </label>
            );
          })}
        </div>
      </div>
      <div style={{ padding: '0 24px' }}>
        <EducationalCue cueId="workflow-triggers" show={showEducationalCues} />
        {(workflow.triggerType || 'manual') === 'manual' && <EducationalCue cueId="trigger-manual" show={showEducationalCues} />}
        {workflow.triggerType === 'folder' && <EducationalCue cueId="trigger-folder" show={showEducationalCues} />}
        {workflow.triggerType === 'api' && <EducationalCue cueId="trigger-api" show={showEducationalCues} />}
        {workflow.triggerType === 'email' && <EducationalCue cueId="trigger-email" show={showEducationalCues} />}
        {workflow.triggerType === 'schedule' && <EducationalCue cueId="trigger-schedule" show={showEducationalCues} />}
        {workflow.triggerType === 'form' && <EducationalCue cueId="trigger-form" show={showEducationalCues} />}
      </div>

      {/* Submit Case Modal */}
      {showSubmit && (
        <div className="modal-overlay" onClick={() => setShowSubmit(false)}>
          <div className="modal-box" style={{ maxWidth: 520 }} onClick={e => e.stopPropagation()}>
            <h3>Submit Case</h3>
            <p>Upload documents and describe the case. This will trigger the workflow.</p>

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
                Submit & Run Orchestration
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Visual flow summary */}
      {workflow.steps.length > 0 && (
        <FlowSummary steps={workflow.steps} coworkers={coworkers} participants={participants} />
      )}

      <div className="workflow-steps">
        {workflow.steps.length > 1 && (
          <div style={{ padding: '0 4px 8px' }}>
            <EducationalCue cueId="workflow-step-reorder" show={showEducationalCues} />
          </div>
        )}
        {workflow.steps.length === 0 && (
          <div className="no-steps-placeholder">
            <div>
              <p style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>Build your process</p>
              <p>Add agent steps, human review gates, and system actions to create your workflow.</p>
            </div>
          </div>
        )}
        {workflow.steps.map((step, index) => (
          <div key={step.id}>
            {index > 0 && <div className="step-connector">{'\u2193'}</div>}
            <StepCard
              step={step} index={index} coworkers={coworkers} tools={tools} participants={participants}
              onUpdate={updated => updateStep(index, updated)}
              onDelete={() => deleteStep(index)}
              expanded={expandedStep === index}
              onToggleExpand={() => setExpandedStep(expandedStep === index ? null : index)}
              validationErrors={validationErrors[step.id]}
              allSteps={workflow.steps} currentStepId={currentStepId}
              isDragging={dragIndex === index}
              dragOverPos={dragOverIndex === index && dragIndex !== index ? dragOverHalf : null}
              onDragStart={handleDragStart} onDragOver={handleDragOver}
              onDragEnd={handleDragEnd} onDrop={handleDrop}
              showEducationalCues={showEducationalCues}
            />
          </div>
        ))}
      </div>

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
