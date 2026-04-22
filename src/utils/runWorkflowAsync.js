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

function nodeLabel(step) {
  if (!step) return 'Node';
  if (step.type === 'trigger') return 'Case Input';
  if (step.type === 'agent') return step.coworker?.name || step.name || 'Coworker';
  if (step.type === 'capture') return step.name || 'Capture';
  return step.name || 'Review';
}

/**
 * Execute a workflow run asynchronously.
 * Each call operates independently — multiple can run concurrently.
 *
 * Phase 6 runtime: event-driven traversal of the wired DAG starting at the
 * Trigger. Each node enqueues its downstream forward neighbors (edges with
 * sourceHandle !== 'rejected'). On Review → Reject, the runtime follows any
 * wired 'rejected' edges, resetting state for the nodes it lands on plus
 * their forward descendants so they re-execute with the rejection feedback
 * threaded into context. Falls back to scanning execution history for a
 * previous Review if no 'rejected' edge is wired.
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
  onCapture,            // ({fileId, coworkerId, content, runId}) => void — terminal append for capture steps
}) {
  const steps = workflow.steps || [];
  const indexById = new Map(steps.map((s, i) => [s.id, i]));
  const stepById = new Map(steps.map(s => [s.id, s]));

  // Split edges by handle: forward ones drive the normal flow; rejected ones
  // are only consulted when a Review step rejects. Forward edges are
  // guaranteed acyclic (cycle prevention on the canvas enforces it); rejected
  // edges can loop back to form explicit revision cycles.
  const forwardOut = new Map();
  const forwardIn = new Map();
  const rejectedOut = new Map();
  for (const e of (workflow.edges || [])) {
    if (e.sourceHandle === 'rejected') {
      if (!rejectedOut.has(e.source)) rejectedOut.set(e.source, []);
      rejectedOut.get(e.source).push(e);
    } else {
      if (!forwardOut.has(e.source)) forwardOut.set(e.source, []);
      forwardOut.get(e.source).push(e);
      if (!forwardIn.has(e.target)) forwardIn.set(e.target, []);
      forwardIn.get(e.target).push(e);
    }
  }

  const triggerStep = steps.find(s => s.type === 'trigger');
  if (!triggerStep) {
    onMessage({ type: 'error', content: 'Workflow has no Trigger node — cannot run.' });
    onRunUpdate(runId, { status: 'error', completedAt: Date.now() });
    return;
  }

  // Forward-reachability from trigger. Anything outside this set is either
  // unwired or only reachable via rejected edges (which fire dynamically).
  const forwardReachable = new Set();
  (function walk(id) {
    if (forwardReachable.has(id)) return;
    forwardReachable.add(id);
    for (const e of (forwardOut.get(id) || [])) walk(e.target);
  })(triggerStep.id);

  for (let i = 0; i < steps.length; i++) {
    if (!forwardReachable.has(steps[i].id) && !rejectedOut.has(steps[i].id)
        && !Array.from(rejectedOut.values()).flat().some(e => e.target === steps[i].id)) {
      // Truly stranded: no forward edge touches it and no rejected edge
      // points at it either. Mark skipped so it doesn't sit on 'pending'.
      onStepUpdate(runId, i, { status: 'skipped' });
    }
  }

  onMessage({ type: 'user', content: caseInput });
  onMessage({ type: 'status', content: `Workflow "${workflow.name}" started by ${userName}` });
  onLog({ type: 'workflow', message: `started by ${userName} | workflow: ${workflow.name}` });

  const executed = new Map(); // nodeId → { output }
  const executionLog = []; // ordered list of node ids as executed (includes re-runs after reject)
  const revisionNotes = [];

  // Enqueued but not-yet-run nodes. Order of processing is FIFO, with
  // deferral when predecessors haven't finished yet.
  let queue = [triggerStep.id];

  // Every iteration dequeues one node; if its forward predecessors aren't
  // all executed, it's pushed to the back. If the entire queue is unready
  // (no progress possible), we break out to avoid spinning.
  while (queue.length > 0) {
    const nodeId = queue.shift();
    if (executed.has(nodeId)) continue;

    const fPreds = forwardIn.get(nodeId) || [];
    const ready = fPreds.every(e => executed.has(e.source));
    if (!ready) {
      queue.push(nodeId);
      if (queue.every(id => {
        if (executed.has(id)) return true;
        const ps = forwardIn.get(id) || [];
        return !ps.every(e => executed.has(e.source));
      })) {
        // No node in the queue can advance — stuck.
        break;
      }
      continue;
    }

    const step = stepById.get(nodeId);
    const stepIndex = indexById.get(nodeId);

    onRunUpdate(runId, { currentStepIndex: stepIndex, status: 'running' });

    if (step.type === 'trigger') {
      executed.set(nodeId, { output: caseInput });
      executionLog.push(nodeId);
      onStepUpdate(runId, stepIndex, { status: 'completed', output: caseInput, completedAt: Date.now() });
      for (const e of (forwardOut.get(nodeId) || [])) queue.push(e.target);
      continue;
    }

    onStepUpdate(runId, stepIndex, { status: 'running' });

    const predBlocks = fPreds.map(e => {
      const srcStep = stepById.get(e.source);
      const out = executed.get(e.source)?.output ?? '';
      return `### ${nodeLabel(srcStep)}\n${out}`;
    });
    const displayNum = executionLog.filter(id => stepById.get(id)?.type !== 'trigger').length + 1;
    onMessage({ type: 'status', content: `Step ${displayNum}: ${nodeLabel(step)}` });

    if (step.type === 'agent') {
      const coworker = step.coworker
        || (step.coworkerId ? coworkers?.find(c => c.id === step.coworkerId) : null);
      if (!coworker || !coworker.name?.trim()) {
        onStepUpdate(runId, stepIndex, { status: 'error', output: 'Coworker not configured' });
        onRunUpdate(runId, { status: 'error', completedAt: Date.now() });
        onMessage({ type: 'error', content: `Coworker step "${step.name}" has no coworker configured.` });
        onLog({ type: 'error', message: `${step.name} | coworker not configured` });
        return;
      }
      const instrFiles = (coworker.instructionFileIds || []).map(id => findNode(fileTree, id)).filter(Boolean);
      const instructionFile = instrFiles.length > 0 ? { content: instrFiles.map(f => f.content).join('\n\n') } : null;
      const knowledgeContents = (coworker.knowledgeFileIds || []).map(id => findNode(fileTree, id)).filter(Boolean);
      const coworkerLabel = coworker.name;
      const coworkerAvatar = coworker.avatar;

      const systemPrompt = [
        coworker?.role ? `## Role\n${coworker.role}\n` : '',
        instructionFile?.content || 'No instructions provided.',
        knowledgeContents.length > 0 ? '\n\n## Knowledge Documents\n' : '',
        ...knowledgeContents.map(k => `### ${k.name}\n${k.content}\n`),
      ].filter(Boolean).join('\n');
      const userMessage = [
        '## Case Input\n', caseInput,
        predBlocks.length > 0 ? '\n\n## Upstream Outputs\n' + predBlocks.join('\n\n') : '',
        revisionNotes.length > 0 ? '\n\n## Revision Feedback\n' + revisionNotes.join('\n\n') : '',
        '\n\nAnalyze this case according to your instructions. Provide your assessment in clear prose with the following sections clearly labeled: Confidence Score (0.0-1.0), Status, Summary, Issues (if any), Recommended Action, and Key Facts.',
      ].join('\n');

      onMessage({ type: 'loading', label: coworkerLabel });
      const result = await callClaudeAPI(systemPrompt, userMessage, {
        segment: 'workflow_run',
        segmentRefId: `${runId}:${step.id}`,
      });
      removeLoadingMessages();

      if (!result.success) {
        onStepUpdate(runId, stepIndex, { status: 'error', output: result.error });
        onRunUpdate(runId, { status: 'error', completedAt: Date.now() });
        onMessage({ type: 'error', content: `"${coworkerLabel}" error: ${result.error}` });
        onLog({ type: 'error', message: `${coworkerLabel} | "${result.error}"` });
        return;
      }

      executed.set(nodeId, { output: result.content });
      executionLog.push(nodeId);
      onStepUpdate(runId, stepIndex, { status: 'completed', output: result.content, completedAt: Date.now() });
      onMessage({ type: 'agent', content: result.content, label: coworkerLabel, coworkerAvatar });
      const confMatch = result.content.match(/[Cc]onfidence\s*[Ss]core[:\s]*([01]?\.\d+|[01])/);
      onLog({ type: 'agent', message: `${coworkerLabel} | confidence: ${confMatch ? confMatch[1] : 'N/A'}` });

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

      for (const e of (forwardOut.get(nodeId) || [])) queue.push(e.target);

    } else if (step.type === 'approval') {
      onStepUpdate(runId, stepIndex, { status: 'waiting' });
      onRunUpdate(runId, { status: 'waiting_approval' });

      const upstreamDraft = predBlocks.join('\n\n---\n\n');

      onMessage({
        type: 'approval',
        runId,
        prompt: step.prompt || 'Review the upstream output and approve or reject with feedback',
        actions: ['Approve', 'Reject'],
        previousOutput: upstreamDraft,
        resolved: false,
      });

      const decision = await getApprovalDecision(runId, step.id, {
        prompt: step.prompt,
        actions: ['Approve', 'Reject'],
        assigneeId: step.assigneeId,
        assigneeName: step.assigneeName,
      });

      onStepUpdate(runId, stepIndex, { status: 'completed', output: `${decision.action}${decision.comment ? ': ' + decision.comment : ''}`, completedAt: Date.now() });
      onMessage({ type: 'status', content: `${decision.action}${decision.comment ? ' — "' + decision.comment + '"' : ''}` });
      onLog({ type: 'approval', message: `${userName}: ${decision.action}${decision.comment ? ' | "' + decision.comment + '"' : ''}` });

      if (decision.action === 'Approve' && step.save?.enabled && onSaveStepOutput) {
        const fileName = (step.name || 'approved').toLowerCase().replace(/[^a-z0-9]+/g, '-') + '-' + new Date().toISOString().slice(0, 10) + '.md';
        onSaveStepOutput({
          stepName: step.name,
          content: `# ${step.name} — approved by ${decision.resolvedBy || userName}\n\n${upstreamDraft}`,
          name: fileName,
          destination: { folderId: step.save.folderId, subfolder: step.save.subfolder },
        });
        onLog({ type: 'workflow', message: `saved approved output: ${fileName}` });
      }

      if (decision.action === 'Approve') {
        executed.set(nodeId, { output: upstreamDraft });
        executionLog.push(nodeId);
        for (const e of (forwardOut.get(nodeId) || [])) queue.push(e.target);
        continue;
      }

      // REJECT branch ------------------------------------------------------
      const feedbackNote = `### ${nodeLabel(step)} — rejected by ${decision.resolvedBy || 'reviewer'}\n${decision.comment || '(no feedback given)'}`;
      revisionNotes.push(feedbackNote);

      const rejectedEdges = rejectedOut.get(nodeId) || [];
      let bounceTargets;

      if (rejectedEdges.length > 0) {
        // Explicit wired rejection paths — follow them.
        bounceTargets = rejectedEdges.map(e => e.target);
        onMessage({ type: 'status', content: `Rejected — following wired revision path to ${bounceTargets.map(t => nodeLabel(stepById.get(t))).join(', ')}` });
        onLog({ type: 'workflow', message: `rejected → wired path(s): ${bounceTargets.join(',')}` });
      } else {
        // No wired rejected edge — fall back to the most recently executed
        // Review before this one (Phase 5 bounce-back behavior).
        let prevReviewId = null;
        for (let i = executionLog.length - 1; i >= 0; i--) {
          const pid = executionLog[i];
          if (pid !== nodeId && stepById.get(pid)?.type === 'approval' && executed.has(pid)) {
            prevReviewId = pid;
            break;
          }
        }
        if (!prevReviewId) {
          onRunUpdate(runId, { status: 'rejected', completedAt: Date.now() });
          onMessage({ type: 'status', content: `Workflow finally rejected (no previous human to revise with, no rejected path wired)` });
          onLog({ type: 'workflow', message: 'status: FINAL_REJECTED' });
          return;
        }
        bounceTargets = [prevReviewId];
        const bounceDisplayNum = executionLog.slice(0, executionLog.indexOf(prevReviewId))
          .filter(id => stepById.get(id)?.type !== 'trigger').length + 1;
        onMessage({ type: 'status', content: `Rejected — bouncing back to Step ${bounceDisplayNum} (${nodeLabel(stepById.get(prevReviewId))}) for revision` });
        onLog({ type: 'workflow', message: `bounce to step ${bounceDisplayNum}` });
      }

      // Clear state for every bounce target and every forward-descendant of
      // each, plus the rejecting Review itself (so it re-executes after the
      // upstream nodes rerun). The clear wipes their execution record and
      // resets UI status back to 'pending'.
      const toClear = new Set([nodeId]);
      const collect = (id) => {
        if (toClear.has(id)) return;
        toClear.add(id);
        for (const e of (forwardOut.get(id) || [])) collect(e.target);
      };
      for (const t of bounceTargets) collect(t);

      for (const id of toClear) {
        executed.delete(id);
        onStepUpdate(runId, indexById.get(id), { status: 'pending', output: null, completedAt: null });
      }

      // Re-enqueue bounce targets to drive the revision loop.
      queue = [...bounceTargets];
    } else if (step.type === 'capture') {
      // Capture: terminal append. Takes the upstream output and writes it
      // into a workspace file (and optionally wires that file into a
      // coworker's knowledge). Runs stop here — no downstream edges.
      const upstream = predBlocks.join('\n\n---\n\n');
      if (!step.targetFileId) {
        // Soft-land: unconfigured Capture is a no-op, not an error. Lets the
        // rest of the run complete so participants can iterate without
        // configuring Capture upfront.
        const summary = 'Not configured — nothing captured';
        executed.set(nodeId, { output: summary });
        executionLog.push(nodeId);
        onStepUpdate(runId, stepIndex, { status: 'completed', output: summary, completedAt: Date.now() });
        onMessage({ type: 'status', content: `${nodeLabel(step)}: no target file picked — skipping capture this run` });
        onLog({ type: 'workflow', message: `${nodeLabel(step)} | skipped (no target)` });
        continue;
      }

      if (onCapture) {
        try {
          await onCapture({
            fileId: step.targetFileId,
            coworkerId: step.targetCoworkerId || null,
            mode: step.mode || 'knowledge',
            content: upstream,
            runId,
            runName: workflow.name,
          });
        } catch (err) {
          onStepUpdate(runId, stepIndex, { status: 'error', output: err?.message || 'Capture failed' });
          onMessage({ type: 'error', content: `Capture failed: ${err?.message || err}` });
          onLog({ type: 'error', message: `${nodeLabel(step)} | capture failed: ${err?.message || err}` });
          executed.set(nodeId, { output: '' });
          executionLog.push(nodeId);
          continue;
        }
      }

      const summary = (step.mode || 'knowledge') === 'skills'
        ? 'Refined coworker instructions'
        : `Appended to workspace${step.targetCoworkerId ? ' + grew coworker knowledge' : ''}`;
      executed.set(nodeId, { output: summary });
      executionLog.push(nodeId);
      onStepUpdate(runId, stepIndex, { status: 'completed', output: summary, completedAt: Date.now() });
      onMessage({ type: 'status', content: `Captured: ${summary}` });
      onLog({ type: 'workflow', message: `capture → file ${step.targetFileId}${step.targetCoworkerId ? ` + coworker ${step.targetCoworkerId}` : ''}` });
    } else {
      // Unknown step type — skip.
      executed.set(nodeId, { output: '' });
      executionLog.push(nodeId);
    }
  }

  onRunUpdate(runId, { status: 'completed', completedAt: Date.now() });
  onMessage({ type: 'status', content: `Workflow "${workflow.name}" completed` });
  onLog({ type: 'workflow', message: 'status: COMPLETED' });
}
