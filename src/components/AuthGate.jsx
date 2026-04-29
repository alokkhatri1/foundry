import { useState, useEffect, createContext, useContext } from 'react';
import { supabase } from '../supabase';
import useSupabase from '../hooks/useSupabase';
import JoinScreen from './JoinScreen';
import FoundryLanding from './FoundryLanding';
import AdminDashboard from './AdminDashboard';

const AuthContext = createContext({ isAdmin: false, openAdmin: () => {} });

export function useAuth() { return useContext(AuthContext); }

export default function AuthGate({ children, onJoin, workshopCode }) {
  const sb = useSupabase();
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  // Tri-state so the UI can distinguish "still checking" from "definitely not
  // admin" from "check failed". Before this, `isAdmin: false` covered all
  // three cases and the Admin Dashboard button just silently never appeared,
  // which read as "I can't log in" during the 04-23 session.
  const [adminStatus, setAdminStatus] = useState('unknown'); // 'unknown' | 'yes' | 'no' | 'error'
  const [adminError, setAdminError] = useState(null);
  const isAdmin = adminStatus === 'yes';
  // Persist across hard refreshes. Without this, admins on the dashboard
  // get bounced back into whatever workshop their saved state pointed to,
  // which felt like the platform was forgetting them. localStorage scopes
  // to this browser/profile, so signing out clears it via signOut() below.
  const [showAdmin, setShowAdminState] = useState(() => {
    try { return localStorage.getItem('sandbox:show-admin') === '1'; } catch { return false; }
  });
  const setShowAdmin = (next) => {
    setShowAdminState(next);
    try {
      if (next) localStorage.setItem('sandbox:show-admin', '1');
      else localStorage.removeItem('sandbox:show-admin');
    } catch {}
  };

  // Manual retry for when the initial check failed (e.g. RLS blip). Called
  // from JoinScreen's "Retry admin check" link when adminStatus === 'error'.
  async function retryAdminCheck() {
    if (!session?.user) return;
    setAdminStatus('unknown');
    setAdminError(null);
    try {
      const admin = await sb.checkIsAdmin(session.user.id);
      setAdminStatus(admin ? 'yes' : 'no');
    } catch (err) {
      console.error('[auth] retry checkIsAdmin failed:', err);
      setAdminStatus('error');
      setAdminError(err?.message || 'Admin check failed');
    }
  }

  useEffect(() => {
    let mounted = true;

    async function init() {
      // Handle implicit OAuth callback: #access_token= in URL hash
      const hash = window.location.hash;
      if (hash && hash.includes('access_token')) {
        console.log('[auth] access_token found in hash, setting session...');
        // Parse hash params
        const hashParams = new URLSearchParams(hash.substring(1));
        const accessToken = hashParams.get('access_token');
        const refreshToken = hashParams.get('refresh_token');

        if (accessToken && refreshToken) {
          const { data, error } = await supabase.auth.setSession({
            access_token: accessToken,
            refresh_token: refreshToken,
          });
          if (error) {
            console.error('[auth] setSession failed:', error.message);
          } else {
            console.log('[auth] session set:', data.session?.user?.email);
          }
        }
        // Clean hash from URL
        window.history.replaceState(null, '', window.location.pathname);
      }

      // Handle PKCE callback: ?code= in URL
      const params = new URLSearchParams(window.location.search);
      const code = params.get('code');
      if (code) {
        console.log('[auth] PKCE code found, exchanging...');
        const { data, error } = await supabase.auth.exchangeCodeForSession(code);
        if (error) console.error('[auth] code exchange failed:', error.message);
        else console.log('[auth] code exchange success:', data.session?.user?.email);
        window.history.replaceState(null, '', window.location.pathname);
      }

      // Check session
      const { data: { session: s } } = await supabase.auth.getSession();
      console.log('[auth] final session:', s ? s.user?.email : 'none');
      if (mounted) {
        setSession(s);
        if (s?.user) {
          await resolveAdmin(s.user.id);
        } else {
          setAdminStatus('no');
        }
        setLoading(false);
      }
    }

    async function resolveAdmin(userId) {
      if (!mounted) return;
      setAdminStatus('unknown');
      setAdminError(null);
      try {
        const admin = await sb.checkIsAdmin(userId);
        if (!mounted) return;
        setAdminStatus(admin ? 'yes' : 'no');
      } catch (err) {
        console.error('[auth] checkIsAdmin failed:', err);
        if (!mounted) return;
        setAdminStatus('error');
        setAdminError(err?.message || 'Admin check failed');
      }
    }

    init();

    // Listen for future auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, s) => {
      console.log('[auth] state change:', _event, s?.user?.email);
      if (mounted) {
        setSession(s);
        if (s?.user) resolveAdmin(s.user.id);
        else setAdminStatus('no');
        setLoading(false);
      }
    });

    return () => { mounted = false; subscription.unsubscribe(); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Loading
  if (loading) {
    return (
      <div className="landing">
        <div className="landing-content" style={{ justifyContent: 'center' }}>
          <div className="landing-wordmark" style={{ margin: '0 auto', textAlign: 'center' }}>
            <span className="landing-wordmark-name">Foundry</span>
            <span className="landing-wordmark-by">
              {' '}by{' '}
              <a href="https://alokkhatri.com" target="_blank" rel="noopener noreferrer">Alok Khatri</a>
            </span>
          </div>
        </div>
      </div>
    );
  }

  // Not authenticated — show the marketing landing page. Every CTA on it
  // calls sb.signInWithGoogle(); the post-OAuth redirect lands back in
  // this AuthGate which then takes the authenticated branches below.
  if (!session) {
    return <FoundryLanding onSignIn={() => sb.signInWithGoogle()} />;
  }

  // Authenticated admin — show dashboard. Two ways to leave it:
  //   1. onBack (the "Enter Workshop" button in the topbar) — closes the
  //      panel and falls through to JoinScreen so the admin can type a code.
  //   2. onEnterWorkshop(code) — direct hop into a specific workshop from
  //      the admin list, bypassing the join screen entirely.
  if (isAdmin && showAdmin) {
    const adminName = session.user?.user_metadata?.full_name
      || session.user?.email?.split('@')[0] || 'Admin';
    return (
      <AdminDashboard
        sb={sb}
        user={session.user}
        onBack={() => setShowAdmin(false)}
        onEnterWorkshop={async (code) => {
          if (!code) return;
          // bypassDeprecation lets admins enter delivered workshops as a
          // participant for browsing — the joinRoom guard and the
          // workshopEnded → GraduationScreen routing both honour it.
          const result = await onJoin(
            adminName,
            code.toUpperCase(),
            session.user?.id,
            session.user?.email,
            { bypassDeprecation: true },
          );
          if (!result?.error) setShowAdmin(false);
        }}
      />
    );
  }

  // Authenticated but no workshop code — show join screen
  if (!workshopCode) {
    return (
      <JoinScreen
        user={session.user}
        isAdmin={isAdmin}
        adminStatus={adminStatus}
        adminError={adminError}
        onRetryAdminCheck={retryAdminCheck}
        onJoin={onJoin}
        onSignOut={() => sb.signOut()}
        onAdminDashboard={() => setShowAdmin(true)}
      />
    );
  }

  // Authenticated + in workshop — render the app. Expose isAdmin and a
  // setter so the in-workshop UI can offer a jump-back-to-admin shortcut.
  return (
    <AuthContext.Provider value={{ isAdmin, openAdmin: () => setShowAdmin(true) }}>
      {children}
    </AuthContext.Provider>
  );
}
