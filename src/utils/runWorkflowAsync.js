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
  onSaveStepOutput,     // ({stepName, content, name, destination}) => void — per-step save when step.save.enabled
}) {
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
        // Per-step save: if this coworker step is configured to save, write its
        // output to the configured folder now.
        if (step.save?.enabled && onSaveStepOutput) {
          const fileName = (step.name || coworkerLabel || 'step').toLowerCase().replace(/[^a-z0-9]+/g, '-') + '-' + new Date().toISOString().slice(0, 10) + '.md';
          onSaveStepOutput({
            stepName: step.name || coworkerLabel,
            content: `# ${step.name || coworkerLabel}\n\n${result.content}`,
            name: fileName,
            destination: { folderId: step.save.folderId, subfolder: step.save.subfolder },
          });
          onLog({ type: 'workflow', message: `saved step output: ${fileName}` });
        }
      } else {
        onStepUpdate(runId, stepIndex, { status: 'error', output: result.error });
        onRunUpdate(runId, { status: 'error', completedAt: Date.now() });
        onMessage({ type: 'error', content: `"${coworkerLabel}" error: ${result.error}` });
        onLog({ type: 'error', message: `${coworkerLabel} | "${result.error}"` });
        return;
      }
      stepIndex++;

    } else if (step.type === 'approval') {
      onStepUpdate(runId, stepIndex, { status: 'waiting' });
      onRunUpdate(runId, { status: 'waiting_approval' });

      onMessage({
        type: 'approval',
        runId,
        prompt: step.prompt || 'Review the upstream output and approve or reject with feedback',
        actions: ['Approve', 'Reject'],
        previousOutput: previousOutputs[previousOutputs.length - 1] || '',
        resolved: false,
      });

      // Wait for human decision
      const decision = await getApprovalDecision(runId, step.id, {
        prompt: step.prompt,
        actions: ['Approve', 'Reject'],
        assigneeId: step.assigneeId,
        assigneeName: step.assigneeName,
      });

      onStepUpdate(runId, stepIndex, { status: 'completed', output: `${decision.action}${decision.comment ? ': ' + decision.comment : ''}`, completedAt: Date.now() });
      onMessage({ type: 'status', content: `${decision.action}${decision.comment ? ' — "' + decision.comment + '"' : ''}` });
      onLog({ type: 'approval', message: `${userName}: ${decision.action}${decision.comment ? ' | "' + decision.comment + '"' : ''}` });

      // Per-step save on Approve: save the upstream output at the moment of
      // approval (the version this reviewer signed off on).
      if (decision.action === 'Approve' && step.save?.enabled && onSaveStepOutput) {
        const approved = previousOutputs[previousOutputs.length - 1] || '';
        const fileName = (step.name || 'approved').toLowerCase().replace(/[^a-z0-9]+/g, '-') + '-' + new Date().toISOString().slice(0, 10) + '.md';
        onSaveStepOutput({
          stepName: step.name,
          content: `# ${step.name} — approved by ${decision.resolvedBy || userName}\n\n${approved}`,
          name: fileName,
          destination: { folderId: step.save.folderId, subfolder: step.save.subfolder },
        });
        onLog({ type: 'workflow', message: `saved approved output: ${fileName}` });
      }

      if (decision.action === 'Reject') {
        // Bounce back to the previous human step for revision. Downstream
        // coworker steps between there and here will re-run with the
        // reviewer's feedback woven into context. If there was no previous
        // human step, this is a final reject — nothing upstream to bounce
        // to.
        let prevHumanIdx = -1;
        for (let i = stepIndex - 1; i >= 0; i--) {
          if (workflow.steps[i].type === 'approval') { prevHumanIdx = i; break; }
        }
        if (prevHumanIdx < 0) {
          onRunUpdate(runId, { status: 'rejected', completedAt: Date.now() });
          onMessage({ type: 'status', content: `Workflow finally rejected (no previous human to revise with)` });
          onLog({ type: 'workflow', message: 'status: FINAL_REJECTED' });
          return;
        }
        // Append the rejection feedback so re-running coworker steps see it.
        const feedbackNote = `### ${step.name} — rejected by ${decision.resolvedBy || 'reviewer'}\n${decision.comment || '(no feedback given)'}`;
        previousOutputs.push(feedbackNote);
        onMessage({ type: 'status', content: `Rejected — bouncing back to Step ${prevHumanIdx + 1} (${workflow.steps[prevHumanIdx].name}) for revision` });
        onLog({ type: 'workflow', message: `bounce to step ${prevHumanIdx + 1}` });
        stepIndex = prevHumanIdx;
      } else {
        stepIndex++;
      }

    } else {
      // Unknown step type (legacy tool/system). Skip silently — leftovers
      // from a previous schema that shouldn't exist in new workflows.
      stepIndex++;
    }
  }

  onRunUpdate(runId, { status: 'completed', completedAt: Date.now() });
  onMessage({ type: 'status', content: `Workflow "${workflow.name}" completed` });
  onLog({ type: 'workflow', message: 'status: COMPLETED' });
}
