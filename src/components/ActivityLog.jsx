import { useEffect, useRef } from 'react';
import EducationalCue from './EducationalCue';

function formatTime(ts) {
  const d = new Date(ts);
  return d.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function LogEntry({ entry }) {
  const typeClass = {
    agent: 'log-type-agent',
    approval: 'log-type-approval',
    system: 'log-type-system',
    workflow: 'log-type-workflow',
    error: 'log-type-error',
  }[entry.type] || 'log-type-workflow';

  return (
    <div className="log-entry">
      <span className="log-time">[{formatTime(entry.timestamp)}]</span>{' '}
      <span className={typeClass}>{entry.type.toUpperCase()}</span>{' '}
      <span>| {entry.message}</span>
    </div>
  );
}

export default function ActivityLog({ logs, showEducationalCues }) {
  const bodyRef = useRef(null);

  useEffect(() => {
    if (bodyRef.current) {
      bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
    }
  }, [logs.length]);

  return (
    <div className="activity-log">
      <div className="activity-log-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span>Observability Log</span>
          <EducationalCue cueId="activity-audit-log" show={showEducationalCues} />
        </div>
        <span>{logs.length} entries</span>
      </div>
      <div className="activity-log-body" ref={bodyRef}>
        {logs.length === 0 && (
          <div style={{ color: '#5a5048', padding: '8px 0' }}>Nothing to observe yet. Run an orchestration or send a message.</div>
        )}
        {logs.map((entry, i) => (
          <LogEntry key={i} entry={entry} />
        ))}
      </div>
    </div>
  );
}
