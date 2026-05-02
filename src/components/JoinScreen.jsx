import { useState, useRef } from 'react';
import './FoundryLanding.css'; // pulls in the :root tokens (cream, peach, etc.)
import './JoinScreen.css';

// Code-entry screen shown after Google sign-in but before joining a
// workshop. Reuses the marketing landing's design language so the
// sign-in → join handoff feels like one experience.
//
// The code input is a 3 + dot + 3 segmented row of cells. Workshop
// codes here are 6-character base36 (alphanumeric, uppercase) — see
// useSupabase.createWorkshop — so the cells accept letters and digits
// and uppercase as the user types.

const ARROW = (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <line x1="7" y1="17" x2="17" y2="7" />
    <polyline points="7 7 17 7 17 17" />
  </svg>
);

const CODE_LENGTH = 6;
const ALNUM_RX = /[^A-Z0-9]/g;

function CodeInput({ value, onChange, hasError, autoFocus }) {
  const refs = useRef([]);

  const setChar = (i, ch) => {
    const next = value.split('');
    next[i] = ch;
    while (next.length < CODE_LENGTH) next.push('');
    onChange(next.slice(0, CODE_LENGTH).join(''));
  };

  const handleChange = (i, e) => {
    const ch = e.target.value.toUpperCase().replace(ALNUM_RX, '').slice(-1);
    if (!ch) { setChar(i, ''); return; }
    setChar(i, ch);
    if (i < CODE_LENGTH - 1) refs.current[i + 1]?.focus();
  };

  const handleKey = (i, e) => {
    if (e.key === 'Backspace') {
      if (value[i]) {
        setChar(i, '');
      } else if (i > 0) {
        refs.current[i - 1]?.focus();
        setChar(i - 1, '');
      }
    } else if (e.key === 'ArrowLeft' && i > 0) {
      refs.current[i - 1]?.focus();
    } else if (e.key === 'ArrowRight' && i < CODE_LENGTH - 1) {
      refs.current[i + 1]?.focus();
    } else if (e.key === 'Enter') {
      // Bubble Enter so the surrounding form/button can submit.
      e.target.blur();
    }
  };

  const handlePaste = e => {
    const text = (e.clipboardData?.getData('text') || '').toUpperCase().replace(ALNUM_RX, '').slice(0, CODE_LENGTH);
    if (!text) return;
    e.preventDefault();
    onChange(text.padEnd(CODE_LENGTH, ' ').slice(0, CODE_LENGTH).replace(/ /g, ''));
    const focusIdx = Math.min(text.length, CODE_LENGTH - 1);
    setTimeout(() => refs.current[focusIdx]?.focus(), 0);
  };

  return (
    <div className="code-row">
      {[0, 1, 2].map(i => (
        <input
          key={i}
          ref={el => (refs.current[i] = el)}
          className={`code-cell ${value[i] ? 'filled' : ''} ${hasError ? 'error' : ''}`}
          inputMode="text"
          maxLength={1}
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          value={value[i] || ''}
          onChange={e => handleChange(i, e)}
          onKeyDown={e => handleKey(i, e)}
          onPaste={handlePaste}
          aria-label={`Character ${i + 1}`}
          autoFocus={autoFocus && i === 0}
        />
      ))}
      <div className="code-divider" aria-hidden="true">·</div>
      {[3, 4, 5].map(i => (
        <input
          key={i}
          ref={el => (refs.current[i] = el)}
          className={`code-cell ${value[i] ? 'filled' : ''} ${hasError ? 'error' : ''}`}
          inputMode="text"
          maxLength={1}
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          value={value[i] || ''}
          onChange={e => handleChange(i, e)}
          onKeyDown={e => handleKey(i, e)}
          onPaste={handlePaste}
          aria-label={`Character ${i + 1}`}
        />
      ))}
    </div>
  );
}

export default function JoinScreen({ user, isAdmin, adminStatus, adminError, onRetryAdminCheck, onJoin, onSignOut, onAdminDashboard }) {
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [joining, setJoining] = useState(false);

  const userName = user?.user_metadata?.full_name || user?.email?.split('@')[0] || 'Participant';
  const codeFull = code.length === CODE_LENGTH;
  const ready = codeFull && !joining && !error;

  function setCodeAndClearError(next) {
    setCode(next);
    if (error) setError('');
  }

  async function handleJoin() {
    if (!codeFull) { setError('Enter all six characters of your workshop code.'); return; }
    setError('');
    setJoining(true);
    // Defense in depth: if onJoin throws (e.g. any sb.* call in the join
    // chain rejects), we must still clear the spinner and show something
    // actionable — otherwise the button sits on "Joining…" forever and
    // the user thinks the app is dead.
    try {
      const result = await onJoin(userName, code.trim().toUpperCase(), user?.id, user?.email);
      if (result?.error) {
        const msg = result.error === 'not_found'
          ? "That code didn't match a live workshop."
          : result.error === 'deprecated'
          ? 'This workshop has ended.'
          : result.message
          ? `Could not join workshop: ${result.message}`
          : 'Could not join workshop. Please try again.';
        setError(msg);
        setJoining(false);
      }
      // No success branch — App routes the participant out of JoinScreen
      // when onJoin succeeds, so this component unmounts.
    } catch (err) {
      console.error('[join] unexpected error:', err);
      setError('Something went wrong joining the workshop. Please try again.');
      setJoining(false);
    }
  }

  function statusEl() {
    if (joining) {
      return <div className="code-status checking"><span className="dot" />Joining…</div>;
    }
    if (error) {
      return <div className="code-status error"><span className="dot" />{error}</div>;
    }
    if (codeFull) {
      return <div className="code-status ready"><span className="dot" />Ready to join</div>;
    }
    return <div className="code-status" />;
  }

  return (
    <div className="join-page">
      <main className="join-main join-main--centered">
        <div className="join-wrap-narrow">
          <div className="join-brand-line">
            Foundry
            <span className="join-brand-by">
              by <a href="https://alokkhatri.com" target="_blank" rel="noopener noreferrer">Alok Khatri</a>
            </span>
          </div>
          <h1 className="join-welcome-h--centered">
            Welcome, <span className="fl-highlight"><em>{userName}</em></span>
          </h1>

          <div className="join-card">
            <div className="join-card-eyebrow">Workshop access</div>
            <h2 className="join-card-h">Join a Workshop</h2>
            <p className="join-card-sub">Enter the code provided by your facilitator.</p>

            <CodeInput
              value={code}
              onChange={setCodeAndClearError}
              hasError={!!error}
              autoFocus
            />
            {statusEl()}

            <button
              className="join-card-cta"
              disabled={!ready}
              onClick={handleJoin}
            >
              {joining ? 'Joining' : 'Join Workshop'}
              <span className="join-card-cta-arrow">{ARROW}</span>
            </button>

            <div className="join-card-foot">
              {isAdmin && (
                <button onClick={onAdminDashboard}>Admin Dashboard</button>
              )}
              {adminStatus === 'error' && (
                <button
                  className="join-foot-error"
                  onClick={onRetryAdminCheck}
                  title={adminError || 'Admin check failed'}
                >
                  Admin check failed — Retry
                </button>
              )}
              <button onClick={onSignOut} style={{ marginLeft: 'auto' }}>Sign Out</button>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
