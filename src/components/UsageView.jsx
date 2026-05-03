// Stage 10 (Economics) reveal surface — workshop-wide view.
//
// Every participant sees the same numbers: the room's collective LLM spend,
// shown as a magazine-cover dollar figure, a 2-hour cohort spend strip,
// and a leaderboard of every human in the room ranked by tokens used.
// The pedagogy is cohort-first — "look how much the whole mixed-team
// workshop actually cost" — not individual accountability.

import { useEffect, useMemo, useState } from 'react';
import { computeCost, formatUsd, formatTokens } from '../utils/llmCost';
import EducationalCue from './EducationalCue';

const TIMELINE_BUCKETS = 24;
const BUCKET_MS = 5 * 60 * 1000; // 5 minutes
const TIMELINE_WINDOW_MS = TIMELINE_BUCKETS * BUCKET_MS; // 2 hours

export default function UsageView({ sb, participants, myParticipantId, showEducationalCues }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  // Tick "now" every 30s so the rolling 2h spend strip drifts forward
  // without waiting on new rows. Real-time inserts also trigger re-bucketing.
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(id);
  }, []);

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

  // 24-bucket cohort spend timeline over the last 2 hours. Bucket 0 is
  // oldest (left in display), bucket 23 is newest (right). Re-buckets when
  // rows or `now` change.
  const timeline = useMemo(() => {
    const buckets = new Array(TIMELINE_BUCKETS).fill(0);
    for (const r of rows) {
      const t = r.created_at ? new Date(r.created_at).getTime() : 0;
      if (!t) continue;
      const ageMs = now - t;
      if (ageMs < 0 || ageMs > TIMELINE_WINDOW_MS) continue;
      const idx = (TIMELINE_BUCKETS - 1) - Math.floor(ageMs / BUCKET_MS);
      if (idx < 0 || idx >= TIMELINE_BUCKETS) continue;
      buckets[idx] += Number(r.cost_usd || 0);
    }
    return buckets;
  }, [rows, now]);
  const peakBucket = useMemo(() => Math.max(0, ...timeline), [timeline]);

  // Number of humans in the room — used in the cohort meta panel.
  const humanCount = useMemo(() => (
    (participants || []).filter(p => (p.kind || 'human') === 'human').length
  ), [participants]);

  // Leaderboard — every human participant currently in the room, sorted
  // by tokens descending. Token count is the metric, not cost.
  //
  // Rogue rows ("Unattributed" for null pids and "Left the workshop" for
  // pids that don't match any current participant) are deliberately
  // hidden — for a workshop view, "people in the room right now" is the
  // cleaner story; orphan attribution lives in the cohort total above.
  const leaderboard = useMemo(() => {
    const humans = (participants || []).filter(p => (p.kind || 'human') === 'human');
    const humanById = new Map(humans.map(p => [p.id, p]));
    const out = [];
    const seen = new Set();

    for (const [pid, v] of Object.entries(agg.byParticipant)) {
      if (v.tokens === 0 && v.cost === 0 && v.calls === 0) continue;
      const p = humanById.get(pid);
      if (!p) continue;
      out.push({
        pid, name: p.name, color: p.color,
        isYou: p.id === myParticipantId,
        tokens: v.tokens, cost: v.cost, calls: v.calls,
      });
      seen.add(pid);
    }
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

  return (
    <div className="us-page">
      <header className="us-page-head">
        <div className="us-page-head-text">
          <div className="us-eyebrow">
            <span className="us-eyebrow-dot" aria-hidden />Stage 10 · Economics
          </div>
          <h2 className="us-page-title">
            Look at what the whole&nbsp;<em>room</em>&nbsp;just spent.
          </h2>
          <p className="us-page-sub">
            Every Claude API call this room has made — and where it went.
          </p>
          <EducationalCue cueId="usage-stage" show={showEducationalCues} />
        </div>
      </header>

      {loading ? (
        <UsageEmpty
          title="Loading workshop usage…"
          body="Pulling every llm_usage row from this room. Should land in a moment."
        />
      ) : error ? (
        <UsageEmpty
          title="Couldn't load usage data."
          body={<>If the <code>llm_usage</code> table doesn't exist yet, apply migration 016 to this Supabase project and have someone make a chat — rows will start landing in realtime.</>}
          hint={error}
        />
      ) : rows.length === 0 ? (
        <UsageEmpty
          title="No spend on record yet."
          body="As soon as anyone chats, builds a coworker, or runs a workflow, numbers will land here in realtime."
          hint="(If the whole room's been active and this is still empty, migration 016 likely hasn't been applied to Supabase yet.)"
        />
      ) : (
        <>
          <CohortHeader
            totalCost={agg.totalCost}
            totalTokens={agg.totalTokens}
            totalCalls={rows.length}
            humanCount={humanCount}
          />
          <SpendStrip timeline={timeline} peak={peakBucket} />
          <Leaderboard leaderboard={leaderboard} totalTokens={agg.totalTokens} />
        </>
      )}
    </div>
  );
}

function CohortHeader({ totalCost, totalTokens, totalCalls, humanCount }) {
  const formatted = formatUsd(totalCost);
  // Split off `$` and decimal so cents render at smaller size. formatUsd may
  // return "$0.00", "<$0.01", or "$1234.56". For non-numeric forms ("<$0.01"),
  // bail out of the split treatment.
  const isNumeric = formatted.startsWith('$');
  let dollars = '0';
  let cents = '00';
  if (isNumeric) {
    const stripped = formatted.slice(1);
    const [d, c] = stripped.split('.');
    dollars = d || '0';
    cents = c || '00';
  }

  return (
    <section className="us-cohort">
      <div className="us-cohort-eyebrow">
        <span className="us-cohort-eyebrow-dot" aria-hidden />
        Cohort spend · live
      </div>
      <div className="us-cohort-figure">
        <div className="us-cohort-cost">
          {isNumeric ? (
            <>
              <span className="us-cohort-cost-sym">$</span>
              <span className="us-cohort-cost-int">{dollars}</span>
              <span className="us-cohort-cost-frac">.{cents}</span>
            </>
          ) : (
            <span className="us-cohort-cost-int">{formatted}</span>
          )}
        </div>
        <div className="us-cohort-meta">
          <div className="us-cohort-meta-row">
            <span className="us-cohort-meta-label">Participants</span>
            <span className="us-cohort-meta-value">{humanCount}</span>
          </div>
          <div className="us-cohort-meta-row">
            <span className="us-cohort-meta-label">Avg / person</span>
            <span className="us-cohort-meta-value">
              {formatUsd(humanCount > 0 ? totalCost / humanCount : 0)}
            </span>
          </div>
          <div className="us-cohort-meta-row">
            <span className="us-cohort-meta-label">Avg / call</span>
            <span className="us-cohort-meta-value">
              {formatUsd(totalCalls > 0 ? totalCost / totalCalls : 0)}
            </span>
          </div>
        </div>
      </div>
      <div className="us-cohort-sub">
        <em>{formatTokens(totalTokens)}</em> tokens across <em>{totalCalls}</em>{' '}
        {totalCalls === 1 ? 'call' : 'calls'} since the workshop opened.
      </div>
    </section>
  );
}

function SpendStrip({ timeline, peak }) {
  return (
    <section className="us-strip">
      <div className="us-strip-head">
        <span className="us-strip-eyebrow">Spend over time · last 2h</span>
        <span className="us-strip-meta">
          peak <em>{formatUsd(peak)}</em> · 5-min buckets
        </span>
      </div>
      <div className="us-strip-bars">
        {timeline.map((v, i) => (
          <div key={i} className="us-strip-cell" title={`bucket ${i + 1}: ${formatUsd(v)}`}>
            <div
              className="us-strip-bar"
              style={{ height: peak > 0 ? `${Math.max(2, (v / peak) * 100)}%` : '2%' }}
            />
          </div>
        ))}
      </div>
      <div className="us-strip-axis">
        <span>2h ago</span>
        <span>now</span>
      </div>
    </section>
  );
}

function Leaderboard({ leaderboard, totalTokens }) {
  const maxTokens = leaderboard[0]?.tokens || 0;
  return (
    <section className="us-leaderboard">
      <header className="us-leaderboard-head">
        <div>
          <div className="us-section-eyebrow">Leaderboard</div>
          <h3 className="us-section-title">
            Most tokens used,&nbsp;<em>top to bottom</em>
          </h3>
        </div>
        <div className="us-leaderboard-legend">
          <span className="us-legend-pill is-leader"><span className="us-legend-dot" aria-hidden />leader</span>
          <span className="us-legend-pill is-you"><span className="us-legend-dot" aria-hidden />you</span>
        </div>
      </header>
      {leaderboard.length === 0 ? (
        <div className="us-leader-empty">No participants in the room yet.</div>
      ) : (
        <>
          <div className="us-row-headers">
            <span>#</span>
            <span>Participant</span>
            <span>Tokens used</span>
            <span>Cost · share</span>
          </div>
          <div className="us-rows">
            {leaderboard.map((p, i) => (
              <LeaderRow
                key={p.pid}
                rank={i + 1}
                p={p}
                maxTokens={maxTokens}
                totalTokens={totalTokens}
              />
            ))}
          </div>
        </>
      )}
    </section>
  );
}

function LeaderRow({ rank, p, maxTokens, totalTokens }) {
  const widthPct = maxTokens > 0 ? (p.tokens / maxTokens) * 100 : 0;
  const sharePct = totalTokens > 0 ? (p.tokens / totalTokens) * 100 : 0;
  const isLeader = rank === 1 && p.tokens > 0;
  const isZero = p.tokens === 0;

  return (
    <div className={`us-row${p.isYou ? ' is-you' : ''}${isLeader ? ' is-leader' : ''}${isZero ? ' is-zero' : ''}`}>
      <div className="us-row-rank">
        <span className="us-row-rank-num">{String(rank).padStart(2, '0')}</span>
        {isLeader && <span className="us-row-rank-tag">leader</span>}
      </div>
      <div className="us-row-identity">
        <span className="us-row-dot" style={{ background: p.color }} aria-hidden />
        <span className="us-row-name">
          {p.name}
          {p.isYou && <span className="us-row-you">· you</span>}
        </span>
      </div>
      <div className="us-row-bar" aria-hidden>
        <div className="us-row-bar-fill" style={{ width: `${widthPct}%`, background: p.color }} />
      </div>
      <div className="us-row-numbers">
        <span className="us-row-cost">{formatUsd(p.cost)}</span>
        <span className="us-row-meta-line">
          <span className="us-row-tokens-num">{formatTokens(p.tokens)}</span>
          <span className="us-row-tokens-unit">tok</span>
          <span className="us-row-meta-sep" aria-hidden>·</span>
          <span>{p.calls} {p.calls === 1 ? 'call' : 'calls'}</span>
          {p.tokens > 0 && (
            <>
              <span className="us-row-meta-sep" aria-hidden>·</span>
              <span>{sharePct.toFixed(1)}%</span>
            </>
          )}
        </span>
      </div>
    </div>
  );
}

function UsageEmpty({ title, body, hint }) {
  return (
    <div className="us-empty">
      <div className="us-empty-figure" aria-hidden>
        <span className="us-empty-figure-dot" />
      </div>
      <h3 className="us-empty-title">{title}</h3>
      <p className="us-empty-body">{body}</p>
      {hint && <p className="us-empty-hint">{hint}</p>}
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
// is the single source of truth for a user's spend; App.jsx calls it once
// and passes the result down.
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
