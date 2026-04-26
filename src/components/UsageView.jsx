// Stage 8 (Economics) reveal surface — workshop-wide view.
//
// Every participant sees the same numbers: the room's collective LLM spend,
// broken down by segment (chat, coworker work, workflow runs, copilot),
// by participant (so everyone can see their own contribution in context),
// and as a chronological event list. The pedagogy is cohort-first — "look
// how much the whole mixed-team workshop actually cost" — not individual
// accountability.

import { useEffect, useMemo, useState } from 'react';
import { computeCost, formatTokens, costToCredits } from '../utils/llmCost';
import EducationalCue from './EducationalCue';

export default function UsageView({ sb, participants, myParticipantId, showEducationalCues, creditAllocation }) {
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

  // Workshop credit pool — total available across the room, used so far,
  // remaining. Allocation is per-participant; total = allocation × humans.
  // Bonuses aren't aggregated into the pool view (they're per-person and
  // not loaded into the participants prop) — workshop total reflects the
  // baseline allocation, which is the budget the facilitator set.
  const workshopCredits = useMemo(() => {
    const humans = (participants || []).filter(p => (p.kind || 'human') === 'human');
    const total = creditAllocation != null ? creditAllocation * humans.length : 0;
    const used = costToCredits(agg.totalCost);
    const remaining = Math.max(0, total - used);
    return { total, used, remaining, humans: humans.length };
  }, [participants, creditAllocation, agg.totalCost]);

  // Leaderboard — every human participant in the room, sorted by tokens
  // descending. Includes participants with zero usage so the cohort
  // picture is honest. Token count is the metric, not cost — high tokens
  // = your AI did a lot of work on your behalf (the token-maxing frame).
  const leaderboard = useMemo(() => {
    const humans = (participants || []).filter(p => (p.kind || 'human') === 'human');
    return humans.map(p => {
      const v = agg.byParticipant[p.id] || { cost: 0, tokens: 0, calls: 0 };
      return {
        pid: p.id,
        name: p.name,
        color: p.color,
        isYou: p.id === myParticipantId,
        tokens: v.tokens,
        cost: v.cost,
        calls: v.calls,
      };
    }).sort((a, b) => b.tokens - a.tokens);
  }, [participants, agg.byParticipant, myParticipantId]);

  const maxTokens = leaderboard[0]?.tokens || 0;

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
          {/* Section 1 — workshop-wide credit pool. Total across the
              cohort, used so far, remaining. The bar gives a quick read
              of how much of the room's budget has been spent. */}
          <div className="usage-pool">
            <div className="usage-pool-title">Total available credits</div>
            <div className="usage-pool-stats">
              <div className="usage-pool-stat">
                <div className="usage-pool-stat-label">Total</div>
                <div className="usage-pool-stat-value">{workshopCredits.total.toLocaleString()}</div>
              </div>
              <div className="usage-pool-stat">
                <div className="usage-pool-stat-label">Used</div>
                <div className="usage-pool-stat-value">{workshopCredits.used.toLocaleString()}</div>
              </div>
              <div className="usage-pool-stat">
                <div className="usage-pool-stat-label">Remaining</div>
                <div className="usage-pool-stat-value">{workshopCredits.remaining.toLocaleString()}</div>
              </div>
            </div>
            <div className="usage-pool-bar">
              <div
                className="usage-pool-bar-fill"
                style={{ width: workshopCredits.total > 0
                  ? `${Math.min(100, (workshopCredits.used / workshopCredits.total) * 100).toFixed(1)}%`
                  : '0%' }}
              />
            </div>
            <div className="usage-pool-meta">
              {workshopCredits.humans} participant{workshopCredits.humans === 1 ? '' : 's'}
              {creditAllocation != null && <> × {creditAllocation.toLocaleString()} credits each</>}
            </div>
          </div>

          {/* Section 2 — leaderboard, every human in the room ranked by
              tokens used. Leader at the top — the participant who put
              their AI to the most work. Token count is the metric: more
              tokens means more work the AI did on the participant's
              behalf, not a bigger bill to apologise for. */}
          <div className="usage-leaderboard">
            <div className="usage-leaderboard-header">
              <div className="usage-leaderboard-title">Leaderboard</div>
              <div className="usage-leaderboard-sub">Ranked by tokens used — most token-maxing at the top.</div>
            </div>
            <div className="usage-leaderboard-list">
              {leaderboard.map((p, i) => {
                const rank = i + 1;
                const pct = maxTokens > 0 ? p.tokens / maxTokens : 0;
                const isLeader = rank === 1 && p.tokens > 0;
                return (
                  <div
                    key={p.pid}
                    className={`usage-leader-row${p.isYou ? ' is-you' : ''}${isLeader ? ' is-leader' : ''}`}
                  >
                    <span className="usage-leader-rank">#{rank}</span>
                    <span className="usage-leader-dot" style={{ background: p.color }} />
                    <span className="usage-leader-name">
                      {p.name}{p.isYou && <span className="usage-leader-you"> · you</span>}
                    </span>
                    <div className="usage-leader-bar">
                      <div className="usage-leader-bar-fill" style={{ width: `${pct * 100}%`, background: p.color }} />
                    </div>
                    <span className="usage-leader-tokens">{formatTokens(p.tokens)}</span>
                    <span className="usage-leader-meta">{p.calls} call{p.calls === 1 ? '' : 's'}</span>
                  </div>
                );
              })}
              {leaderboard.length === 0 && (
                <div className="usage-leader-empty">No participants in the room yet.</div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// Row-tokens helper shared by both usage hooks.
function rowTokens(r) {
  return (r.input_tokens || 0) + (r.output_tokens || 0)
    + (r.cache_creation_input_tokens || 0) + (r.cache_read_input_tokens || 0);
}

// Live workshop total hook — used by the settings menu to show cohort
// spend at a glance. Seeds from loadWorkshopUsage, subscribes for inserts.
//
// Dedup by row id: the initial SELECT and the realtime subscription can
// return the same row (race: an INSERT that happens between the SELECT
// snapshot and the subscription-ready window gets picked up by both).
// Before this guard, affected users had their spend double-counted and
// credits ran out early. Tracking seen ids makes the accumulation
// idempotent regardless of arrival order.
export function useWorkshopUsageTotal(sb) {
  const [total, setTotal] = useState(0);
  const [tokenTotal, setTokenTotal] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const seenIds = new Set();

    function addRowOnce(row) {
      if (!row?.id || seenIds.has(row.id)) return;
      seenIds.add(row.id);
      setTotal(prev => prev + Number(row.cost_usd || 0));
      setTokenTotal(prev => prev + rowTokens(row));
    }

    sb.loadWorkshopUsage().then((data) => {
      if (cancelled) return;
      for (const r of data) addRowOnce(r);
    });
    const unsub = sb.subscribeToWorkshopUsage((row) => addRowOnce(row));
    return () => { cancelled = true; unsub?.(); };
  }, [sb]);

  return { total, tokenTotal };
}

// Per-participant total — drives the credits budget gate, so correctness
// matters. Same dedup-by-id discipline as useWorkshopUsageTotal. This hook
// is now the single source of truth for a user's spend; App.jsx calls it
// once and passes the result down instead of each display site opening
// its own load+subscribe pair.
export function useMyUsageTotal(sb, myParticipantId) {
  const [total, setTotal] = useState(0);
  const [tokenTotal, setTokenTotal] = useState(0);

  useEffect(() => {
    if (!myParticipantId) return;
    let cancelled = false;
    const seenIds = new Set();

    function addRowOnce(row) {
      if (!row?.id || seenIds.has(row.id)) return;
      seenIds.add(row.id);
      setTotal(prev => prev + Number(row.cost_usd || 0));
      setTokenTotal(prev => prev + rowTokens(row));
    }

    sb.loadMyUsage(myParticipantId).then((data) => {
      if (cancelled) return;
      for (const r of data) addRowOnce(r);
    });
    const unsub = sb.subscribeToMyUsage(myParticipantId, (row) => addRowOnce(row));
    return () => { cancelled = true; unsub?.(); };
  }, [sb, myParticipantId]);

  return { total, tokenTotal };
}

export { computeCost };
