function generateRefId(type) {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const seq = String(Math.floor(Math.random() * 99999)).padStart(5, '0');
  return `${type.toUpperCase()}-${y}-${m}-${seq}`;
}

function formatTimestamp() {
  return new Date().toISOString().replace('T', ' ').slice(0, 19);
}

const SYSTEM_SIMULATIONS = {
  create_account: () => `Account ${generateRefId('ACC')} created. Timestamp: ${formatTimestamp()}`,
  disburse_funds: () => `Transaction ${generateRefId('TXN')} processed. Amount disbursed. Timestamp: ${formatTimestamp()}`,
  send_notification: () => `Notification ${generateRefId('NTF')} delivered. Timestamp: ${formatTimestamp()}`,
  update_status: () => `Status updated. Reference: ${generateRefId('STS')}. Timestamp: ${formatTimestamp()}`,
  generate_document: () => `Document ${generateRefId('DOC')} generated. Timestamp: ${formatTimestamp()}`,
  flag_for_review: () => `Flagged for review. Queue reference: ${generateRefId('REV')}. Timestamp: ${formatTimestamp()}`,
};

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

/**
 * Execute a workflow run asynchronously.
 * Each call operates independently — multiple can run concurrently.
 */
export async function executeWorkflowRun({
  runId,
  workflow,
  coworkers,
  tools,
  fileTree,
  caseInput,
  userName,
  callClaudeAPI,
  executeToolFn,        // (tool, input, fileTree, callClaudeAPI) => Promise<{success, output}>
  onStepUpdate,         // (runId, stepIndex, stepUpdate) => void
  onRunUpdate,          // (runId, runUpdate) => void
  onMessage,            // (msg) => void
  removeLoadingMessages, // () => void
  onLog,                // (entry) => void
  getApprovalDecision,  // (runId, stepId, config) => Promise<{action, comment}>
}) {
  const correctionCounts = {};
  const previousOutputs = [];

  onMessage({ type: 'user', content: caseInput });
  onMessage({ type: 'status', content: `Workflow "${workflow.name}" started by ${userName}` });
  onLog({ type: 'workflow', message: `started by ${userName} | workflow: ${workflow.name}` });

  let stepIndex = 0;

  while (stepIndex < workflow.steps.length) {
    const step = workflow.steps[stepIndex];

    onRunUpdate(runId, { currentStepIndex: stepIndex, status: 'running' });
    onStepUpdate(runId, stepIndex, { status: 'running' });
    onMessage({ type: 'status', content: `Step ${stepIndex + 1}: ${step.name}` });

    if (step.type === 'agent') {
      // Resolve coworker + skill
      let instructionFile, knowledgeContents, coworkerLabel, coworkerAvatar;
      if (step.coworkerId) {
        const coworker = coworkers?.find(c => c.id === step.coworkerId);
        if (!coworker) {
          onStepUpdate(runId, stepIndex, { status: 'error', output: 'Coworker not found' });
          onRunUpdate(runId, { status: 'error', completedAt: Date.now() });
          onMessage({ type: 'error', content: `No coworker found for step "${step.name}".` });
          onLog({ type: 'error', message: `${step.name} | coworker not found` });
          return;
        }
        const instrFiles = (coworker.instructionFileIds || []).map(id => findNode(fileTree, id)).filter(Boolean);
        instructionFile = instrFiles.length > 0 ? { content: instrFiles.map(f => f.content).join('\n\n') } : null;
        knowledgeContents = (coworker.knowledgeFileIds || []).map(id => findNode(fileTree, id)).filter(Boolean);
        coworkerLabel = coworker.name;
        coworkerAvatar = coworker.avatar;
      } else {
        instructionFile = findNode(fileTree, step.instructionFileId);
        knowledgeContents = (step.knowledgeFileIds || []).map(id => findNode(fileTree, id)).filter(Boolean);
        coworkerLabel = step.name;
        coworkerAvatar = null;
      }

      const coworkerObj = step.coworkerId ? coworkers?.find(c => c.id === step.coworkerId) : null;
      const systemPrompt = [
        coworkerObj?.role ? `## Role\n${coworkerObj.role}\n` : '',
        instructionFile?.content || 'No instructions provided.',
        knowledgeContents.length > 0 ? '\n\n## Knowledge Documents\n' : '',
        ...knowledgeContents.map(k => `### ${k.name}\n${k.content}\n`),
      ].filter(Boolean).join('\n');
      const userMessage = [
        '## Case Input\n', caseInput,
        previousOutputs.length > 0 ? '\n\n## Previous Step Outputs\n' + previousOutputs.join('\n\n') : '',
        '\n\nAnalyze this case according to your instructions. Provide your assessment in clear prose with the following sections clearly labeled: Confidence Score (0.0-1.0), Status, Summary, Issues (if any), Recommended Action, and Key Facts.',
      ].join('\n');

      onMessage({ type: 'loading', label: coworkerLabel });

      const result = await callClaudeAPI(systemPrompt, userMessage);
      removeLoadingMessages();

      if (result.success) {
        onStepUpdate(runId, stepIndex, { status: 'completed', output: result.content, completedAt: Date.now() });
        onMessage({ type: 'agent', content: result.content, label: coworkerLabel, coworkerAvatar });
        previousOutputs.push(`### ${coworkerLabel}\n${result.content}`);
        const confMatch = result.content.match(/[Cc]onfidence\s*[Ss]core[:\s]*([01]?\.\d+|[01])/);
        onLog({ type: 'agent', message: `${coworkerLabel} | confidence: ${confMatch ? confMatch[1] : 'N/A'}` });
      } else {
        onStepUpdate(runId, stepIndex, { status: 'error', output: result.error });
        onRunUpdate(runId, { status: 'error', completedAt: Date.now() });
        onMessage({ type: 'error', content: `"${coworkerLabel}" error: ${result.error}` });
        onLog({ type: 'error', message: `${coworkerLabel} | "${result.error}"` });
        return;
      }
      stepIndex++;

    } else if (step.type === 'approval') {
      const correctionKey = step.id;
      if (!correctionCounts[correctionKey]) correctionCounts[correctionKey] = 0;
      const correctionsUsed = correctionCounts[correctionKey];
      const maxCorrections = step.maxCorrections || 3;

      onStepUpdate(runId, stepIndex, { status: 'waiting' });
      onRunUpdate(runId, { status: 'waiting_approval' });

      onMessage({
        type: 'approval',
        runId,
        prompt: step.prompt || 'Review and approve or reject',
        actions: step.actions || ['Approve', 'Reject', 'Request Correction', 'Escalate'],
        previousOutput: previousOutputs[previousOutputs.length - 1] || '',
        maxCorrections,
        correctionsRemaining: maxCorrections - correctionsUsed,
        resolved: false,
      });

      // Wait for human decision
      const decision = await getApprovalDecision(runId, step.id, {
        prompt: step.prompt,
        actions: step.actions || ['Approve', 'Reject', 'Request Correction', 'Escalate'],
        maxCorrections,
        correctionsUsed,
        assigneeId: step.assigneeId,
        assigneeName: step.assigneeName,
      });

      onStepUpdate(runId, stepIndex, { status: 'completed', output: `${decision.action}${decision.comment ? ': ' + decision.comment : ''}`, completedAt: Date.now() });
      onMessage({ type: 'status', content: `${decision.action}${decision.comment ? ' — "' + decision.comment + '"' : ''}` });
      onLog({ type: 'approval', message: `${userName}: ${decision.action}${decision.comment ? ' | "' + decision.comment + '"' : ''}` });

      if (decision.action === 'Reject') {
        onRunUpdate(runId, { status: 'rejected', completedAt: Date.now() });
        onMessage({ type: 'status', content: 'Workflow rejected' });
        onLog({ type: 'workflow', message: 'status: REJECTED' });
        return;
      } else if (decision.action === 'Request Correction') {
        correctionCounts[correctionKey]++;
        const targetIndex = workflow.steps.findIndex(s => s.id === step.correctionTarget);
        if (targetIndex >= 0) {
          onMessage({ type: 'status', content: `Correction requested — returning to Step ${targetIndex + 1}` });
          stepIndex = targetIndex;
          previousOutputs.length = 0;
        } else {
          stepIndex++;
        }
      } else {
        stepIndex++;
      }

    } else if (step.type === 'system' || step.type === 'tool') {
      // Try tool execution first, fall back to system simulations
      const tool = step.toolId ? tools?.find(t => t.id === step.toolId) : null;

      if (tool && executeToolFn) {
        onMessage({ type: 'loading', label: tool.name });
        const toolInput = previousOutputs.length > 0 ? previousOutputs[previousOutputs.length - 1] : caseInput;
        const result = await executeToolFn(tool, toolInput, fileTree, callClaudeAPI);
        removeLoadingMessages();
        const output = result.output || 'No output';
        onStepUpdate(runId, stepIndex, { status: result.success ? 'completed' : 'error', output, completedAt: Date.now() });
        onMessage({ type: 'system', content: `${tool.icon || '\u2699\uFE0F'} ${tool.name}: ${output}` });
        onLog({ type: 'system', message: `tool: ${tool.name} | ${result.success ? 'SUCCESS' : 'ERROR'}` });
        if (!result.success) {
          onRunUpdate(runId, { status: 'error', completedAt: Date.now() });
          return;
        }
      } else {
        // Legacy system simulation fallback
        const simulator = SYSTEM_SIMULATIONS[step.action] || SYSTEM_SIMULATIONS.update_status;
        const output = simulator();
        onStepUpdate(runId, stepIndex, { status: 'completed', output, completedAt: Date.now() });
        onMessage({ type: 'system', content: `${step.name}: ${output}` });
        onLog({ type: 'system', message: `${step.action || 'action'} | ${output.match(/[A-Z]+-\d{4}-\d{2}-\d{5}/)?.[0] || 'N/A'} | SUCCESS` });
      }
      stepIndex++;
    }
  }

  onRunUpdate(runId, { status: 'completed', completedAt: Date.now() });
  onMessage({ type: 'status', content: `Workflow "${workflow.name}" completed` });
  onLog({ type: 'workflow', message: 'status: COMPLETED' });
}
