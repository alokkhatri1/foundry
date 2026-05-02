import { useEffect, useState, useRef } from 'react';
import './FoundryLanding.css';

// Marketing landing page shown to unauthenticated visitors. Composed of
// a sticky pill header, a hero with an animated org-chart-to-agent-chart
// stage, a dark thesis card, the four-card "arc" of the workshop, three
// principles ("why this works"), and a closing CTA. Every sign-in
// affordance routes through the onSignIn prop so post-auth handling
// stays in AuthGate.
//
// All sub-components (HeroStage, the four arc fragments, useReveal,
// CtaButton, ArrowIcon) live in this file — they're tightly coupled to
// the landing-only CSS and aren't reused anywhere else.

function ArrowIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <line x1="7" y1="17" x2="17" y2="7" />
      <polyline points="7 7 17 7 17 17" />
    </svg>
  );
}

function CtaButton({ onClick, children }) {
  return (
    <button className="fl-cta" onClick={onClick}>
      {children}
      <span className="fl-cta-arrow"><ArrowIcon /></span>
    </button>
  );
}

// Reveal-on-scroll hook. Adds a `js-reveal-ready` class to <html> so the
// CSS opt-in kicks in (otherwise everything stays visible — degrades
// gracefully if JS or IntersectionObserver is missing). Falls back after
// 2s by force-revealing anything that hasn't intersected, so a section
// the user never scrolls to still becomes visible if they navigate
// directly to it via anchor.
function useReveal() {
  useEffect(() => {
    document.documentElement.classList.add('js-reveal-ready');
    const els = document.querySelectorAll('.reveal');
    if (!('IntersectionObserver' in window)) {
      els.forEach(el => el.classList.add('in'));
      return;
    }
    const io = new IntersectionObserver(entries => {
      entries.forEach(e => {
        if (e.isIntersecting) {
          e.target.classList.add('in');
          io.unobserve(e.target);
        }
      });
    }, { threshold: 0.12, rootMargin: '0px 0px -40px 0px' });
    els.forEach(el => io.observe(el));
    const t = setTimeout(() => {
      document.querySelectorAll('.reveal:not(.in)').forEach(el => el.classList.add('in'));
    }, 2000);
    return () => {
      io.disconnect();
      clearTimeout(t);
      document.documentElement.classList.remove('js-reveal-ready');
    };
  }, []);
}

// Hero stage — the org chart morphs into an agent chart and back every
// 4.2 seconds. Pauses on hover; users can also click the Org/Agent
// pill toggle to lock a side. Two layouts share the same node ids;
// `posOf` resolves the active layout's coordinates per node.
// Cadence for the org → agent → org animation. The initial delay is
// deliberately short so a first-time visitor sees the morph almost
// immediately on landing — without it, the hero looks static for the
// first several seconds and the whole "shape of work" point lands late.
// The steady-state interval is longer so the cycling doesn't feel
// strobe-y once the page is sitting in view.
const HERO_FIRST_TOGGLE_MS = 900;
const HERO_INTERVAL_MS = 3200;

function HeroStage() {
  const [mode, setMode] = useState('org'); // 'org' | 'agent'
  // Single timer ref — holds either a setTimeout id (during the
  // initial-delay phase) or a setInterval id (steady state). Both
  // clearTimeout and clearInterval can safely be called against either
  // per the HTML timer spec.
  const timerRef = useRef(null);

  const cycle = () => setMode(m => (m === 'org' ? 'agent' : 'org'));

  const stopTimer = () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  };

  useEffect(() => {
    // Fast first toggle, then settle into the steady interval.
    timerRef.current = setTimeout(() => {
      cycle();
      timerRef.current = setInterval(cycle, HERO_INTERVAL_MS);
    }, HERO_FIRST_TOGGLE_MS);
    return stopTimer;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pause = () => stopTimer();
  const resume = () => {
    stopTimer();
    timerRef.current = setInterval(cycle, HERO_INTERVAL_MS);
  };

  const nodes = [
    { id: 'ceo', label: 'CEO', role: 'Director', initials: 'K',
      org:   { x: 50, y: 12 },
      agent: { x: 50, y: 50, ai: true, label: 'Foundry', role: 'Intelligence layer', initials: '◆' } },
    { id: 'vp1', label: 'VP Eng', role: 'Manager', initials: 'JM',
      org:   { x: 22, y: 36 },
      agent: { x: 18, y: 22 } },
    { id: 'vp2', label: 'VP Product', role: 'Manager', initials: 'AS',
      org:   { x: 50, y: 36 },
      agent: { x: 82, y: 22 } },
    { id: 'vp3', label: 'VP Ops', role: 'Manager', initials: 'LR',
      org:   { x: 78, y: 36 },
      agent: { x: 50, y: 78 } },
    { id: 'ic1', label: 'Engineer', role: 'IC', initials: 'DT',
      org:   { x: 18, y: 62 },
      agent: { x: 12, y: 50 } },
    { id: 'ic2', label: 'Designer', role: 'IC', initials: 'MN',
      org:   { x: 50, y: 62 },
      agent: { x: 88, y: 50 } },
    { id: 'ic3', label: 'Researcher', role: 'IC', initials: 'PV',
      org:   { x: 82, y: 62 },
      agent: { x: 18, y: 72, ai: true, label: 'Researcher.ai', role: 'Coworker', initials: 'RX' } },
    { id: 'ic4', label: '', role: '', initials: '',
      org:   { x: 50, y: 50, hidden: true },
      agent: { x: 82, y: 72, ai: true, label: 'Analyst.ai', role: 'Coworker', initials: 'AY' } },
    { id: 'ic5', label: '', role: '', initials: '',
      org:   { x: 50, y: 50, hidden: true },
      agent: { x: 50, y: 14, ai: true, label: 'Writer.ai', role: 'Coworker', initials: 'WR' } },
  ];

  const orgEdges = [
    ['ceo', 'vp1'], ['ceo', 'vp2'], ['ceo', 'vp3'],
    ['vp1', 'ic1'],
    ['vp2', 'ic2'],
    ['vp3', 'ic3'],
  ];
  const agentEdges = [
    ['ceo', 'vp1'], ['ceo', 'vp2'], ['ceo', 'vp3'],
    ['ceo', 'ic1'], ['ceo', 'ic2'], ['ceo', 'ic3'],
    ['ceo', 'ic4'], ['ceo', 'ic5'],
  ];

  const isAgent = mode === 'agent';
  const edges = isAgent ? agentEdges : orgEdges;

  const posOf = id => {
    const n = nodes.find(x => x.id === id);
    return isAgent ? n.agent : n.org;
  };

  const captionFor = mode === 'org'
    ? { label: 'Before', text: 'Hierarchy is the routing protocol.' }
    : { label: 'After',  text: 'The intelligence layer routes; humans guide.' };

  return (
    <div className="hero-stage" onMouseEnter={pause} onMouseLeave={resume}>
      <div className="hero-stage-label">
        <span style={{
          width: 6, height: 6, borderRadius: 99,
          background: 'var(--peach-deep)', display: 'inline-block',
        }} />
        Live
      </div>

      <div className="hero-stage-toggle">
        <button className={mode === 'org' ? 'on' : ''} onClick={() => { pause(); setMode('org'); }}>
          Org
        </button>
        <button className={mode === 'agent' ? 'on' : ''} onClick={() => { pause(); setMode('agent'); }}>
          Agent
        </button>
      </div>

      <svg className="hero-svg" viewBox="0 0 100 100" preserveAspectRatio="none">
        {edges.map(([a, b], i) => {
          const pa = posOf(a);
          const pb = posOf(b);
          const na = nodes.find(x => x.id === a);
          const nb = nodes.find(x => x.id === b);
          const aHidden = (isAgent ? na.agent.hidden : na.org.hidden);
          const bHidden = (isAgent ? nb.agent.hidden : nb.org.hidden);
          if (aHidden || bHidden) return null;
          return (
            <line
              key={`${mode}-${i}`}
              className={`hero-link ${isAgent ? 'is-ai' : ''}`}
              x1={pa.x} y1={pa.y}
              x2={pb.x} y2={pb.y}
              vectorEffect="non-scaling-stroke"
            />
          );
        })}
      </svg>

      {nodes.map(n => {
        const p = isAgent ? n.agent : n.org;
        if (p.hidden) return null;
        const ai = isAgent && p.ai;
        const label = (isAgent && p.label) || n.label;
        const role  = (isAgent && p.role)  || n.role;
        const initials = (isAgent && p.initials) || n.initials;
        return (
          <div
            key={n.id}
            className={`org-node ${ai ? 'is-ai' : ''}`}
            style={{ left: `${p.x}%`, top: `${p.y}%`, transform: 'translate(-50%, -50%)' }}
          >
            <div className="org-node-avatar">{initials}</div>
            <div style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.15 }}>
              <span>{label}</span>
              <span className="org-node-meta">{role}</span>
            </div>
          </div>
        );
      })}

      <div className="hero-stage-caption">
        <div>
          <div className="hero-stage-caption-label">{captionFor.label}</div>
          <div className="hero-stage-caption-text">{captionFor.text}</div>
        </div>
        <div style={{ display: 'flex', gap: 4 }}>
          <span style={{
            width: 6, height: 6, borderRadius: 99,
            background: mode === 'org' ? 'var(--peach)' : 'rgba(241,229,209,0.3)',
            transition: 'background .3s',
          }} />
          <span style={{
            width: 6, height: 6, borderRadius: 99,
            background: mode === 'agent' ? 'var(--peach)' : 'rgba(241,229,209,0.3)',
            transition: 'background .3s',
          }} />
        </div>
      </div>
    </div>
  );
}

// Mini UI fragments live inside the four arc cards. Each one is a
// purpose-built sketch of what that movement of the workshop produces.

function Frag01ContextEngine() {
  return (
    <div className="frag-01">
      <div className="frag-prompt-bar">
        <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--ink-muted)', letterSpacing: '.08em' }}>›</span>
        <span>Draft the Q3 retention memo using</span>
        <span className="frag-prompt-cursor" />
      </div>
      <div className="frag-chip-row">
        <span className="frag-chip on"><span className="frag-chip-dot" />retention-memo template</span>
        <span className="frag-chip on"><span className="frag-chip-dot" />my voice profile</span>
        <span className="frag-chip"><span className="frag-chip-dot" />last 12 board updates</span>
        <span className="frag-chip"><span className="frag-chip-dot" />candor mode</span>
        <span className="frag-chip on"><span className="frag-chip-dot" />concise</span>
      </div>
    </div>
  );
}

function Frag02Coworker() {
  return (
    <div className="frag-02">
      <div className="frag-coworker-card">
        <div className="frag-coworker-head">
          <div className="frag-coworker-avatar">RX</div>
          <div>
            <div className="frag-coworker-name">Ravi the Researcher</div>
            <div className="frag-coworker-role">COWORKER · ACTIVE</div>
          </div>
        </div>
        <div className="frag-coworker-attrs">
          <div className="frag-coworker-attr"><span>Reads</span><span>14 docs</span></div>
          <div className="frag-coworker-attr"><span>Writes</span><span>memos, decks</span></div>
          <div className="frag-coworker-attr"><span>Reports to</span><span>You</span></div>
        </div>
      </div>
    </div>
  );
}

function Frag03Workflow() {
  return (
    <div className="frag-03">
      <div className="frag-canvas">
        <svg className="frag-flow-svg" viewBox="0 0 100 100" preserveAspectRatio="none">
          <path d="M 18 22 C 35 22, 35 50, 50 50" className="hero-link is-ai" vectorEffect="non-scaling-stroke" />
          <path d="M 18 78 C 35 78, 35 50, 50 50" className="hero-link" vectorEffect="non-scaling-stroke" />
          <path d="M 50 50 C 65 50, 65 30, 82 30" className="hero-link is-ai" vectorEffect="non-scaling-stroke" />
          <path d="M 50 50 C 65 50, 65 75, 82 75" className="hero-link" vectorEffect="non-scaling-stroke" />
        </svg>
        <div className="frag-flow-node ai" style={{ left: '4%', top: '14%' }}>
          <span className="frag-flow-node-dot">RX</span>Ravi · researches
        </div>
        <div className="frag-flow-node" style={{ left: '4%', top: '70%' }}>
          <span className="frag-flow-node-dot">YO</span>You · gates
        </div>
        <div className="frag-flow-node" style={{ left: '36%', top: '42%' }}>
          <span className="frag-flow-node-dot">M</span>Merge
        </div>
        <div className="frag-flow-node ai" style={{ left: '66%', top: '22%' }}>
          <span className="frag-flow-node-dot">WR</span>Writer.ai
        </div>
        <div className="frag-flow-node" style={{ left: '66%', top: '67%' }}>
          <span className="frag-flow-node-dot">PM</span>Priya · reviews
        </div>
      </div>
    </div>
  );
}

function Frag04Trail() {
  const rows = [
    { label: '01', name: 'Authored context', pct: 100 },
    { label: '02', name: 'Built coworker', pct: 100 },
    { label: '03', name: 'Orchestrated team', pct: 84 },
    { label: '04', name: 'Closed the loop', pct: 62 },
  ];
  return (
    <div className="frag-04">
      {rows.map(r => (
        <div className="frag-trail-row" key={r.label}>
          <div>
            <span className="label">{r.label}</span>
            <span className="name">{r.name}</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div className="frag-trail-bar">
              <div className="frag-trail-bar-fill" style={{ width: `${r.pct}%` }} />
            </div>
            <span className="pct">{r.pct}%</span>
          </div>
        </div>
      ))}
    </div>
  );
}

export default function FoundryLanding({ onSignIn }) {
  useReveal();

  const handleSignIn = () => onSignIn?.();

  return (
    <div className="foundry-landing">
      <header className="fl-header">
        <div className="fl-header-pill">
          <a className="fl-brand-mark" href="#top">
            <div className="fl-brand-glyph">F</div>
            <div>
              <div className="fl-brand-name">Foundry</div>
              <span className="fl-brand-by">by Alok Khatri</span>
            </div>
          </a>
          <nav className="fl-nav">
            <a href="#thesis">Thesis</a>
            <a href="#arc">The arc</a>
            <a href="#why">Why this works</a>
            <a className="fl-nav-cta" href="#join" onClick={e => { e.preventDefault(); handleSignIn(); }}>
              <span className="fl-nav-cta-dot" />
              Sign in
            </a>
          </nav>
        </div>
      </header>

      <section className="fl-hero" id="top" data-screen-label="Hero">
        <div className="wrap">
          <div className="fl-hero-grid">
            <div className="fade-in">
              <div className="fl-eyebrow">Professionals · cohort 07 open</div>
              <h1 className="fl-h1">
                You can&rsquo;t <em>train</em> your way to become{' '}
                <span className="fl-highlight">AI&nbsp;native.</span>
                <br />You <em>rehearse</em> it.
              </h1>
              <p className="fl-hero-sub">
                A workshop sandbox where professionals live through the shift from org chart to agent chart, with AI as a peer in the room.
              </p>
              <div className="fl-cta-row">
                <CtaButton onClick={handleSignIn}>Continue with Google</CtaButton>
              </div>

              <div className="fl-proof">
                <span className="fl-proof-dot" />
                <span className="fl-proof-num">3,300+</span>
                <span className="fl-proof-label">professionals trained across cohorts</span>
              </div>
            </div>
            <div className="fade-in" style={{ animationDelay: '.15s' }}>
              <HeroStage />
            </div>
          </div>
        </div>
      </section>

      <div className="fl-section-dark-wrap reveal" id="thesis" data-screen-label="Thesis">
        <section className="fl-section-dark">
          <div className="fl-section-eyebrow">The thesis</div>
          <p className="fl-thesis-quote">
            AI isn&rsquo;t a tool your team uses. It&rsquo;s the <em>operating system</em> your company runs on. Hierarchy was the routing protocol of the old company. The intelligence layer is the routing protocol of the new one. Humans sit at the edges, guiding it rather than relaying through it.
          </p>
          <div className="fl-thesis-attr">— The Delegation Dilemma</div>
        </section>
      </div>

      <section className="fl-section" id="arc" data-screen-label="The arc">
        <div className="wrap">
          <div className="fl-arc-head reveal">
            <div>
              <div className="fl-section-eyebrow">The arc</div>
              <h2 className="fl-h2">Six hours.<br />Four movements.<br /><em>One new shape of work.</em></h2>
            </div>
            <p className="fl-lede">
              You walk in using AI like a chatbox. You leave having orchestrated a mixed team of humans and AI through a real workflow, with every decision on the record. Most of what shifts is invisible, and that&rsquo;s the point.
            </p>
          </div>

          <div className="fl-arc-grid">
            <div className="fl-arc-card reveal">
              <div className="fl-arc-card-visual"><Frag01ContextEngine /></div>
              <div className="fl-arc-card-body">
                <span className="fl-arc-num">01 <span className="fl-arc-num-divider">/</span> Shape it</span>
                <div className="fl-arc-title">From chatbox to context engine.</div>
                <p className="fl-arc-body">
                  Preferences, files, and skills make the AI <em>your</em> AI. By the end of the first hour, you&rsquo;ve authored behavior, not just consumed it.
                </p>
              </div>
            </div>

            <div className="fl-arc-card reveal" style={{ transitionDelay: '.08s' }}>
              <div className="fl-arc-card-visual"><Frag02Coworker /></div>
              <div className="fl-arc-card-body">
                <span className="fl-arc-num">02 <span className="fl-arc-num-divider">/</span> Name it</span>
                <div className="fl-arc-title">Build a coworker.</div>
                <p className="fl-arc-body">
                  Package instructions, knowledge, and persona into a named teammate. Not a prompt. Not a bot. A coworker who produces artifacts the rest of the room can read.
                </p>
              </div>
            </div>

            <div className="fl-arc-card reveal">
              <div className="fl-arc-card-visual"><Frag03Workflow /></div>
              <div className="fl-arc-card-body">
                <span className="fl-arc-num">03 <span className="fl-arc-num-divider">/</span> Mix it</span>
                <div className="fl-arc-title">Orchestrate the mixed team.</div>
                <p className="fl-arc-body">
                  Wire AI coworkers and humans into a real workflow on a visual canvas. Each step produces. Each review gates. The artifact only exists when the team agrees.
                </p>
              </div>
            </div>

            <div className="fl-arc-card reveal" style={{ transitionDelay: '.08s' }}>
              <div className="fl-arc-card-visual"><Frag04Trail /></div>
              <div className="fl-arc-card-body">
                <span className="fl-arc-num">04 <span className="fl-arc-num-divider">/</span> Own it</span>
                <div className="fl-arc-title">See the loop close.</div>
                <p className="fl-arc-body">
                  Every run leaves a trail. Every trail makes the next coworker smarter. You leave with a competency scorecard built from what you actually did, not a participation tile.
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="fl-section" id="why" data-screen-label="Why this works" style={{ paddingTop: 32 }}>
        <div className="wrap">
          <div className="reveal">
            <div className="fl-section-eyebrow">Why this works</div>
            <h2 className="fl-h2" style={{ maxWidth: 880 }}>
              Most AI workshops teach tools.<br />Foundry <em>rehearses</em> a new shape of work.
            </h2>
            <p className="fl-lede" style={{ marginTop: 18 }}>
              Three principles separate a sandbox from a slide deck. Each one is felt, not lectured.
            </p>
          </div>

          <div className="fl-pillars">
            <div className="fl-pillar reveal">
              <div className="fl-pillar-icon">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="9" />
                  <path d="M3 12h18M12 3v18" />
                  <circle cx="12" cy="12" r="4" />
                </svg>
              </div>
              <div className="fl-pillar-num">Principle 01</div>
              <h3>The whole organization is queryable.</h3>
              <p>Nothing important happens off-record. Files are shared. Decisions land on the trail. The intelligence layer can read the company&rsquo;s state at any moment, because every action left an artifact behind.</p>
            </div>
            <div className="fl-pillar reveal" style={{ transitionDelay: '.08s' }}>
              <div className="fl-pillar-icon">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 12a9 9 0 1 1-3-6.7" />
                  <polyline points="21 4 21 10 15 10" />
                </svg>
              </div>
              <div className="fl-pillar-num">Principle 02</div>
              <h3>Every loop closes.</h3>
              <p>Open-loop organizations decide, execute, and forget. AI-native organizations decide, execute, observe, and feed the result into the next pass. Each cycle leaves the team smarter than the last.</p>
            </div>
            <div className="fl-pillar reveal" style={{ transitionDelay: '.16s' }}>
              <div className="fl-pillar-icon">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="7" cy="8" r="3" />
                  <circle cx="17" cy="16" r="3" />
                  <path d="M10 8h4M10 16h4M7 11v2M17 11v2" />
                </svg>
              </div>
              <div className="fl-pillar-num">Principle 03</div>
              <h3>AI and humans are peers.</h3>
              <p>Same sidebar. Same DM. Same role in a workflow. Liberating Structures provide the grammar for working as peers when no one is the manager. AI takes a seat at the table.</p>
            </div>
          </div>
        </div>
      </section>

      <div className="fl-section-dark-wrap reveal" id="join" data-screen-label="Join">
        <section className="fl-section-dark">
          <div className="fl-section-eyebrow">Ready</div>
          <h2 className="fl-closing-h2">
            The org chart you came in with<br />isn&rsquo;t the one you&rsquo;ll <em>leave</em> with.
          </h2>
          <p className="fl-closing-sub">
            Foundry runs as a closed cohort with a live facilitator. Sign in to claim a seat or request a private session for your team.
          </p>
          <div className="fl-cta-row">
            <CtaButton onClick={handleSignIn}>Continue with Google</CtaButton>
            <span className="fl-cta-note">
              Or email <a href="mailto:alok@mstc.ai">alok@mstc.ai</a> to book a private cohort.
            </span>
          </div>
        </section>
      </div>

      <footer className="fl-footer">
        <div className="wrap">
          <div className="left">
            <span className="name">Alok Khatri</span>
            <span> · Founder, Tangible Careers · Founder, MSTC</span>
          </div>
          <div className="right">© 2026 Foundry. A workshop sandbox.</div>
        </div>
      </footer>
    </div>
  );
}
