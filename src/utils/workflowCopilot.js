// Workflow Copilot — chat-driven DAG construction.
//
// A participant describes the workflow they want in natural language; Claude
// replies with a mix of narration + tool calls that mutate the workflow state.
// The canvas re-renders live because the mutations flow through the existing
// onUpdateWorkflow path (same as drag-and-drop edits).

// ===== Tool schemas =====
// These go to Claude as the callable surface. The underlying implementations
// live in applyCopilotTool below. Keep the descriptions prescriptive — Claude
// needs to know WHEN to pick each tool, not just what it does.

const COPILOT_TOOL_SCHEMAS = [
  {
    name: 'set_trigger_input',
    description: 'Set the case-input text on the Trigger node — the description of what the workflow processes when someone runs it. Use this first if the user describes the scenario.',
    input_schema: {
      type: 'object',
      properties: {
        description: { type: 'string', description: 'The case or task input the workflow will process' },
      },
      required: ['description'],
    },
  },
  {
    name: 'add_coworker_node',
    description: 'Add a Coworker step to the DAG that references an existing saved coworker from the library. The coworkerName must exactly match one of the available coworkers. Returns the new node id — use it in connect_nodes.',
    input_schema: {
      type: 'object',
      properties: {
        coworkerName: { type: 'string', description: 'Exact name of a coworker from the available list' },
      },
      required: ['coworkerName'],
    },
  },
  {
    name: 'add_review_node',
    description: 'Add a human Review step. The workflow pauses here until the assignee approves or rejects. assigneeName must be an online human. Returns the new node id.',
    input_schema: {
      type: 'object',
      properties: {
        assigneeName: { type: 'string', description: 'Exact name of an online human from the workshop' },
        prompt: { type: 'string', description: 'Short note telling the reviewer what to decide on (e.g. "Approve the risk memo?")' },
      },
      required: ['assigneeName', 'prompt'],
    },
  },
  {
    name: 'connect_nodes',
    description: 'Draw an edge from one node to another. For Review nodes, edgeType selects the output handle: "approved" (default) or "rejected". For other nodes, omit edgeType.',
    input_schema: {
      type: 'object',
      properties: {
        fromNodeId: { type: 'string' },
        toNodeId: { type: 'string' },
        edgeType: { type: 'string', description: 'approved | rejected (Review nodes only)' },
      },
      required: ['fromNodeId', 'toNodeId'],
    },
  },
  {
    name: 'delete_node',
    description: 'Remove a node and all edges connected to it. Use only to correct a mistake from earlier in this conversation.',
    input_schema: {
      type: 'object',
      properties: { nodeId: { type: 'string' } },
      required: ['nodeId'],
    },
  },
];

// ===== Tool executor =====
// Pure functions on workflow — take current state + input, return new state.
// Errors flow back to Claude as tool_result with is_error:true so it can recover.

function nextPosition(workflow) {
  const nodes = workflow.nodes || [];
  const steps = workflow.steps || [];
  const nonTrigger = nodes.filter(n => {
    const step = steps.find(s => s.id === n.id);
    return step?.type !== 'trigger';
  });
  const count = nonTrigger.length;
  // Simple grid: stagger x between two columns, step y down each time.
  return { x: 80 + (count % 2) * 340, y: 220 + count * 180 };
}

function genCopilotNodeId() {
  return 'step-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6);
}

function applyCopilotTool(name, input, workflow, ctx) {
  switch (name) {
    case 'set_trigger_input': {
      const triggerIdx = (workflow.steps || []).findIndex(s => s.type === 'trigger');
      if (triggerIdx === -1) return { error: 'No trigger step exists on this workflow.' };
      const steps = [...workflow.steps];
      steps[triggerIdx] = { ...steps[triggerIdx], caseInput: input.description };
      return {
        workflow: { ...workflow, steps },
        result: `Trigger input set to: "${input.description}"`,
      };
    }
    case 'add_coworker_node': {
      const target = (input.coworkerName || '').trim().toLowerCase();
      const cw = (ctx.coworkers || []).find(c => (c.name || '').trim().toLowerCase() === target);
      if (!cw) {
        const available = (ctx.coworkers || []).map(c => c.name).filter(Boolean).join(', ') || '(none)';
        return { error: `No coworker named "${input.coworkerName}". Available: ${available}` };
      }
      const id = genCopilotNodeId();
      const newStep = { id, type: 'agent', name: cw.name, coworkerId: cw.id };
      const newNode = { id, type: 'agent', position: nextPosition(workflow) };
      return {
        workflow: {
          ...workflow,
          steps: [...(workflow.steps || []), newStep],
          nodes: [...(workflow.nodes || []), newNode],
        },
        result: `Added Coworker "${cw.name}" as node ${id}.`,
        nodeId: id,
      };
    }
    case 'add_review_node': {
      const target = (input.assigneeName || '').trim().toLowerCase();
      const human = (ctx.participants || []).find(p =>
        (p.name || '').trim().toLowerCase() === target && (p.kind || 'human') === 'human'
      );
      if (!human) {
        const available = (ctx.participants || [])
          .filter(p => (p.kind || 'human') === 'human' && p.online)
          .map(p => p.name).filter(Boolean).join(', ') || '(no one online)';
        return { error: `No online human named "${input.assigneeName}". Online: ${available}` };
      }
      const id = genCopilotNodeId();
      const newStep = {
        id,
        type: 'approval',
        name: 'Review',
        assigneeId: human.id,
        prompt: input.prompt,
        actions: ['Approve', 'Reject'],
      };
      const newNode = { id, type: 'approval', position: nextPosition(workflow) };
      return {
        workflow: {
          ...workflow,
          steps: [...(workflow.steps || []), newStep],
          nodes: [...(workflow.nodes || []), newNode],
        },
        result: `Added Review (assignee ${human.name}) as node ${id}.`,
        nodeId: id,
      };
    }
    case 'connect_nodes': {
      const { fromNodeId, toNodeId, edgeType } = input;
      const steps = workflow.steps || [];
      if (fromNodeId === toNodeId) return { error: 'Cannot connect a node to itself.' };
      const fromStep = steps.find(s => s.id === fromNodeId);
      if (!fromStep) return { error: `No node "${fromNodeId}" — check node ids from previous tool results.` };
      if (!steps.find(s => s.id === toNodeId)) return { error: `No node "${toNodeId}" — check node ids from previous tool results.` };
      let sourceHandle = 'out';
      if (fromStep.type === 'approval') {
        sourceHandle = edgeType === 'rejected' ? 'rejected' : 'approved';
      }
      const alreadyWired = (workflow.edges || []).some(e =>
        e.source === fromNodeId && e.target === toNodeId && (e.sourceHandle || 'out') === sourceHandle
      );
      if (alreadyWired) return { error: `Edge ${fromNodeId} → ${toNodeId} (${sourceHandle}) already exists.` };
      const newEdge = {
        id: `edge-${fromNodeId}-${toNodeId}-${Date.now()}`,
        source: fromNodeId,
        target: toNodeId,
        sourceHandle,
        targetHandle: 'in',
      };
      return {
        workflow: { ...workflow, edges: [...(workflow.edges || []), newEdge] },
        result: `Connected ${fromNodeId} → ${toNodeId}${fromStep.type === 'approval' ? ` (${sourceHandle})` : ''}.`,
      };
    }
    case 'delete_node': {
      const { nodeId } = input;
      if (!(workflow.steps || []).find(s => s.id === nodeId)) return { error: `No node "${nodeId}".` };
      return {
        workflow: {
          ...workflow,
          steps: (workflow.steps || []).filter(s => s.id !== nodeId),
          nodes: (workflow.nodes || []).filter(n => n.id !== nodeId),
          edges: (workflow.edges || []).filter(e => e.source !== nodeId && e.target !== nodeId),
        },
        result: `Deleted node ${nodeId}.`,
      };
    }
    default:
      return { error: `Unknown tool: ${name}` };
  }
}

// ===== System prompt =====
// Feeds Claude the current workflow + real lists of coworkers/humans/files so
// it can't invent ids. Every turn rebuilds this from fresh state.

function summarizeWorkflow(workflow) {
  const steps = workflow.steps || [];
  const edges = workflow.edges || [];
  const stepLines = steps.map(s => {
    if (s.type === 'trigger') return `- [trigger ${s.id}] caseInput: ${s.caseInput ? `"${s.caseInput}"` : '(empty)'}`;
    if (s.type === 'agent') return `- [coworker ${s.id}] ${s.name || '(no name)'}${s.coworkerId ? ` (library ref ${s.coworkerId})` : ''}`;
    if (s.type === 'approval') return `- [review ${s.id}] assigneeId=${s.assigneeId || '(none)'} prompt="${s.prompt || ''}"`;
    return `- [${s.type} ${s.id}]`;
  });
  const edgeLines = edges.map(e => `- ${e.source} → ${e.target}${e.sourceHandle && e.sourceHandle !== 'out' ? ` (${e.sourceHandle})` : ''}`);
  return `NODES:\n${stepLines.join('\n') || '(none)'}\n\nEDGES:\n${edgeLines.join('\n') || '(none)'}`;
}

function buildCopilotSystemPrompt({ workflow, coworkers, participants }) {
  const cwLines = (coworkers || [])
    .filter(c => c.name?.trim())
    .map(c => `- ${c.name}${c.role ? ` — ${c.role.slice(0, 120)}` : ''}`)
    .join('\n') || '(no coworkers saved yet — tell the user to create one in the Coworkers tab)';

  const humanLines = (participants || [])
    .filter(p => (p.kind || 'human') === 'human')
    .map(p => `- ${p.name}${p.online ? ' (online)' : ' (offline)'}`)
    .join('\n') || '(no humans in the workshop yet)';

  return `You are the Workflow Copilot. The user describes the workflow they want; you build the DAG by calling tools.

## How this works
- The workflow is a DAG with three node types: Trigger (the case input), Coworker (an AI step), Review (a human approval gate).
- You cannot type into the canvas — every change goes through a tool call.
- After each tool you call, the canvas updates live. You will see the new state on the next turn.
- Narrate briefly ("Adding Ravi as the first step…") before each tool call so the user can follow along.

## Hard rules
- Only reference coworkers, humans, and nodes that are listed below or in a previous tool result. Never invent names or ids.
- Node ids are returned by add_* tools. Capture them from the tool result and use them in connect_nodes.
- Keep the DAG acyclic on forward edges. The only legal cycle is a Review's "rejected" output wired back to an upstream node — that's the revision loop.
- When the user describes a sequence (A then B then review then C), add every node first, then connect them in order.
- Prefer existing saved coworkers from the library. If the user describes a coworker that doesn't exist, tell them to build it in the Coworkers tab — don't try to create it inline.

## Available saved coworkers
${cwLines}

## Workshop humans (use these exact names for Review assignees)
${humanLines}

## Current workflow state
${summarizeWorkflow(workflow)}
`;
}

// ===== Main entry — one copilot turn =====
// Handles the full agentic loop for a single user message: repeatedly calls
// Claude, executes any tool_use blocks, feeds results back, until Claude stops
// calling tools. Each intermediate narration fires onNarration so the chat
// panel can show progress. Each successful mutation fires onWorkflowUpdate.

export async function runCopilotTurn({
  apiKey,
  userMessage,
  conversationHistory,
  workflow,
  coworkers,
  participants,
  onWorkflowUpdate,
  onNarration,
  onError,
}) {
  if (!apiKey) {
    onError?.('No API key configured. Add VITE_ANTHROPIC_API_KEY to .env.');
    return { updatedHistory: conversationHistory, updatedWorkflow: workflow };
  }

  const messages = [
    ...conversationHistory,
    { role: 'user', content: userMessage },
  ];
  let currentWorkflow = workflow;
  const ctx = { coworkers, participants };

  let turns = 0;
  const MAX_TURNS = 10;

  while (turns < MAX_TURNS) {
    turns++;
    const systemPrompt = buildCopilotSystemPrompt({ workflow: currentWorkflow, coworkers, participants });

    let data;
    try {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true',
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 2000,
          system: systemPrompt,
          messages,
          tools: COPILOT_TOOL_SCHEMAS,
        }),
      });
      if (!response.ok) {
        const errorText = await response.text().catch(() => '');
        onError?.(`Claude API ${response.status}: ${errorText.slice(0, 200)}`);
        return { updatedHistory: messages, updatedWorkflow: currentWorkflow };
      }
      data = await response.json();
    } catch (err) {
      onError?.(`Network error: ${err.message}`);
      return { updatedHistory: messages, updatedWorkflow: currentWorkflow };
    }

    const content = data.content || [];
    const textBlocks = content.filter(c => c.type === 'text');
    const toolUseBlocks = content.filter(c => c.type === 'tool_use');

    for (const tb of textBlocks) {
      if (tb.text?.trim()) onNarration?.(tb.text);
    }

    messages.push({ role: 'assistant', content });

    if (toolUseBlocks.length === 0 || data.stop_reason === 'end_turn') {
      break;
    }

    const toolResults = [];
    for (const tu of toolUseBlocks) {
      const res = applyCopilotTool(tu.name, tu.input, currentWorkflow, ctx);
      if (res.error) {
        toolResults.push({ type: 'tool_result', tool_use_id: tu.id, content: res.error, is_error: true });
      } else {
        currentWorkflow = res.workflow;
        onWorkflowUpdate?.(currentWorkflow);
        const resultText = res.nodeId
          ? `${res.result} (nodeId: ${res.nodeId})`
          : res.result;
        toolResults.push({ type: 'tool_result', tool_use_id: tu.id, content: resultText });
      }
    }

    messages.push({ role: 'user', content: toolResults });
  }

  return { updatedHistory: messages, updatedWorkflow: currentWorkflow };
}
