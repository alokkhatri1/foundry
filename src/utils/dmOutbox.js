// Local outbox for DMs that failed to persist.
//
// Problem this solves: sendDm is retried at the HTTP layer (withSupabaseRetry)
// but a long-lasting outage — wifi down for 30s, Supabase hiccup during a
// workshop — still drops the message silently. The user typed something and
// hit send; it should reach the recipient whenever the network is back,
// not vanish.
//
// Contract:
// - submitDm(sb, from, to, content, options) is the public entrypoint.
//   Generates a clientId up front, tries sb.sendDm, and if it fails
//   transiently, persists the attempt to localStorage. Returns success
//   info so callers can show an "pending" marker.
// - flushOutbox(sb) is called on app start and on realtime reconnect.
//   Drains the outbox, removing successful sends.
// - outboxSnapshot() for UI indicators.

const STORAGE_KEY = 'foundry_dm_outbox_v1';
const MAX_ATTEMPTS_BEFORE_GIVEUP = 20; // ~ few minutes of exponential retries

// Token-bucket rate limit per tab. Prevents a runaway coworker tool chain
// or a stuck button from sending hundreds of DMs in a burst. Sustained rate
// caps at 2/sec; short bursts can spike to 20. A caller that exceeds the
// rate blocks asynchronously until a token is available, rather than
// erroring — this is backpressure, not rejection.
const RL_MAX_TOKENS = 20;
const RL_REFILL_PER_SEC = 2;
let rlTokens = RL_MAX_TOKENS;
let rlLastRefill = Date.now();
function refillTokens() {
  const now = Date.now();
  const elapsed = (now - rlLastRefill) / 1000;
  rlTokens = Math.min(RL_MAX_TOKENS, rlTokens + elapsed * RL_REFILL_PER_SEC);
  rlLastRefill = now;
}
async function acquireToken() {
  refillTokens();
  while (rlTokens < 1) {
    const needed = 1 - rlTokens;
    const waitMs = (needed / RL_REFILL_PER_SEC) * 1000 + 50;
    await new Promise(r => setTimeout(r, waitMs));
    refillTokens();
  }
  rlTokens -= 1;
}

function readOutbox() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function writeOutbox(state) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {}
}

function newClientId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

// Try to send. On transient failure, persist the attempt so a later
// flushOutbox can retry. Returns:
//   { data, clientId }              — delivered immediately
//   { pending: true, clientId, error } — queued for retry
//   { error, clientId }             — fatal (non-retriable error)
export async function submitDm(sb, fromParticipantId, toParticipantId, content, options = {}) {
  const clientId = options.clientId || newClientId();
  // Rate limit: block briefly if we've burst past 20 in a short window.
  // Cheap fallback if no connectivity: proceed anyway, the retry/outbox
  // layer handles persistence.
  await acquireToken();
  const result = await sb.sendDm(fromParticipantId, toParticipantId, content, { ...options, clientId });

  if (!result?.error) {
    // Success. Drop any prior queue entry for this clientId.
    removeFromOutbox(clientId);
    return result;
  }

  // Decide: was the error worth queueing?
  // sb.sendDm already went through withSupabaseRetry, so if we got here with
  // an error it's either non-transient (4xx-ish) or transient-but-retries-
  // exhausted. The second is the outbox case. Non-transient errors (validation,
  // auth) won't succeed on later retry — surface them instead of queueing.
  if (isFatalError(result.error)) {
    return result;
  }

  const outbox = readOutbox();
  outbox[clientId] = {
    clientId,
    fromParticipantId,
    toParticipantId,
    content,
    options: { kind: options.kind, metadata: options.metadata },
    attempts: (outbox[clientId]?.attempts || 0) + 1,
    queuedAt: outbox[clientId]?.queuedAt || Date.now(),
    lastError: typeof result.error === 'string' ? result.error : (result.error?.message || 'unknown'),
  };
  writeOutbox(outbox);
  return { pending: true, clientId, error: result.error };
}

function isFatalError(err) {
  if (!err) return false;
  const msg = (typeof err === 'string' ? err : (err.message || '')).toLowerCase();
  // Anything that's clearly a bug / permission problem — don't retry forever.
  if (/row.level.security|violat|unauthoriz|forbidden|not.found|does not exist/i.test(msg)) return true;
  const code = typeof err === 'object' ? err.code : null;
  if (code && /^23|^42/.test(String(code))) return true; // PG integrity / syntax errors
  return false;
}

export function removeFromOutbox(clientId) {
  const outbox = readOutbox();
  if (outbox[clientId]) {
    delete outbox[clientId];
    writeOutbox(outbox);
  }
}

export function outboxSnapshot() {
  const outbox = readOutbox();
  return Object.values(outbox);
}

// Retry everything in the outbox. Called on app start and on realtime
// reconnect. Entries that keep failing past MAX_ATTEMPTS are surfaced as
// errors and dropped so we don't spin forever on poison rows.
export async function flushOutbox(sb) {
  const outbox = readOutbox();
  const ids = Object.keys(outbox);
  if (ids.length === 0) return { flushed: 0, dropped: 0, remaining: 0 };

  let flushed = 0;
  let dropped = 0;

  for (const clientId of ids) {
    const entry = outbox[clientId];
    if (!entry) continue;
    if (entry.attempts >= MAX_ATTEMPTS_BEFORE_GIVEUP) {
      console.warn('[dmOutbox] giving up on', clientId, 'after', entry.attempts, 'attempts');
      removeFromOutbox(clientId);
      dropped += 1;
      continue;
    }
    const result = await sb.sendDm(entry.fromParticipantId, entry.toParticipantId, entry.content, {
      ...entry.options,
      clientId: entry.clientId,
    });
    if (!result?.error) {
      removeFromOutbox(clientId);
      flushed += 1;
    } else if (isFatalError(result.error)) {
      console.warn('[dmOutbox] fatal error for', clientId, '— dropping:', result.error);
      removeFromOutbox(clientId);
      dropped += 1;
    } else {
      // Still transient. Increment attempt count and leave for next flush.
      const fresh = readOutbox();
      if (fresh[clientId]) {
        fresh[clientId].attempts = (fresh[clientId].attempts || 0) + 1;
        fresh[clientId].lastError = typeof result.error === 'string' ? result.error : (result.error?.message || 'unknown');
        writeOutbox(fresh);
      }
    }
  }

  const remaining = Object.keys(readOutbox()).length;
  return { flushed, dropped, remaining };
}
