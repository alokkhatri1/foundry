// Stage 7b (Economics) reveal surface — workshop-wide view.
//
// Every participant sees the same numbers: the room's collective LLM spend,
// broken down by segment (chat, coworker work, workflow runs, copilot),
// by participant (so everyone can see their own contribution in context),
// and as a chronological event list. The pedagogy is cohort-first — "look
// how much the whole mixed-team workshop actually cost" — not individual
// accountability.

import { useEffect, useMemo, useState } from 'react';
import { computeCost, formatUsd, formatTokens, labelForSegment } from '../utils/llmCost';
import EducationalCue from './EducationalCue';

function timeAgo(ts) {
  const diff = Math.floor((Date.now() - ts) / 1000);
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

const SEGMENT_COLORS = {
  chat: '#4a7fb5',
  coworker_chat: '#5a9e6f',
  workflow_run: '#c8956c',
  workflow_copilot: '#b87aa8',
  refine_description: '#7a9a8e',
  scorecard: '#9b9b9b',
};

export default function UsageView({ sb, participants, myParticipantId, showEducationalCues }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Seed + subscribe to every llm_usage row in this workshop. Runs for the
  // life of the view; tears down on unmount.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    sb.loadWorkshopUsage().then((data) => {
      if (cancelled) return;
      setRows(data);
      setLoading(false);
    }).catch((err) => {
      if (cancelled) return;
      setError(err?.message || 'Failed to load usage');
      setLoading(false);
    });
    const unsub = sb.subscribeToWorkshopUsage((row) => {
      setRows(prev => [...prev, row]);
    });
    return () => { cancelled = true; unsub?.(); };
  }, [sb]);

  // Participant lookup: id → display name. Falls back to a stub so stale
  // rows (participant deleted) still render.
  const participantById = useMemo(() => {
    const m = new Map();
    for (const p of (participants || [])) m.set(p.id, p);
    return m;
  }, [participants]);

  // Aggregates: overall, per-segment, per-participant.
  const agg = useMemo(() => {
    const bySeg = {};
    const byParticipant = {};
    let totalCost = 0;
    let totalTokens = 0;
    for (const r of rows) {
      const tokens = (r.input_tokens || 0) + (r.output_tokens || 0)
        + (r.cache_creation_input_tokens || 0) + (r.cache_read_input_tokens || 0);
      const cost = Number(r.cost_usd || 0);
      bySeg[r.segment] = bySeg[r.segment] || { cost: 0, tokens: 0, calls: 0 };
      bySeg[r.segment].cost += cost;
      bySeg[r.segment].tokens += tokens;
      bySeg[r.segment].calls += 1;
      const pid = r.participant_id || 'unknown';
      byParticipant[pid] = byParticipant[pid] || { cost: 0, tokens: 0, calls: 0 };
      byParticipant[pid].cost += cost;
      byParticipant[pid].tokens += tokens;
      byParticipant[pid].calls += 1;
      totalCost += cost;
      totalTokens += tokens;
    }
    return { bySeg, byParticipant, totalCost, totalTokens };
  }, [rows]);

  const segmentsInOrder = useMemo(() => {
    return Object.entries(agg.bySeg)
      .sort((a, b) => b[1].cost - a[1].cost)
      .map(([segment, v]) => ({
        segment,
        cost: v.cost,
        tokens: v.tokens,
        calls: v.calls,
        pct: agg.totalCost > 0 ? v.cost / agg.totalCost : 0,
      }));
  }, [agg]);

  const participantsInOrder = useMemo(() => {
    return Object.entries(agg.byParticipant)
      .sort((a, b) => b[1].cost - a[1].cost)
      .map(([pid, v]) => {
        const p = participantById.get(pid);
        return {
          pid,
          name: p?.name || (pid === 'unknown' ? 'Unattributed' : 'Left the workshop'),
          color: p?.color || '#9b9b9b',
          isYou: pid === myParticipantId,
          cost: v.cost,
          tokens: v.tokens,
          calls: v.calls,
          pct: agg.totalCost > 0 ? v.cost / agg.totalCost : 0,
        };
      });
  }, [agg, participantById, myParticipantId]);

  return (
    <div className="usage-view">
      <div className="usage-header">
        <h2 className="usage-title">Workshop Usage</h2>
        <EducationalCue cueId="usage-stage" show={showEducationalCues} />
        <p className="usage-sub">
          Every Claude API call the whole room has made in this workshop — how much it cost,
          where it went, who spent what.
        </p>
      </div>

      {loading ? (
        <div className="usage-loading">Loading workshop usage…</div>
      ) : error ? (
        <div className="usage-empty">
          <p><strong>Couldn't load usage data.</strong></p>
          <p className="usage-empty-sub">
            If the <code>llm_usage</code> table doesn't exist yet, apply migration 016 to this
            Supabase project and have someone make a chat — rows will start landing in realtime.
          </p>
          <p className="usage-empty-sub" style={{ marginTop: 8, opacity: 0.7 }}>{error}</p>
        </div>
      ) : rows.length === 0 ? (
        <div className="usage-empty">
          <p><strong>No spend on record yet.</strong></p>
          <p className="usage-empty-sub">
            As soon as anyone chats, builds a coworker, or runs a workflow, numbers will land
            here in realtime.
          </p>
          <p className="usage-empty-sub" style={{ marginTop: 8, opacity: 0.7 }}>
            (If the whole room's been active and this is still empty, migration 016 likely
            hasn't been applied to Supabase yet.)
          </p>
        </div>
      ) : (
        <>
          <div className="usage-totals">
            <div>
              <div className="usage-total-label">Workshop total</div>
              <div className="usage-total-cost">{formatUsd(agg.totalCost)}</div>
            </div>
            <div className="usage-total-meta">
              {formatTokens(agg.totalTokens)} tokens across {rows.length} call{rows.length === 1 ? '' : 's'}
              <br />
              {participantsInOrder.length} participant{participantsInOrder.length === 1 ? '' : 's'} contributing
            </div>
          </div>

          <div className="usage-bar-section">
            <div className="usage-bar-label">By type of work</div>
            <div className="usage-bar">
              {segmentsInOrder.map(({ segment, pct }) => (
                <div
                  key={segment}
                  className="usage-bar-chunk"
                  style={{ width: `${pct * 100}%`, background: SEGMENT_COLORS[segment] || '#888' }}
                  title={`${labelForSegment(segment)}: ${formatUsd(agg.bySeg[segment].cost)}`}
                />
              ))}
            </div>
            <div className="usage-legend">
              {segmentsInOrder.map(({ segment, cost, tokens, pct }) => (
                <div key={segment} className="usage-legend-item">
                  <span className="usage-legend-dot" style={{ background: SEGMENT_COLORS[segment] || '#888' }} />
                  <span className="usage-legend-name">{labelForSegment(segment)}</span>
                  <span className="usage-legend-cost">{formatUsd(cost)}</span>
                  <span className="usage-legend-meta">
                    {formatTokens(tokens)} tokens · {(pct * 100).toFixed(0)}%
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div className="usage-bar-section">
            <div className="usage-bar-label">By participant</div>
            <div className="usage-participant-list">
              {participantsInOrder.map(({ pid, name, color, isYou, cost, tokens, calls, pct }) => (
                <div key={pid} className={`usage-participant-row${isYou ? ' is-you' : ''}`}>
                  <span className="usage-participant-dot" style={{ background: color }} />
                  <span className="usage-participant-name">
                    {name}{isYou && <span className="usage-participant-you"> · you</span>}
                  </span>
                  <div className="usage-participant-bar">
                    <div className="usage-participant-bar-fill" style={{ width: `${pct * 100}%`, background: color }} />
                  </div>
                  <span className="usage-participant-cost">{formatUsd(cost)}</span>
                  <span className="usage-participant-meta">
                    {formatTokens(tokens)} tok · {calls} call{calls === 1 ? '' : 's'}
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div className="usage-events">
            <div className="usage-events-title">Every call across the room, newest first</div>
            <div className="usage-events-list">
              {[...rows].reverse().slice(0, 200).map(row => {
                const tokens = (row.input_tokens || 0) + (row.output_tokens || 0)
                  + (row.cache_creation_input_tokens || 0) + (row.cache_read_input_tokens || 0);
                const p = participantById.get(row.participant_id);
                return (
                  <div key={row.id} className="usage-event-row">
                    <span className="usage-event-dot" style={{ background: SEGMENT_COLORS[row.segment] || '#888' }} />
                    <span className="usage-event-seg">{labelForSegment(row.segment)}</span>
                    <span className="usage-event-who">{p?.name || '—'}</span>
                    <span className="usage-event-cost">{formatUsd(Number(row.cost_usd || 0))}</span>
                    <span className="usage-event-meta">
                      {formatTokens(tokens)} tok · {timeAgo(new Date(row.created_at).getTime())}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="usage-footnote">
            <strong>Look how cheap real work actually is.</strong> A full mixed-team workshop —
            everyone chatting, building coworkers, running workflows, co-piloting the DAG — adds up
            to the number at the top. Output tokens cost 5× input; cache reads are ~10× cheaper than
            fresh input, which is why attaching a knowledge file once and reusing it pays for itself
            fast. Nothing here stops you from starting your own AI processes tomorrow.
          </div>
        </>
      )}
    </div>
  );
}

// Live workshop total hook — used by the settings menu to show cohort
// spend at a glance. Seeds from loadWorkshopUsage, subscribes for inserts.
export function useWorkshopUsageTotal(sb) {
  const [total, setTotal] = useState(0);
  const [tokenTotal, setTokenTotal] = useState(0);

  useEffect(() => {
    let cancelled = false;
    sb.loadWorkshopUsage().then((data) => {
      if (cancelled) return;
      let c = 0, t = 0;
      for (const r of data) {
        c += Number(r.cost_usd || 0);
        t += (r.input_tokens || 0) + (r.output_tokens || 0)
          + (r.cache_creation_input_tokens || 0) + (r.cache_read_input_tokens || 0);
      }
      setTotal(c);
      setTokenTotal(t);
    });
    const unsub = sb.subscribeToWorkshopUsage((row) => {
      setTotal(prev => prev + Number(row.cost_usd || 0));
      setTokenTotal(prev => prev
        + (row.input_tokens || 0) + (row.output_tokens || 0)
        + (row.cache_creation_input_tokens || 0) + (row.cache_read_input_tokens || 0));
    });
    return () => { cancelled = true; unsub?.(); };
  }, [sb]);

  return { total, tokenTotal };
}

// Kept for any caller that still wants the per-participant total.
export function useMyUsageTotal(sb, myParticipantId) {
  const [total, setTotal] = useState(0);
  const [tokenTotal, setTokenTotal] = useState(0);

  useEffect(() => {
    if (!myParticipantId) return;
    let cancelled = false;
    sb.loadMyUsage(myParticipantId).then((data) => {
      if (cancelled) return;
      let c = 0, t = 0;
      for (const r of data) {
        c += Number(r.cost_usd || 0);
        t += (r.input_tokens || 0) + (r.output_tokens || 0)
          + (r.cache_creation_input_tokens || 0) + (r.cache_read_input_tokens || 0);
      }
      setTotal(c);
      setTokenTotal(t);
    });
    const unsub = sb.subscribeToMyUsage(myParticipantId, (row) => {
      setTotal(prev => prev + Number(row.cost_usd || 0));
      setTokenTotal(prev => prev
        + (row.input_tokens || 0) + (row.output_tokens || 0)
        + (row.cache_creation_input_tokens || 0) + (row.cache_read_input_tokens || 0));
    });
    return () => { cancelled = true; unsub?.(); };
  }, [sb, myParticipantId]);

  return { total, tokenTotal };
}

export { computeCost };
