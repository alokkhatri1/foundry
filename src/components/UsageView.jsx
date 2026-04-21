// Stage 7b (Economics) reveal surface.
//
// The participant sees, for the first time, a running total of their LLM
// spend for this workshop. Broken down by segment (chat, coworker_chat,
// workflow_run, workflow_copilot, etc.) and as a chronological event list.
// Numbers have been ticking silently since Stage 1; this is where they
// become visible.

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

// Color coding mirrors the rest of the platform — gold for the headline,
// muted tones per segment so the stacked bar reads clean at a glance.
const SEGMENT_COLORS = {
  chat: '#4a7fb5',
  coworker_chat: '#5a9e6f',
  workflow_run: '#c8956c',
  workflow_copilot: '#b87aa8',
  refine_description: '#7a9a8e',
  scorecard: '#9b9b9b',
};

export default function UsageView({ sb, myParticipantId, showEducationalCues }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);

  // Seed with whatever's already on file, then keep current via realtime —
  // same pattern the rest of the platform uses. Seed runs once per
  // participantId change; realtime runs for the duration of the view.
  useEffect(() => {
    if (!myParticipantId) { setLoading(false); return; }
    let cancelled = false;
    setLoading(true);
    sb.loadMyUsage(myParticipantId).then((data) => {
      if (cancelled) return;
      setRows(data);
      setLoading(false);
    });
    const unsub = sb.subscribeToMyUsage(myParticipantId, (row) => {
      setRows(prev => [...prev, row]);
    });
    return () => { cancelled = true; unsub?.(); };
  }, [sb, myParticipantId]);

  const totals = useMemo(() => {
    const byCost = {};
    const byTokens = {};
    let totalCost = 0;
    let totalTokens = 0;
    for (const r of rows) {
      const tokens = (r.input_tokens || 0) + (r.output_tokens || 0)
        + (r.cache_creation_input_tokens || 0) + (r.cache_read_input_tokens || 0);
      byCost[r.segment] = (byCost[r.segment] || 0) + Number(r.cost_usd || 0);
      byTokens[r.segment] = (byTokens[r.segment] || 0) + tokens;
      totalCost += Number(r.cost_usd || 0);
      totalTokens += tokens;
    }
    return { byCost, byTokens, totalCost, totalTokens };
  }, [rows]);

  const segmentsInOrder = useMemo(() => {
    return Object.entries(totals.byCost)
      .sort((a, b) => b[1] - a[1])
      .map(([segment, cost]) => ({
        segment,
        cost,
        tokens: totals.byTokens[segment] || 0,
        pct: totals.totalCost > 0 ? cost / totals.totalCost : 0,
      }));
  }, [totals]);

  return (
    <div className="usage-view">
      <div className="usage-header">
        <h2 className="usage-title">Your AI Usage</h2>
        <EducationalCue cueId="usage-stage" show={showEducationalCues} />
        <p className="usage-sub">
          Every Claude API call you've made in this workshop — what you spent, and where it went.
        </p>
      </div>

      {loading ? (
        <div className="usage-loading">Loading your usage…</div>
      ) : rows.length === 0 ? (
        <div className="usage-empty">
          <p><strong>No spend on record yet.</strong></p>
          <p className="usage-empty-sub">Have a chat, build a coworker, run a workflow — numbers will land here in realtime.</p>
        </div>
      ) : (
        <>
          <div className="usage-totals">
            <div className="usage-total-cost">{formatUsd(totals.totalCost)}</div>
            <div className="usage-total-tokens">
              {formatTokens(totals.totalTokens)} tokens across {rows.length} call{rows.length === 1 ? '' : 's'}
            </div>
          </div>

          <div className="usage-bar-section">
            <div className="usage-bar-label">How you spent it</div>
            <div className="usage-bar">
              {segmentsInOrder.map(({ segment, pct }) => (
                <div
                  key={segment}
                  className="usage-bar-chunk"
                  style={{ width: `${pct * 100}%`, background: SEGMENT_COLORS[segment] || '#888' }}
                  title={`${labelForSegment(segment)}: ${formatUsd(totals.byCost[segment])}`}
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

          <div className="usage-events">
            <div className="usage-events-title">Every call, newest first</div>
            <div className="usage-events-list">
              {[...rows].reverse().slice(0, 200).map(row => {
                const tokens = (row.input_tokens || 0) + (row.output_tokens || 0)
                  + (row.cache_creation_input_tokens || 0) + (row.cache_read_input_tokens || 0);
                return (
                  <div key={row.id} className="usage-event-row">
                    <span className="usage-event-dot" style={{ background: SEGMENT_COLORS[row.segment] || '#888' }} />
                    <span className="usage-event-seg">{labelForSegment(row.segment)}</span>
                    <span className="usage-event-cost">{formatUsd(Number(row.cost_usd || 0))}</span>
                    <span className="usage-event-meta">
                      {formatTokens(tokens)} tokens · {timeAgo(new Date(row.created_at).getTime())}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="usage-footnote">
            <strong>How the math works.</strong> Output tokens cost 5× input. Cache reads are ~10×
            cheaper than fresh input — which is why attaching the same knowledge file to many runs
            adds up so much less than you'd think. Every tool call, every revision round, every
            system prompt with a long skills file folds into these numbers.
          </div>
        </>
      )}
    </div>
  );
}

// Lightweight live-total hook used by the header chip. Mirrors the
// UsageView seed + subscribe pattern so both surfaces tick together.
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

// Keep computeCost in scope for callers that want to live-mirror
// a cost calc without re-importing. Re-exports are cheap in JS.
export { computeCost };
