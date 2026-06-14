// Turns raw llm_usage into behavioral signal. Two lenses:
//  1) Stage arc — bucket each usage call into the stage window that was active
//     when it happened (from stage_events reveal times), so we see how behavior
//     shifts as levels unlock.
//  2) Engagement summary — derived style/level/breadth from the segment mix,
//     so a profile carries interpretable behavior, not raw token noise.

export const STAGE_LABELS = {
  1: 'Chat', 2: 'Preferences', 3: 'Skills', 4: 'Knowledge',
  5: 'Coworkers', 6: 'Workflow', 7: 'Audit', 8: 'Economics', 9: 'Reflections',
};
export const ARC_STAGES = ['1', '3', '4', '5', '6']; // stages with meaningful LLM activity

function toks(u) {
  return (u.input_tokens || 0) + (u.output_tokens || 0)
    + (u.cache_creation_input_tokens || 0) + (u.cache_read_input_tokens || 0);
}

// Reveal events → stage windows in ms. Stage active before the first reveal is
// the first event's from_stage; after the last reveal, its to_stage.
export function buildStageWindows(stageEvents) {
  const evs = (stageEvents || []).slice()
    .sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
  const wins = [];
  let cur = evs[0]?.from_stage || '1';
  let start = -Infinity;
  for (const e of evs) {
    const t = new Date(e.created_at).getTime();
    wins.push({ stage: String(e.from_stage || cur), start, end: t });
    cur = String(e.to_stage);
    start = t;
  }
  wins.push({ stage: String(cur), start, end: Infinity });
  return wins;
}

export function activeStageAt(tMs, wins) {
  for (const w of wins) if (tMs >= w.start && tMs < w.end) return w.stage;
  return wins.length ? wins[wins.length - 1].stage : '1';
}

// Per-participant and cohort-total activity per stage window.
// Returns { byPid: {pid: {stage: {tokens, calls}}}, byStage: {stage: {tokens, calls, n}} }.
export function stageActivity(usageRows, wins, pidFilter) {
  const byPid = {};
  const byStage = {};
  for (const u of usageRows || []) {
    if (!u.participant_id || !u.created_at) continue;
    if (pidFilter && !pidFilter.has(u.participant_id)) continue;
    const s = activeStageAt(new Date(u.created_at).getTime(), wins);
    const t = toks(u);
    ((byPid[u.participant_id] ||= {})[s] ||= { tokens: 0, calls: 0 });
    byPid[u.participant_id][s].tokens += t;
    byPid[u.participant_id][s].calls += 1;
    (byStage[s] ||= { tokens: 0, calls: 0, ppl: new Set() });
    byStage[s].tokens += t; byStage[s].calls += 1; byStage[s].ppl.add(u.participant_id);
  }
  return { byPid, byStage };
}

// Derived engagement signal from a segment-token map (RPC row or aggregate).
const BUILD_SEGS = ['file_generation', 'workflow_run', 'workflow_copilot', 'workflow_capture'];
export function engagementSummary(u) {
  if (!u) return null;
  const seg = u.by_segment || {};
  const total = Object.values(seg).reduce((a, b) => a + b, 0) || u.total_tokens || 0;
  const build = BUILD_SEGS.reduce((a, k) => a + (seg[k] || 0), 0);
  const ratio = total ? build / total : 0;
  const style = ratio >= 0.4 ? 'Builder' : ratio >= 0.15 ? 'Mixed' : 'Talker';
  const breadth = Object.keys(seg).filter(k => seg[k] > 0).length;
  return { style, buildRatio: ratio, breadth, total: u.total_tokens || total, calls: u.n_calls || 0 };
}

// Relative level tiers (light/medium/heavy) by token terciles within a set.
export function levelTiers(totals) {
  const xs = totals.filter(n => n > 0).sort((a, b) => a - b);
  if (xs.length < 3) return () => 'medium';
  const lo = xs[Math.floor(xs.length / 3)];
  const hi = xs[Math.floor((2 * xs.length) / 3)];
  return (n) => n <= lo ? 'light' : n >= hi ? 'heavy' : 'medium';
}
