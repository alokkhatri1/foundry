// Anthropic API proxy — Vercel serverless function.
//
// Holds ANTHROPIC_API_KEY in Vercel env vars so the key never reaches the
// browser. Validates the caller's Supabase session JWT, then forwards the
// request body verbatim to api.anthropic.com.
//
// Why this lives here (Vercel) instead of Supabase Edge Functions:
//   - the proxy doesn't touch the DB, so there's no proximity benefit
//   - this way the entire app deploys via the same `git push → Vercel`
//     pipeline that already ships the frontend
//
// Required Vercel env vars:
//   - ANTHROPIC_API_KEY        (server-only — must NOT have VITE_ prefix)
//   - VITE_SUPABASE_URL        (already set; reused for JWT verification)
//   - VITE_SUPABASE_ANON_KEY   (already set; safe to use server-side too)

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

// Hop-by-hop / encoding headers we strip before relaying upstream's response.
// content-length goes wrong after re-emit; transfer-encoding/connection are
// hop-by-hop; content-encoding stays implicit (Node's fetch decompresses).
const HEADERS_TO_STRIP = new Set([
  'content-length',
  'content-encoding',
  'transfer-encoding',
  'connection',
]);

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    // Same-origin in production (Vercel serves the frontend and the API
    // from the same domain) so CORS is mostly moot, but spell it out so
    // local dev with `vercel dev` from a different port still works.
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'authorization, content-type');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    return res.status(204).end();
  }
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  if (!ANTHROPIC_API_KEY) {
    return res.status(500).json({
      error: 'ANTHROPIC_API_KEY not set on the server. Add it in Vercel → Project Settings → Environment Variables, then redeploy.',
    });
  }
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    return res.status(500).json({ error: 'Supabase env vars not configured on the server.' });
  }

  // Auth: verify the caller has a valid Supabase session. Front-end sends
  // its access_token as a Bearer token; supabase-js validates it for us
  // (one network call to the Supabase auth endpoint). No service role key
  // needed — the anon key is enough to make the verification call.
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) {
    return res.status(401).json({ error: 'Missing Bearer token — sign in before calling Claude.' });
  }
  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  const { data: { user }, error: authError } = await supabase.auth.getUser(token);
  if (authError || !user) {
    return res.status(401).json({ error: 'Invalid or expired session.' });
  }

  // Forward the body verbatim. Vercel auto-parses JSON when Content-Type is
  // application/json, so req.body is already an object — re-stringify for
  // the upstream call. The proxy is intentionally dumb (no schema layer to
  // drift out of sync with Anthropic's API).
  let upstream;
  try {
    upstream = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: typeof req.body === 'string' ? req.body : JSON.stringify(req.body),
    });
  } catch (err) {
    return res.status(502).json({ error: `Upstream fetch failed: ${err.message}` });
  }

  // Relay status + body. Forward useful headers (x-ratelimit-*, retry-after)
  // so the client's claudeFetch retry logic still sees them.
  for (const [k, v] of upstream.headers.entries()) {
    if (HEADERS_TO_STRIP.has(k.toLowerCase())) continue;
    res.setHeader(k, v);
  }
  const body = await upstream.text();
  res.status(upstream.status).send(body);
}
