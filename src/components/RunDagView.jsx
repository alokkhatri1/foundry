// Read-only React Flow view for a workflow run.
//
// Renders the same DAG shape the Orchestration canvas shows, but each node is
// coloured by its run state and edges actually traversed during this run are
// bolded in gold while untraversed edges fade. This is the Observability
// payoff — the run's path through the DAG made visible, not a flat step list.

import { useMemo, useCallback } from 'react';
import ReactFlow, { Background, Controls, MiniMap, Handle, Position } from 'reactflow';
import 'reactflow/dist/style.css';
import { formatUsd } from '../utils/llmCost';

const NODE_STATE_COLOR = {
  completed: { bg: '#e8f4ec', border: '#5a9e6f', text: '#2f5f3e' },
  running:   { bg: '#e8f0f8', border: '#4a7fb5', text: '#2d4e73' },
  waiting:   { bg: '#fdf0e6', border: '#c8956c', text: '#7a5130' },
  error:     { bg: '#fdf0f0', border: '#c45c5c', text: '#7a2d2d' },
  skipped:   { bg: '#f4f1ec', border: '#c9c2b8', text: '#888' },
  pending:   { bg: '#ffffff', border: '#d4ccc2', text: '#888' },
};

const STATUS_GLYPH = {
  completed: '\u2713',
  running:   '\u25CF',
  waiting:   '\u25CB',
  error:     '\u2715',
  skipped:   '\u2014',
  pending:   '\u25CB',
};

// ===== Node wrappers =====
// One visual per step type. They all share the same state-based colouring;
// the type just drives the label and shape. These are intentionally simpler
// than the Orchestration canvas nodes — no inline editor, no drag handle.

function RunNode({ data }) {
  const { step, label, role, selected, cost } = data;
  const state = step?.status || 'pending';
  const cfg = NODE_STATE_COLOR[state] || NODE_STATE_COLOR.pending;
  const isTrigger = step?.type === 'trigger';
  const isReview = step?.type === 'approval';

  return (
    <div
      className={`run-node${selected ? ' selected' : ''}`}
      style={{
        background: cfg.bg,
        borderColor: cfg.border,
        color: cfg.text,
      }}
    >
      {!isTrigger && <Handle type="target" position={Position.Top} id="in" />}
      <div className="run-node-top">
        <span className="run-node-glyph" style={{ background: cfg.border }}>
          {STATUS_GLYPH[state] || '?'}
        </span>
        <span className="run-node-role">{role}</span>
      </div>
      <div className="run-node-label">{label}</div>
      <div className="run-node-meta">
        {step?.durationMs != null && step.status === 'completed' && (
          <span className="run-node-duration">{formatDuration(step.durationMs)}</span>
        )}
        {cost != null && cost > 0 && (
          <span className="run-node-cost">{formatUsd(cost)}</span>
        )}
      </div>
      {isReview ? (
        <>
          <Handle type="source" position={Position.Bottom} id="approved" style={{ left: '30%' }} />
          <Handle type="source" position={Position.Bottom} id="rejected" style={{ left: '70%' }} />
        </>
      ) : (
        <Handle type="source" position={Position.Bottom} id="out" />
      )}
    </div>
  );
}

function formatDuration(ms) {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60_000)}m ${Math.floor((ms % 60_000) / 1000)}s`;
}

const NODE_TYPES = {
  trigger: RunNode,
  agent: RunNode,
  approval: RunNode,
};

// ===== Edge styling =====
// If we can figure out which edges the run actually traversed, bold those
// and fade the rest. Traversal = both endpoint steps completed AND the
// edge's handle matches the source step's outcome (for Review: approved
// vs rejected; otherwise always traversed forward when both sides ran).

function computeTraversedEdges(workflow, run) {
  const traversed = new Set();
  const stepById = new Map((run.stepResults || []).map(s => [s.stepId, s]));
  for (const edge of (workflow.edges || [])) {
    const src = stepById.get(edge.source);
    const tgt = stepById.get(edge.target);
    if (!src || !tgt) continue;
    // Both endpoints must have run (completed, or at least reached waiting)
    const srcRan = ['completed', 'running', 'waiting', 'error'].includes(src.status);
    const tgtRan = ['completed', 'running', 'waiting', 'error'].includes(tgt.status);
    if (!srcRan || !tgtRan) continue;
    // Review branches: only the handle matching the decision counts.
    if (edge.sourceHandle === 'approved' || edge.sourceHandle === 'rejected') {
      const approvalRow = (run.approvals || []).find(a => a.step_id === edge.source);
      const decision = approvalRow?.action === 'Approve' ? 'approved' : approvalRow?.action === 'Reject' ? 'rejected' : null;
      if (decision && decision !== edge.sourceHandle) continue;
    }
    traversed.add(edge.id);
  }
  return traversed;
}

// ===== Main component =====

export default function RunDagView({ workflow, run, selectedStepId, onSelectStep, costByStepId }) {
  const { nodes, edges } = useMemo(() => {
    if (!workflow || !run) return { nodes: [], edges: [] };
    const steps = workflow.steps || [];
    const positions = new Map((workflow.nodes || []).map(n => [n.id, n.position]));
    const stepResultById = new Map((run.stepResults || []).map(s => [s.stepId, s]));

    // Compute duration ms per completed step so the node can show it.
    const stepRunMeta = new Map();
    for (const sr of (run.stepResults || [])) {
      if (sr.completedAt && sr.startedAt) {
        stepRunMeta.set(sr.stepId, { durationMs: sr.completedAt - sr.startedAt });
      }
    }

    const nextNodes = steps.map((step, i) => {
      const sr = stepResultById.get(step.id);
      const meta = stepRunMeta.get(step.id) || {};
      const label = step.type === 'trigger'
        ? 'Trigger'
        : step.type === 'approval'
          ? (sr?.assigneeName || step.name || 'Review')
          : (sr?.coworkerName || step.name || 'Coworker');
      const role = step.type === 'trigger' ? 'Input' : step.type === 'approval' ? 'Review' : 'Coworker';
      return {
        id: step.id,
        type: step.type,
        position: positions.get(step.id) || { x: 80, y: i * 180 },
        draggable: false,
        selectable: true,
        data: {
          step: { ...sr, type: step.type, durationMs: meta.durationMs },
          label,
          role,
          selected: step.id === selectedStepId,
          cost: costByStepId ? (costByStepId[step.id] || 0) : null,
        },
      };
    });

    const traversed = computeTraversedEdges(workflow, run);
    const nextEdges = (workflow.edges || []).map(e => {
      const wasTraversed = traversed.has(e.id);
      const isRejected = e.sourceHandle === 'rejected';
      return {
        ...e,
        style: {
          stroke: wasTraversed ? (isRejected ? '#c45c5c' : '#c8956c') : '#e0d9cf',
          strokeWidth: wasTraversed ? 2.5 : 1.5,
          strokeDasharray: isRejected ? '5 4' : undefined,
          opacity: wasTraversed ? 1 : 0.5,
        },
        animated: false,
      };
    });

    return { nodes: nextNodes, edges: nextEdges };
  }, [workflow, run, selectedStepId, costByStepId]);

  const handleNodeClick = useCallback((_evt, node) => {
    onSelectStep?.(node.id);
  }, [onSelectStep]);

  return (
    <div className="run-dag-view">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={NODE_TYPES}
        onNodeClick={handleNodeClick}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable
        fitView
        fitViewOptions={{ padding: 0.2, maxZoom: 1 }}
        proOptions={{ hideAttribution: true }}
      >
        <Background gap={20} size={1} color="#d4ccc2" />
        <Controls showInteractive={false} />
        <MiniMap
          nodeColor={(n) => {
            const state = n.data?.step?.status || 'pending';
            return NODE_STATE_COLOR[state]?.border || '#d4ccc2';
          }}
          nodeStrokeWidth={2}
          maskColor="rgba(250, 247, 242, 0.6)"
          pannable
          zoomable
          style={{ background: 'var(--bg-white)', border: '1px solid var(--border-color)', borderRadius: 6 }}
        />
      </ReactFlow>
    </div>
  );
}
