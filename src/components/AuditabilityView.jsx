import { useEffect, useMemo, useState } from 'react';
import { runAiAuditOnRun, AUDIT_PROMPT_VERSION } from '../utils/aiAuditor';

// Stage 8 — Auditability (per-run scope).
//
// At Stage 7 the participant peer-audits at least 2 runs. At Stage 8 the
// platform shows AI's read on those same runs alongside the peer audits.
// One AI audit per run, shared across the cohort — the same run may
// already be audited by another peer's visit.
//
// If the participant has fewer than 2 peer audits we surface a prompt
// instead of running anything — the Stage's whole point is the
// comparison, and there's nothing to compare without their reading.

const MIN_PEER_AUDITS = 2;

function StatusBadge({ status }) {
  const map = {
    pending:   { label: 'Pending',   className: 'au-badge is-pending' },
    running:   { label: 'Auditing…', className: 'au-badge is-running' },
    completed: { label: 'Done',      className: 'au-badge is-done' },
    error:     { label: 'Error',     className: 'au-badge is-error' },
  };
  const cfg = map[status] || map.pending;
  return <span className={cfg.className}>{cfg.label}</span>;
}

function timeAgo(ts) {
  if (!ts) return '';
  const diff = Math.floor((Date.now() - new Date(ts).getTime()) / 1000);
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

function FindingCard({ finding, kind, author }) {
  if (!finding || !finding.observation) return null;
  return (
    <div className={`au-finding au-finding-${kind || 'ai'}`}>
      {author && <div className="au-finding-author">— {author}</div>}
      <div className="au-finding-row"><span className="au-finding-label">Noticed</span><div className="au-finding-body">{finding.observation}</div></div>
      <div className="au-finding-row"><span className="au-finding-label">Means</span><div className="au-finding-body">{finding.meaning}</div></div>
      <div className="au-finding-row"><span className="au-finding-label">Try</span><div className="au-finding-body">{finding.suggestion}</div></div>
    </div>
  );
}

function RunComparisonCard({
  run, workflow, peerAudits, aiAudit, participantsById,
  isAuditing, onRetry,
}) {
  const aiFinding = aiAudit?.findings;
  const aiStatus = aiAudit?.status || (isAuditing ? 'running' : 'pending');
  return (
    <article className="au-run-card">
      <header className="au-run-head">
        <div>
          <strong>{run.workflowName || workflow?.name || 'Run'}</strong>
          <div className="au-run-meta">
            {run.status} · {timeAgo(run.startedAt)} · {peerAudits.length} peer audit{peerAudits.length === 1 ? '' : 's'}
          </div>
        </div>
        <div className="au-run-status">
          <StatusBadge status={aiStatus} />
          {aiAudit?.status === 'error' && (
            <button type="button" className="au-rerun" onClick={() => onRetry(run.id)} disabled={isAuditing}>Retry</button>
          )}
        </div>
      </header>
      <div className="au-compare">
        <div className="au-compare-col">
          <div className="au-compare-col-head">Your peer audit</div>
          {peerAudits.length === 0 && <div className="au-empty">No peer audit on this run yet.</div>}
          {peerAudits.map(a => (
            <FindingCard
              key={a.id}
              kind="peer"
              author={participantsById?.[a.auditor_id]?.name || 'someone'}
              finding={{ observation: a.observation, meaning: a.meaning, suggestion: a.suggestion }}
            />
          ))}
        </div>
        <div className="au-compare-col">
          <div className="au-compare-col-head">AI auditor</div>
          {aiStatus === 'completed' && aiFinding?.observation
            ? <FindingCard finding={aiFinding} kind="ai" />
            : aiStatus === 'running'
              ? <div className="au-empty">AI is reading the run…</div>
              : aiStatus === 'error'
                ? <div className="au-empty">AI audit failed{aiAudit?.error ? ` — ${aiAudit.error}` : ''}.</div>
                : <div className="au-empty">AI hasn't audited this run yet.</div>}
        </div>
      </div>
    </article>
  );
}

export default function AuditabilityView({
  sb, myParticipantId, currentUserName, participants,
  workflowRuns, workflows, callClaudeAPI,
}) {
  const [aiAuditsByRun, setAiAuditsByRun] = useState({});
  const [peerAuditsByRun, setPeerAuditsByRun] = useState({});
  const [auditingRunIds, setAuditingRunIds] = useState({});
  const [loadedAi, setLoadedAi] = useState(false);
  const [loadedPeers, setLoadedPeers] = useState(false);

  // Runs the *current participant* started — the candidates for
  // comparison; we look up the participant's peer audits ON OTHER
  // people's runs separately below. The "you peer-audited two of
  // your peers' runs" pattern means we want runs the participant
  // attached audits to, not runs they themselves started.
  const myRunsAuditedByMe = useMemo(() => {
    const ids = new Set();
    for (const list of Object.values(peerAuditsByRun)) {
      for (const a of (list || [])) {
        if (a.auditor_id === myParticipantId) {
          ids.add(a.run_id);
        }
      }
    }
    return [...ids];
  }, [peerAuditsByRun, myParticipantId]);

  const runsById = useMemo(
    () => Object.fromEntries((workflowRuns || []).map(r => [r.id, r])),
    [workflowRuns]
  );
  const workflowsById = useMemo(
    () => Object.fromEntries((workflows || []).map(w => [w.id, w])),
    [workflows]
  );
  const participantsById = useMemo(
    () => Object.fromEntries((participants || []).map(p => [p.id, p])),
    [participants]
  );

  // Load all peer audits for runs in scope (every run the participant
  // can see) so we can find which they've audited and how many. This is
  // a small per-workshop fetch.
  useEffect(() => {
    if (!sb || !workflowRuns?.length) { setLoadedPeers(true); return; }
    let cancelled = false;
    Promise.all(workflowRuns.map(r => sb.loadRunAudits(r.id).then(audits => [r.id, audits || []])))
      .then(entries => {
        if (cancelled) return;
        setPeerAuditsByRun(Object.fromEntries(entries));
        setLoadedPeers(true);
      });
    return () => { cancelled = true; };
  }, [sb, workflowRuns]);

  // Load existing AI run audits for the runs the participant has
  // peer-audited.
  useEffect(() => {
    if (!sb || !loadedPeers) return;
    if (myRunsAuditedByMe.length === 0) { setLoadedAi(true); return; }
    let cancelled = false;
    sb.loadAiRunAudits(myRunsAuditedByMe).then(rows => {
      if (cancelled) return;
      setAiAuditsByRun(Object.fromEntries(rows.map(r => [r.run_id, r])));
      setLoadedAi(true);
    });
    return () => { cancelled = true; };
  }, [sb, loadedPeers, myRunsAuditedByMe.join('|')]);

  // Realtime: any new AI run audit (triggered by another participant
  // visiting the same run) flows in here.
  useEffect(() => {
    if (!sb?.subscribeToAiRunAudits) return;
    const unsub = sb.subscribeToAiRunAudits(null, (payload) => {
      const row = payload.new || payload.old;
      if (!row) return;
      setAiAuditsByRun(prev => {
        if (payload.eventType === 'DELETE') {
          const { [row.run_id]: _, ...rest } = prev;
          return rest;
        }
        return { ...prev, [row.run_id]: row };
      });
    });
    return unsub;
  }, [sb]);

  // For each run the participant peer-audited, ensure an AI audit
  // exists; kick one off if missing or stale (>2 min running, or in
  // pending/error state).
  useEffect(() => {
    if (!loadedAi || !callClaudeAPI || !sb) return;
    for (const runId of myRunsAuditedByMe) {
      const existing = aiAuditsByRun[runId];
      if (existing && existing.status === 'completed') continue;
      if (existing?.status === 'running') {
        const updatedAt = existing.updated_at ? new Date(existing.updated_at).getTime() : 0;
        if (Date.now() - updatedAt < 120_000) continue;
      }
      if (auditingRunIds[runId]) continue;
      kickoffOne(runId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadedAi, myRunsAuditedByMe.join('|'), aiAuditsByRun, callClaudeAPI, sb]);

  async function kickoffOne(runId) {
    const run = runsById[runId];
    if (!run) return;
    setAuditingRunIds(prev => ({ ...prev, [runId]: true }));
    console.log('[Auditability] runOnce starting for run', runId);
    try {
      await sb.saveAiRunAudit({
        runId, findings: {}, status: 'running',
        triggeredBy: myParticipantId, promptVersion: AUDIT_PROMPT_VERSION,
      });
      const workflow = workflowsById[run.workflowId];
      const peerAudits = peerAuditsByRun[runId] || [];
      const result = await runAiAuditOnRun({
        run, workflow, peerAudits, participantsById, callClaudeAPI,
      });
      console.log('[Auditability] AI audit returned for run', runId);
      const res = await sb.saveAiRunAudit({
        runId,
        findings: result.finding,
        status: 'completed',
        model: result.model,
        triggeredBy: myParticipantId,
        promptVersion: AUDIT_PROMPT_VERSION,
      });
      if (res.ok) setAiAuditsByRun(prev => ({ ...prev, [runId]: res.audit }));
    } catch (e) {
      console.error('[Auditability] runOnce failed for run', runId, e);
      await sb.saveAiRunAudit({
        runId, findings: {}, status: 'error',
        error: e.message || String(e),
        triggeredBy: myParticipantId,
        promptVersion: AUDIT_PROMPT_VERSION,
      });
    } finally {
      setAuditingRunIds(prev => {
        const { [runId]: _, ...rest } = prev;
        return rest;
      });
    }
  }

  function handleRetry(runId) {
    if (auditingRunIds[runId]) return;
    kickoffOne(runId);
  }

  const myAuditCount = myRunsAuditedByMe.length;
  const ready = loadedPeers && myAuditCount >= MIN_PEER_AUDITS;

  return (
    <div className="au-page">
      <div className="au-page-inner">
        <header className="au-page-head">
          <div>
            <div className="au-eyebrow"><span className="au-eyebrow-dot" />STAGE 8 · AUDITABILITY</div>
            <h1 className="au-page-title">Two reads on the same run — <em>side by side</em>.</h1>
            <p className="au-page-sub">
              For every run you peer-audited at Stage 7, the platform reads the same run and writes its own audit.
              Where do they agree? Where do they pull apart? That gap is the lesson.
            </p>
          </div>
        </header>

        {!ready && loadedPeers && (
          <div className="au-gate">
            <div className="au-gate-title">
              {myAuditCount === 0
                ? 'Audit at least two peer runs at Stage 7 to unlock the comparison here.'
                : `One more peer audit at Stage 7 unlocks the comparison.`}
            </div>
            <div className="au-gate-sub">
              You've audited <strong>{myAuditCount}</strong> of {MIN_PEER_AUDITS}. Open Observability and pick another peer's run to audit.
            </div>
          </div>
        )}

        {ready && (
          <section className="au-section">
            {myRunsAuditedByMe.map(runId => {
              const run = runsById[runId];
              if (!run) return null;
              const peerAuditsHere = (peerAuditsByRun[runId] || []).filter(a => a.auditor_id === myParticipantId);
              return (
                <RunComparisonCard
                  key={runId}
                  run={run}
                  workflow={workflowsById[run.workflowId]}
                  peerAudits={peerAuditsHere}
                  aiAudit={aiAuditsByRun[runId]}
                  participantsById={participantsById}
                  isAuditing={!!auditingRunIds[runId]}
                  onRetry={handleRetry}
                />
              );
            })}
          </section>
        )}
      </div>
    </div>
  );
}
