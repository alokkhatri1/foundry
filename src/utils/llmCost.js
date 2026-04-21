// LLM cost computation and formatting.
//
// Rates are per 1M tokens in USD. Stored as a constant so historical rows in
// llm_usage lock in whatever price was current when the row was written —
// computeCost runs at log time, the row stores the result, and future rate
// changes don't rewrite history.

const RATES = {
  'claude-sonnet-4-20250514': {
    input: 3.00,
    output: 15.00,
    cacheWrite: 3.75,
    cacheRead: 0.30,
  },
  'claude-haiku-4-5-20251001': {
    input: 1.00,
    output: 5.00,
    cacheWrite: 1.25,
    cacheRead: 0.10,
  },
  // Fallback for unknown models — Sonnet 4 pricing so cost is non-zero but
  // not obviously wrong. If a new model lands, add it here.
  default: {
    input: 3.00,
    output: 15.00,
    cacheWrite: 3.75,
    cacheRead: 0.30,
  },
};

// Claude's response.usage block: { input_tokens, output_tokens,
// cache_creation_input_tokens, cache_read_input_tokens }. The cache fields
// are absent on non-cached calls — default to 0.
export function computeCost(usage, model) {
  if (!usage) return 0;
  const rate = RATES[model] || RATES.default;
  const input = usage.input_tokens || 0;
  const output = usage.output_tokens || 0;
  const cacheWrite = usage.cache_creation_input_tokens || 0;
  const cacheRead = usage.cache_read_input_tokens || 0;
  return (
    (input * rate.input +
      output * rate.output +
      cacheWrite * rate.cacheWrite +
      cacheRead * rate.cacheRead) / 1_000_000
  );
}

// Display helpers. USD goes to fractional cents when the amount is tiny —
// a chat turn might cost $0.0004. We want participants to see that's a real
// number, not just "$0.00".
export function formatUsd(n) {
  if (n == null || isNaN(n)) return '$0.00';
  if (n === 0) return '$0.00';
  if (n < 0.01) return `$${n.toFixed(4)}`;
  if (n < 1) return `$${n.toFixed(3)}`;
  return `$${n.toFixed(2)}`;
}

export function formatTokens(n) {
  if (n == null || isNaN(n)) return '0';
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}

// Participant-facing names for segment ids. Keep short — they show up as
// axis labels and list section headers.
export const SEGMENT_LABELS = {
  chat: 'Chat',
  chat_classifier: 'Chat intent classifier',
  coworker_chat: 'Coworker chats',
  workflow_run: 'Workflow runs',
  workflow_copilot: 'Workflow copilot',
  refine_description: 'Coworker refinement',
  scorecard: 'Graduation scorecard',
};

export function labelForSegment(s) {
  return SEGMENT_LABELS[s] || s;
}

// ===== Credits system =====
// 100 credits = $0.50, so one credit = half a cent. Conversion is intentional:
// credits keep the number in a "budget-ish" range people can reason about
// without thinking in micro-dollars. Round UP when converting spend to
// credits so fractional spend never gets under-counted against the budget.
export const CREDIT_USD_VALUE = 0.005;
export const DEFAULT_CREDIT_ALLOCATION = 100;
export const CREDITS_WARN_THRESHOLD = 10;

export function costToCredits(usd) {
  if (!usd || usd <= 0) return 0;
  return Math.ceil(usd / CREDIT_USD_VALUE);
}

export function creditsToUsd(credits) {
  if (!credits || credits <= 0) return 0;
  return credits * CREDIT_USD_VALUE;
}
