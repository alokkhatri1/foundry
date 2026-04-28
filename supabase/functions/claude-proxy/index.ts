// Anthropic API proxy.
//
// Holds ANTHROPIC_API_KEY in Supabase Function secrets so the key never
// reaches the browser. Clients send the same JSON body shape they would
// send to https://api.anthropic.com/v1/messages; this function forwards
// verbatim and streams the response back.
//
// Auth: Supabase Edge Functions verify the caller's JWT by default. Any
// request without a valid Authorization: Bearer <access_token> header is
// rejected before this code runs. Override with `verify_jwt = false` only
// if you intend the proxy to be public — you don't, since unauth would
// re-expose the key spend.
//
// Deploy:
//   supabase functions deploy claude-proxy
//   supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
//
// Test:
//   curl -i -X POST "$SUPABASE_URL/functions/v1/claude-proxy" \
//     -H "Authorization: Bearer $SUPABASE_USER_JWT" \
//     -H "apikey: $SUPABASE_ANON_KEY" \
//     -H "Content-Type: application/json" \
//     -d '{"model":"claude-haiku-4-5-20251001","max_tokens":50,"messages":[{"role":"user","content":"ping"}]}'

const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY');

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type, apikey, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// Headers we strip from the upstream response before relaying. content-length
// becomes wrong after we re-emit; transfer-encoding/connection are hop-by-hop.
const HOP_BY_HOP = new Set(['content-length', 'transfer-encoding', 'connection']);

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405);
  }
  if (!ANTHROPIC_API_KEY) {
    return jsonResponse(
      { error: 'ANTHROPIC_API_KEY not configured on the proxy. Run: supabase secrets set ANTHROPIC_API_KEY=sk-ant-...' },
      500,
    );
  }

  // Forward the request body verbatim. The client constructs the same JSON
  // shape it used to send to api.anthropic.com directly, so the proxy is
  // intentionally dumb — no schema-translation layer to drift out of sync
  // with Anthropic's API.
  const body = await req.text();

  let upstream: Response;
  try {
    upstream = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body,
    });
  } catch (err) {
    return jsonResponse({ error: `Upstream fetch failed: ${(err as Error).message}` }, 502);
  }

  // Pass through status + body. Headers we copy selectively so
  // x-ratelimit-* and retry-after still reach the client (claudeFetch's
  // retry logic relies on retry-after).
  const responseHeaders = new Headers(CORS_HEADERS);
  for (const [k, v] of upstream.headers.entries()) {
    if (HOP_BY_HOP.has(k.toLowerCase())) continue;
    responseHeaders.set(k, v);
  }
  if (!responseHeaders.has('Content-Type')) {
    responseHeaders.set('Content-Type', 'application/json');
  }

  const responseBody = await upstream.text();
  return new Response(responseBody, {
    status: upstream.status,
    headers: responseHeaders,
  });
});

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}
