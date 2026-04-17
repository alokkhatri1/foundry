// Clean SVG icons for timeline steps
function StepIcon({ action }) {
  const color = 'var(--text-muted)';
  const s = 14;
  const props = { width: s, height: s, viewBox: '0 0 16 16', fill: 'none', stroke: color, strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round' };

  switch (action) {
    case 'List Files':
    case 'Read File':
      return <svg {...props}><path d="M2 4v9h12V6H8.5L7 4H2z" /><line x1="5" y1="9" x2="11" y2="9" /></svg>;
    case 'Create File':
      return <svg {...props}><path d="M3 2h6l4 4v8H3V2z" /><line x1="7" y1="7" x2="7" y2="11" /><line x1="5" y1="9" x2="9" y2="9" /></svg>;
    case 'Update File':
      return <svg {...props}><path d="M3 2h6l4 4v8H3V2z" /><path d="M7 8l2 2-2 2" /></svg>;
    case 'List Tools':
    case 'Configure Tool':
      return <svg {...props}><circle cx="8" cy="8" r="3" /><path d="M8 1v2M8 13v2M1 8h2M13 8h2M3 3l1.5 1.5M11.5 11.5L13 13M3 13l1.5-1.5M11.5 4.5L13 3" /></svg>;
    case 'Add Connector':
      return <svg {...props}><circle cx="5" cy="8" r="3" /><circle cx="11" cy="8" r="3" /><line x1="8" y1="8" x2="8" y2="8" /></svg>;
    case 'List Coworkers':
    case 'Create Coworker':
      return <svg {...props}><circle cx="8" cy="5" r="2.5" /><path d="M3 14c0-3 2.5-5 5-5s5 2 5 5" /></svg>;
    case 'List Workflows':
    case 'Create Workflow':
      return <svg {...props}><rect x="2" y="2" width="5" height="4" rx="1" /><rect x="9" y="10" width="5" height="4" rx="1" /><path d="M4.5 6v2c0 1 1 2 2 2h3c1 0 2 1 2 2v0" /></svg>;
    case 'Run Workflow':
      return <svg {...props}><polygon points="5,2 13,8 5,14" fill={color} stroke="none" /></svg>;
    default:
      return <svg {...props}><circle cx="8" cy="8" r="2" fill={color} stroke="none" /></svg>;
  }
}

const ACTION_LABELS = {
  'List Files': 'Looked up files',
  'Read File': 'Read file',
  'Create File': 'Created file',
  'Update File': 'Updated file',
  'List Tools': 'Checked tools',
  'Add Connector': 'Added connector',
  'Configure Tool': 'Configured tool',
  'List Coworkers': 'Checked coworkers',
  'Create Coworker': 'Created coworker',
  'List Workflows': 'Checked workflows',
  'Create Workflow': 'Created workflow',
  'Run Workflow': 'Started workflow',
};

function summarize(msg) {
  const label = ACTION_LABELS[msg.toolName] || msg.toolName;
  const input = msg.inputs || {};

  // Build a concise summary from the action + key input
  if (msg.toolName === 'Create File' && input.name) return `Created "${input.name}"`;
  if (msg.toolName === 'Update File' && input.file_name) return `Updated "${input.file_name}"`;
  if (msg.toolName === 'Read File' && input.file_name) return `Read "${input.file_name}"`;
  if (msg.toolName === 'Create Coworker' && input.name) return `Created coworker "${input.name}"`;
  if (msg.toolName === 'Create Workflow' && input.name) return `Created workflow "${input.name}"`;
  if (msg.toolName === 'Run Workflow' && input.workflow_name) return `Started "${input.workflow_name}"`;
  if (msg.toolName === 'Add Connector' && (input.name || input.provider)) return `Added connector "${input.name || input.provider}"`;
  if (msg.toolName === 'Configure Tool' && input.tool_name) return `Configured "${input.tool_name}"`;
  if (msg.toolName === 'List Files') return 'Searched files';
  if (msg.toolName === 'List Coworkers') return 'Checked coworkers';
  if (msg.toolName === 'List Workflows') return 'Checked workflows';
  if (msg.toolName === 'List Tools') return 'Checked connectors';

  return label;
}

export default function ToolExecutionCard({ msg }) {
  const isError = msg.outputs?.success === false;
  const text = summarize(msg);

  return (
    <div className="tec-step">
      <div className="tec-step-rail">
        <div className="tec-step-dot"><StepIcon action={msg.toolName} /></div>
        <div className="tec-step-line" />
      </div>
      <div className={`tec-step-label${isError ? ' error' : ''}`}>{text}</div>
    </div>
  );
}
