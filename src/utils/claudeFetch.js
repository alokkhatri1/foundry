// Wrapper around `fetch` for every call to api.anthropic.com.
//
// Browsers have no sensible default timeout, so a slow Anthropic response (or
// an edge / network blip) can leave a workflow run hanging for minutes with
// no feedback. During a live workshop that manifests as "the run is stuck"
// or vague "API timeout" messages.
//
// This helper:
//   1. Caps each request at `timeoutMs` (default 90s) via AbortController.
//   2. Retries once on the transient errors we've actually seen during
//      cohort load: 408 / 429 / 5xx / 529 (Anthropic overload) / fetch
//      throws (DNS, connection reset) / AbortError (our own timeout).
//   3. Backs off briefly (2s then 4s) between attempts so we don't make the
//      overload worse.
//
// Non-transient errors (400 bad request, 401 auth) pass straight through —
// retrying those is pointless and hides the bug.
//
// Drop-in compatible with `fetch`: same args, returns a Response.

const RETRY_STATUSES = new Set([408, 429, 500, 502, 503, 504, 520, 521, 522, 523, 524, 529]);

// Anthropic + most upstreams send `retry-after` in seconds when they want us
// to hold back. Honour it up to a sane cap so a cohort hitting 429 doesn't
// fall into synchronised retries; otherwise fall through to our own backoff.
function retryAfterMs(response, attempt) {
  const header = response?.headers?.get?.('retry-after');
  const seconds = header ? Number(header) : NaN;
  if (Number.isFinite(seconds) && seconds > 0) {
    return Math.min(seconds * 1000, 15_000);
  }
  // Exponential backoff with jitter — 2-3s, 4-6s, 8-12s. Jitter matters
  // because without it every participant's retry lands on the same tick
  // and re-triggers the same 429 storm we're trying to escape.
  const base = 2000 * attempt;
  return base + Math.floor(Math.random() * base * 0.5);
}

export async function claudeFetch(url, options = {}, { timeoutMs = 90_000, maxAttempts = 3 } = {}) {
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
