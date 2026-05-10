import { useEffect, useMemo, useState } from 'react';
import { gatherParticipantArtefacts, runAiAudit, AUDIT_PROMPT_VERSION } from '../utils/aiAuditor';

// Stage 8 — Auditability. The platform reads everything the participant
// has produced, writes structured findings, and shows them alongside any
// peer audits that already exist on the participant's runs. The lesson
// is the comparison: where AI's read agrees with peers, where they pull
// apart.
//
// The audit kicks off on first open if none exists; subsequent visits
// just render the cached findings. A "Re-run" button is available if
// the participant wants a fresh pass after they've added more work.

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

function FindingCard({ finding, kind }) {
  if (!finding) return null;
  return (
    <div className={`au-finding au-finding-${kind || 'overall'}`}>
      <div className="au-finding-row">
        <span className="au-finding-label">Noticed</span>
        <div className="au-finding-body">{finding.observation}</div>
      </div>
      <div className="au-finding-row">
        <span className="au-finding-label">Means</span>
        <div className="au-finding-body">{finding.meaning}</div>
      </div>
      <div className="au-finding-row">
        <span className="au-finding-label">Try</span>
        <div className="au-finding-body">{finding.suggestion}</div>
      </div>
    </div>
  );
}

// For a run, render AI's finding + any peer audits side by side. The
// diff-style layout is the heart of the comparison view: it forces the
// participant to read both at once rather than collapsing to one read.
function RunComparisonCard({ run, aiFinding, peerAudits, participantsById }) {
  return (
    <article className="au-run-card">
      <header className="au-run-head">
        <strong>{run.name}</strong>
        <span className="au-run-meta">{run.status}{peerAudits.length > 0 ? ` · ${peerAudits.length} peer audit${peerAudits.length === 1 ? '' : 's'}` : ' · no peer audits yet'}</span>
      </header>
      <div className="au-compare">
        <div className="au-compare-col">
          <div className="au-compare-col-head">AI auditor</div>
          {aiFinding ? <FindingCard finding={aiFinding} kind="ai" /> : <div className="au-empty">AI didn't audit this run.</div>}
        </div>
        <div className="au-compare-col">
          <div className="au-compare-col-head">Peer audits</div>
          {peerAudits.length === 0 && <div className="au-empty">No peers have audited this run yet.</div>}
          {peerAudits.map(a => {
            const auditor = participantsById?.[a.auditor_id]?.name || 'someone';
            return (
              <div key={a.id} className="au-finding au-finding-peer">
                <div className="au-finding-author">— {auditor}</div>
                <div className="au-finding-row"><span className="au-finding-label">Noticed</span><div className="au-finding-body">{a.observation}</div></div>
                <div className="au-finding-row"><span className="au-finding-label">Means</span><div className="au-finding-body">{a.meaning}</div></div>
                <div className="au-finding-row"><span className="au-finding-label">Try</span><div className="au-finding-body">{a.suggestion}</div></div>
              </div>
            );
          })}
        </div>
      </div>
    </article>
  );
}

function ArtefactCard({ artefact, finding }) {
  const kindLabel = {
    file: 'File',
    coworker: 'Coworker',
    workflow: 'Workflow',
  }[artefact.kind] || artefact.kind;
  return (
    <article className="au-art-card">
      <header className="au-art-head">
        <span className="au-art-kind">{kindLabel}</span>
        <strong className="au-art-name">{artefact.name}</strong>
      </header>
      {finding
        ? <FindingCard finding={finding} kind="ai" />
        : <div className="au-empty">AI didn't write a finding for this artefact.</div>}
    </article>
  );
}

export default function AuditabilityView({
  sb, myParticipantId, currentUserName, participants,
  workflowRuns, workflows, coworkers, flatFiles, callClaudeAPI,
}) {
  const [audit, setAudit] = useState(null);
  const [loaded, setLoaded] = useState(false);
  const [running, setRunning] = useState(false);
  const [err, setErr] = useState(null);
  const [peerAuditsByRun, setPeerAuditsByRun] = useState({});

  // Load existing audit + all peer audits on the participant's own runs
  // when the tab opens. Realtime keeps both in sync.
  useEffect(() => {
    if (!myParticipantId || !sb) return;
    let cancelled = false;
    sb.loadMyAiAudit(myParticipantId).then(row => {
      if (cancelled) return;
      setAudit(row);
      setLoaded(true);
    });
    return () => { cancelled = true; };
  }, [myParticipantId, sb]);

  // Pull peer audits for the participant's runs so we can compare.
  useEffect(() => {
    if (!sb || !workflowRuns?.length || !currentUserName) return;
    const myRuns = workflowRuns.filter(r => r.startedBy === currentUserName);
    let cancelled = false;
    Promise.all(myRuns.map(r => sb.loadRunAudits(r.id).then(audits => [r.id, audits || []])))
      .then(entries => {
        if (cancelled) return;
        setPeerAuditsByRun(Object.fromEntries(entries));
      });
    return () => { cancelled = true; };
  }, [sb, workflowRuns, currentUserName]);

  // Kick off the AI audit on first open if none exists. Idempotent —
  // existing audit (any status) blocks the auto-run; participant can
  // explicitly Re-run to force.
  useEffect(() => {
    if (!loaded || audit || running || !myParticipantId || !callClaudeAPI) return;
    runOnce();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, audit, running, myParticipantId, callClaudeAPI]);

  async function runOnce() {
    if (running) return;
    setRunning(true);
    setErr(null);
    try {
      // Mark pending in the table immediately so other clients (admin,
      // facilitator) see the audit was triggered even if the call takes
      // a moment.
      await sb.saveAiAudit({
        participantId: myParticipantId,
        findings: {},
        status: 'running',
        promptVersion: AUDIT_PROMPT_VERSION,
      });
      const artefacts = gatherParticipantArtefacts({
        userName: currentUserName, flatFiles, coworkers, workflows, workflowRuns,
      });
      const result = await runAiAudit({ artefacts, callClaudeAPI });
      // Token + cost bookkeeping is already in llm_usage via callClaudeAPI's
      // existing path (segment='ai_audit'); the ai_audits row records the
      // findings and the model used, not the per-call usage detail.
      const res = await sb.saveAiAudit({
        participantId: myParticipantId,
        findings: result.findings,
        status: 'completed',
        model: result.model,
        promptVersion: AUDIT_PROMPT_VERSION,
      });
      if (res.ok) setAudit(res.audit);
    } catch (e) {
      console.error('[AuditabilityView] runOnce failed', e);
      setErr(e.message || String(e));
      await sb.saveAiAudit({
        participantId: myParticipantId,
        findings: {},
        status: 'error',
        error: e.message || String(e),
        promptVersion: AUDIT_PROMPT_VERSION,
      });
    } finally {
      setRunning(false);
    }
  }

  // Index findings by (kind,id) so each artefact card can pick up its
  // matching finding cheaply.
  const findingByKey = useMemo(() => {
    const out = {};
    for (const f of (audit?.findings?.per_artifact || [])) {
      out[`${f.kind}:${f.id}`] = f;
    }
    return out;
  }, [audit]);

  const participantsById = useMemo(
    () => Object.fromEntries((participants || []).map(p => [p.id, p])),
    [participants]
  );

  const myRuns = useMemo(
    () => (workflowRuns || []).filter(r => r.startedBy === currentUserName),
    [workflowRuns, currentUserName]
  );
  const myWorkflows = useMemo(
    () => (workflows || []).filter(w => w.createdBy === currentUserName),
    [workflows, currentUserName]
  );
  const myCoworkers = useMemo(
    () => (coworkers || []).filter(c => c.createdBy === currentUserName),
    [coworkers, currentUserName]
  );
  const myFiles = useMemo(
    () => (flatFiles || []).filter(f => f.type === 'file' && f.createdBy === currentUserName),
    [flatFiles, currentUserName]
  );

  const status = audit?.status || (running ? 'running' : 'pending');
  const overall = audit?.findings?.overall;

  return (
    <div className="au-page">
      <header className="au-page-head">
        <div>
          <div className="au-eyebrow"><span className="au-eyebrow-dot" />STAGE 8 · AUDITABILITY</div>
          <h1 className="au-page-title">Two reads on your work — <em>side by side</em>.</h1>
          <p className="au-page-sub">
            The platform reads everything you produced and writes its own audit.
            Below, AI's read sits next to peer audits on the same runs. Where do they agree?
            Where do they pull apart? That gap is the lesson.
          </p>
        </div>
        <div className="au-page-actions">
          <StatusBadge status={status} />
          {status === 'completed' && (
            <button type="button" className="au-rerun" onClick={runOnce} disabled={running}>
              {running ? 'Re-running…' : 'Re-run audit'}
            </button>
          )}
          {status === 'error' && (
            <button type="button" className="au-rerun" onClick={runOnce} disabled={running}>
              Try again
            </button>
          )}
        </div>
      </header>

      {err && <div className="au-error">{err}</div>}

      {status === 'running' && (
        <div className="au-loading">
          The AI auditor is reading your work — files, coworkers, workflows, runs. This usually takes 30–60 seconds.
        </div>
      )}

      {status === 'completed' && (
        <>
          {overall && (
            <section className="au-overall">
              <div className="au-section-head">Overall — AI's read across everything you built</div>
              <FindingCard finding={overall} kind="overall" />
            </section>
          )}

          {myRuns.length > 0 && (
            <section className="au-section">
              <div className="au-section-head">Runs — peer vs. AI</div>
              {myRuns.map(r => (
                <RunComparisonCard
                  key={r.id}
                  run={{ name: r.workflowName, status: r.status }}
                  aiFinding={findingByKey[`run:${r.id}`]}
                  peerAudits={peerAuditsByRun[r.id] || []}
                  participantsById={participantsById}
                />
              ))}
            </section>
          )}

          {myWorkflows.length > 0 && (
            <section className="au-section">
              <div className="au-section-head">Workflows you authored</div>
              {myWorkflows.map(w => (
                <ArtefactCard
                  key={w.id}
                  artefact={{ kind: 'workflow', id: w.id, name: w.name }}
                  finding={findingByKey[`workflow:${w.id}`]}
                />
              ))}
            </section>
          )}

          {myCoworkers.length > 0 && (
            <section className="au-section">
              <div className="au-section-head">Coworkers you built</div>
              {myCoworkers.map(c => (
                <ArtefactCard
                  key={c.id}
                  artefact={{ kind: 'coworker', id: c.id, name: c.name }}
                  finding={findingByKey[`coworker:${c.id}`]}
                />
              ))}
            </section>
          )}

          {myFiles.length > 0 && (
            <section className="au-section">
              <div className="au-section-head">Files you wrote</div>
              {myFiles.map(f => (
                <ArtefactCard
                  key={f.id}
                  artefact={{ kind: 'file', id: f.id, name: f.name }}
                  finding={findingByKey[`file:${f.id}`]}
                />
              ))}
            </section>
          )}
        </>
      )}
    </div>
  );
}
