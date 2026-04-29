// Stage 8 (Economics) reveal surface — workshop-wide view.
//
// Every participant sees the same numbers: the room's collective LLM spend,
// broken down by segment (chat, coworker work, workflow runs, copilot),
// by participant (so everyone can see their own contribution in context),
// and as a chronological event list. The pedagogy is cohort-first — "look
// how much the whole mixed-team workshop actually cost" — not individual
// accountability.

import { useEffect, useMemo, useState } from 'react';
import { computeCost, formatUsd, formatTokens } from '../utils/llmCost';
import EducationalCue from './EducationalCue';

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

  // Number of humans in the room — used to label the cohort header.
  // The credit-pool banner that previously consumed this was removed
  // (the "total available credits" framing wasn't pedagogically useful);
  // only the participant count remains.
  const humanCount = useMemo(() => (
    (participants || []).filter(p => (p.kind || 'human') === 'human').length
  ), [participants]);

  // Leaderboard — every human participant in the room, sorted by tokens
  // descending. Built from BOTH the usage table (so rows with NULL or
  // stale participant_id are visible instead of silently dropped — which
  // was making the leaderboard total disagree with the cohort spend) AND
  // the participants prop (so participants with zero usage still show up
  // for an honest cohort picture). Token count is the metric, not cost.
  const leaderboard = useMemo(() => {
    const humans = (participants || []).filter(p => (p.kind || 'human') === 'human');
    const humanById = new Map(humans.map(p => [p.id, p]));
    const out = [];
    const seen = new Set();

    // Usage rows first — covers attributed humans, ex-participants, and
    // 'unknown' (calls logged without participant_id). Null/missing pids
    // get bucketed under a single Unattributed row instead of disappearing.
    for (const [pid, v] of Object.entries(agg.byParticipant)) {
      if (v.tokens === 0 && v.cost === 0 && v.calls === 0) continue;
      const p = humanById.get(pid);
      if (p) {
        out.push({
          pid, name: p.name, color: p.color,
          isYou: p.id === myParticipantId,
          tokens: v.tokens, cost: v.cost, calls: v.calls,
        });
        seen.add(pid);
      } else if (pid === 'unknown' || pid === 'null') {
        out.push({
          pid: 'unknown', name: 'Unattributed', color: '#9b9b9b',
          isYou: false, tokens: v.tokens, cost: v.cost, calls: v.calls,
        });
      } else {
        out.push({
          pid, name: 'Left the workshop', color: '#9b9b9b',
          isYou: false, tokens: v.tokens, cost: v.cost, calls: v.calls,
        });
      }
    }
    // Then any humans we haven't already added — they have zero usage so
    // far, but should still appear at the bottom of the leaderboard.
    for (const p of humans) {
      if (seen.has(p.id)) continue;
      out.push({
        pid: p.id, name: p.name, color: p.color,
        isYou: p.id === myParticipantId,
        tokens: 0, cost: 0, calls: 0,
      });
    }
    return out.sort((a, b) => b.tokens - a.tokens);
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
          {/* Cohort spend header — the total dollar figure the room has
              run through. Reuses the existing usage-totals visual so the
              top of the tab feels like the previous version. */}
          <div className="usage-totals">
            <div>
              <div className="usage-total-label">Cohort spend</div>
              <div className="usage-total-cost">{formatUsd(agg.totalCost)}</div>
            </div>
            <div className="usage-total-meta">
              {formatTokens(agg.totalTokens)} tokens across {rows.length} call{rows.length === 1 ? '' : 's'}
              <br />
              {humanCount} participant{humanCount === 1 ? '' : 's'} in the room
            </div>
          </div>

          {/* Leaderboard — every human in the room ranked by
              tokens used. Reuses the previous usage-participant-row grid
              with a rank column slotted in front. Leader gets an amber
              accent; the current user's row gets the existing is-you
              treatment. */}
          <div className="usage-bar-section">
            <div className="usage-bar-label">Leaderboard — most tokens used</div>
            <div className="usage-participant-list">
              {leaderboard.map((p, i) => {
                const rank = i + 1;
                const pct = maxTokens > 0 ? p.tokens / maxTokens : 0;
                const isLeader = rank === 1 && p.tokens > 0;
                return (
                  <div
                    key={p.pid}
                    className={`usage-participant-row usage-leader-grid${p.isYou ? ' is-you' : ''}${isLeader ? ' is-leader' : ''}`}
                  >
                    <span className="usage-leader-rank">#{rank}</span>
                    <span className="usage-participant-dot" style={{ background: p.color }} />
                    <span className="usage-participant-name">
                      {p.name}{p.isYou && <span className="usage-participant-you"> · you</span>}
                    </span>
                    <div className="usage-participant-bar">
                      <div className="usage-participant-bar-fill" style={{ width: `${pct * 100}%`, background: p.color }} />
                    </div>
                    <span className="usage-participant-cost">{formatTokens(p.tokens)}</span>
                    <span className="usage-participant-meta">{p.calls} call{p.calls === 1 ? '' : 's'}</span>
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
