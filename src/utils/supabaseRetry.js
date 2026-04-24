// Retry wrapper for critical Supabase writes (sendDm, logApproval).
//
// Why this exists: a single INSERT is one HTTP call. If wifi hiccups at
// exactly the wrong moment, the message vanishes with no indication.
// During the 04-23 session on a room-scale wifi, that lost messages.
//
// Strategy:
//   - Up to 3 attempts
//   - Exponential backoff with jitter (400ms, 1200ms, 3000ms give-or-take)
//   - Retry on network errors (fetch throws, TypeError) and 5xx
//   - Fail fast on 4xx / explicit auth errors — retrying won't help
//
// Used alongside the idempotency changes on sendDm so a retry of the same
// clientId is a server-side no-op rather than a duplicate row.

function isTransientError(err) {
  if (!err) return false;
  // Fetch throws (DNS failure, connection reset, offline)
  if (err.name === 'TypeError' || err.name === 'AbortError') return true;
  if (err.message && /network|failed to fetch|timed? out/i.test(err.message)) return true;
  // Supabase returns an object with a `code`/`status`; treat 5xx as transient.
  const status = err.status || err.statusCode;
  if (status && status >= 500 && status < 600) return true;
  // Postgres serialization failures / deadlocks surface as code 40xxx — transient.
  if (err.code && /^40/.test(String(err.code))) return true;
  return false;
}

function backoffMs(attempt) {
  const base = 400 * Math.pow(2, attempt - 1); // 400, 800, 1600
  return base + Math.floor(Math.random() * base * 0.5);
}

// Supabase client calls return { data, error } rather than throwing. This
// wrapper adapts both shapes: fn can return that tuple OR throw. Retries
// on transient errors either way.
export async function withSupabaseRetry(fn, { maxAttempts = 3 } = {}) {
  let lastErr = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const result = await fn();
      // Supabase { data, error } contract: error is truthy on failure.
      if (result && typeof result === 'object' && 'error' in result && result.error) {
        lastErr = result.error;
        const errObj = typeof lastErr === 'string' ? { message: lastErr } : lastErr;
        if (!isTransientError(errObj) || attempt === maxAttempts) return result;
        await new Promise(r => setTimeout(r, backoffMs(attempt)));
        continue;
      }
      return result;
    } catch (err) {
      lastErr = err;
      if (!isTransientError(err) || attempt === maxAttempts) throw err;
      await new Promise(r => setTimeout(r, backoffMs(attempt)));
    }
  }
  // Should never reach here, but if we do, throw whatever we last saw.
  throw lastErr || new Error('withSupabaseRetry: exhausted attempts');
}
