// Shared OAuth-callback handling, lifted out of AuthGate so the standalone
// Research app can reuse the exact same implicit/PKCE flow without dragging in
// the workshop UX. Supabase is configured with flowType:'implicit' and
// detectSessionInUrl:true (see supabase.js), but we still handle both the
// implicit (#access_token=) and PKCE (?code=) shapes explicitly because the
// Google redirect can land in either form depending on the provider config.
//
// Call once on mount before reading the session. Idempotent: if there's no
// callback in the URL it does nothing.
import { supabase } from '../supabase';

export async function handleAuthCallback() {
  // Implicit OAuth callback: #access_token= in the URL hash.
  const hash = window.location.hash;
  if (hash && hash.includes('access_token')) {
    const hashParams = new URLSearchParams(hash.substring(1));
    const accessToken = hashParams.get('access_token');
    const refreshToken = hashParams.get('refresh_token');
    if (accessToken && refreshToken) {
      const { error } = await supabase.auth.setSession({
        access_token: accessToken,
        refresh_token: refreshToken,
      });
      if (error) console.error('[auth] setSession failed:', error.message);
    }
    window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }

  // PKCE callback: ?code= in the query string.
  const params = new URLSearchParams(window.location.search);
  const code = params.get('code');
  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) console.error('[auth] code exchange failed:', error.message);
    // Preserve any non-OAuth query params (e.g. ?research=1) after stripping code.
    params.delete('code');
    const qs = params.toString();
    window.history.replaceState(null, '', window.location.pathname + (qs ? `?${qs}` : ''));
  }
}
