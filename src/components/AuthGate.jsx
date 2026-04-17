import { useState, useEffect } from 'react';
import useSupabase from '../hooks/useSupabase';
import JoinScreen from './JoinScreen';
import AdminDashboard from './AdminDashboard';

export default function AuthGate({ children, onJoin, workshopCode }) {
  const sb = useSupabase();
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);
  const [showAdmin, setShowAdmin] = useState(false);

  useEffect(() => {
    let mounted = true;

    async function init() {
      // If URL has hash with access_token, Supabase should auto-detect it
      // Give it a moment to process the callback
      const hash = window.location.hash;
      if (hash && hash.includes('access_token')) {
        console.log('[auth] detected OAuth callback in URL hash');
        // Clean the hash from URL
        window.history.replaceState(null, '', window.location.pathname);
        // Wait for Supabase to process
        await new Promise(r => setTimeout(r, 500));
      }

      const s = await sb.getSession();
      console.log('[auth] session:', s ? s.user.email : 'none');
      if (mounted) {
        setSession(s);
        if (s?.user) {
          const admin = await sb.checkIsAdmin(s.user.id);
          setIsAdmin(admin);
        }
        setLoading(false);
      }
    }

    init();

    const unsub = sb.onAuthStateChange(s => {
      console.log('[auth] state change:', s ? 'signed in' : 'signed out');
      if (mounted) {
        setSession(s);
        if (s?.user) sb.checkIsAdmin(s.user.id).then(a => mounted && setIsAdmin(a));
        else setIsAdmin(false);
        setLoading(false);
      }
    });

    return () => { mounted = false; unsub(); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Loading
  if (loading) {
    return (
      <div className="landing">
        <div className="landing-content" style={{ justifyContent: 'center' }}>
          <div className="landing-brand" style={{ margin: '0 auto' }}>
            <div className="landing-logo">F</div>
            <span className="landing-logo-text">Foundry</span>
          </div>
        </div>
      </div>
    );
  }

  // Not authenticated — show landing with OAuth
  if (!session) {
    return (
      <div className="landing">
        <div className="landing-content">
          <div className="landing-left">
            <div className="landing-brand">
              <div className="landing-logo">F</div>
              <span className="landing-logo-text">Foundry</span>
            </div>
            <h1 className="landing-title">
              Learn to build<br />
              <span className="landing-highlight">AI-native teams</span>
            </h1>
            <p className="landing-subtitle">
              A hands-on workshop simulator. Create AI coworkers, give them knowledge and instructions, and wire them into real workflows.
            </p>
          </div>

          <div className="landing-right">
            <div className="landing-card">
              <h2 className="landing-card-title">Get Started</h2>
              <p className="landing-card-desc">Sign in to join a workshop session.</p>

              <button className="landing-oauth-btn google" onClick={() => sb.signInWithGoogle()}>
                <svg width="18" height="18" viewBox="0 0 24 24"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/></svg>
                Continue with Google
              </button>

              <button className="landing-oauth-btn linkedin" onClick={() => sb.signInWithLinkedin()}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="#0A66C2"><path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 01-2.063-2.065 2.064 2.064 0 112.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/></svg>
                Continue with LinkedIn
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Authenticated admin — show dashboard
  if (isAdmin && showAdmin) {
    return <AdminDashboard sb={sb} user={session.user} onBack={() => setShowAdmin(false)} />;
  }

  // Authenticated but no workshop code — show join screen
  if (!workshopCode) {
    return (
      <JoinScreen
        user={session.user}
        isAdmin={isAdmin}
        onJoin={onJoin}
        onSignOut={() => sb.signOut()}
        onAdminDashboard={() => setShowAdmin(true)}
      />
    );
  }

  // Authenticated + in workshop — render the app
  return children;
}
