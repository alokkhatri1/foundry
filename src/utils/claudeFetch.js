// Wrapper around `fetch` for every call to api.anthropic.com.
//
// Browsers have no sensible default timeout, so a slow Anthropic response (or
// an edge / network blip) can leave a workflow run hanging for minutes with
// no feedback. During a live workshop that manifests as "the run is stuck"
// or vague "API timeout" messages.
//
// Three layered protections, calibrated for Anthropic Tier 2 (100K Sonnet 4
// input TPM, 1000 RPM) at 35-40 concurrent participants:
//
//   1. Per-tab concurrency cap (CONCURRENT_LIMIT). At most N Anthropic calls
//      in flight at any moment — a 3rd request queues until one finishes.
//      Across 35 users this caps room-wide concurrency at 35 × N.
//
//   2. Per-tab token-bucket pacing (RATE_*). 2 calls/sec sustained, 5 burst.
//      Smooths the "everyone clicks Run at the same moment" thundering herd
//      that produced sustained 429s during the 04-23 session.
//
//   3. Per-request timeout + retry. Up to MAX_ATTEMPTS attempts, with
//      exponential backoff + jitter, and `Retry-After` header honored when
//      Anthropic provides one. Covers a 30-60s 429 storm from temporary
//      saturation.
//
// Non-transient errors (400 bad request, 401 auth) pass straight through —
// retrying those is pointless and hides the bug.
//
// Drop-in compatible with `fetch`: same args, returns a Response.

const RETRY_STATUSES = new Set([408, 429, 500, 502, 503, 504, 520, 521, 522, 523, 524, 529]);

// ===== Concurrency cap (per tab) =====
// Tier 2 Sonnet 4 = 100K input TPM. With ~15K tokens per workflow step,
// even 7 concurrent calls saturate. CONCURRENT_LIMIT=2 across 35 users
// gives room-wide concurrency of 70 — combined with the pacing limiter
// below, this keeps us within Tier 2's RPM and TPM under realistic
// workshop load. Bump if you upgrade to Tier 3+.
const CONCURRENT_LIMIT = 2;
let inFlight = 0;
const concurrencyQueue = [];

function acquireSlot() {
  if (inFlight < CONCURRENT_LIMIT) {
    inFlight++;
    return Promise.resolve();
  }
  return new Promise(resolve => concurrencyQueue.push(resolve));
}

function releaseSlot() {
  const next = concurrencyQueue.shift();
  if (next) {
    // Hand the slot directly to the next waiter (don't decrement and let
    // someone else acquire — there might be no someone else, then a new
    // arrival jumps the line).
    next();
  } else {
    inFlight = Math.max(0, inFlight - 1);
  }
}

// ===== Rate-limit pacing (per tab, token bucket) =====
const RATE_MAX_TOKENS = 5;
const RATE_REFILL_PER_SEC = 2;
let rateTokens = RATE_MAX_TOKENS;
let rateLastRefill = Date.now();

function refillRateTokens() {
  const now = Date.now();
  const elapsed = (now - rateLastRefill) / 1000;
  rateTokens = Math.min(RATE_MAX_TOKENS, rateTokens + elapsed * RATE_REFILL_PER_SEC);
  rateLastRefill = now;
}

async function acquireRateToken() {
  refillRateTokens();
  while (rateTokens < 1) {
    const needed = 1 - rateTokens;
    const waitMs = (needed / RATE_REFILL_PER_SEC) * 1000 + 50;
    await new Promise(r => setTimeout(r, waitMs));
    refillRateTokens();
  }
  rateTokens -= 1;
}

// Anthropic + most upstreams send `retry-after` in seconds when they want us
// to hold back. Honour it up to a sane cap so a cohort hitting 429 doesn't
// fall into synchronised retries; otherwise fall through to our own backoff.
function retryAfterMs(response, attempt) {
  const header = response?.headers?.get?.('retry-after');
  const seconds = header ? Number(header) : NaN;
  if (Number.isFinite(seconds) && seconds > 0) {
    return Math.min(seconds * 1000, 30_000);
  }
  // Exponential backoff with jitter. Without jitter, every participant's
  // retry lands on the same tick and re-triggers the same 429 storm we're
  // trying to escape. Caps at 30s — Anthropic 429s from cohort load
  // typically clear within that window once active calls drain.
  const base = Math.min(2000 * attempt, 20_000);
  return base + Math.floor(Math.random() * base * 0.5);
}

// MAX_ATTEMPTS=6 covers ~60s of cumulative backoff (2+4+8+15+15+15) plus
// `Retry-After` waits. Any sustained 429 storm beyond a minute likely means
// the org-level rate limit is exhausted and a higher tier is needed.
const MAX_ATTEMPTS_DEFAULT = 6;

export async function claudeFetch(url, options = {}, { timeoutMs = 90_000, maxAttempts = MAX_ATTEMPTS_DEFAULT } = {}) {
  // Acquire pacing token first (cheap, only blocks if we're sending too fast),
  // then a concurrency slot (may block longer if the 2-in-flight cap is hit).
  // Order matters: pacing BEFORE the slot ensures a flood of arrivals is
  // smoothed even when slots are free.
  await acquireRateToken();
  await acquireSlot();
  try {
    return await fetchWithRetries(url, options, timeoutMs, maxAttempts);
  } finally {
    releaseSlot();
  }
}

async function fetchWithRetries(url, options, timeoutMs, maxAttempts) {
  let lastError = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, { ...options, signal: controller.signal });
      clearTimeout(timer);
      if (response.ok) return response;
      if (!RETRY_STATUSES.has(response.status) || attempt === maxAttempts) return response;
      const wait = retryAfterMs(response, attempt);
      // Visibility for production logs: every 429 we encounter and how long
      // we'll wait. If these become noisy, an Anthropic tier upgrade is the
      // structural fix — code-side smoothing only reshapes the curve.
      if (response.status === 429) {
        console.warn(`[claudeFetch] 429 attempt ${attempt}/${maxAttempts}, waiting ${wait}ms`);
      }
      lastError = new Error(`HTTP ${response.status}`);
      await new Promise(r => setTimeout(r, wait));
      continue;
    } catch (err) {
      clearTimeout(timer);
      lastError = err;
      const isTimeout = err.name === 'AbortError';
      const isNetwork = err.name === 'TypeError';
      if (!(isTimeout || isNetwork) || attempt === maxAttempts) throw err;
      await new Promise(r => setTimeout(r, retryAfterMs(null, attempt)));
    }
  }
  throw lastError || new Error('claudeFetch: exhausted attempts');
}
