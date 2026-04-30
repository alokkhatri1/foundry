import './FoundryLanding.css';

// Marketing landing page shown to unauthenticated visitors. Replaces the
// minimal sign-in screen that AuthGate used to render in its !session branch.
// Every CTA delegates to onSignIn (the existing sb.signInWithGoogle handler)
// so post-sign-in routing stays in AuthGate.
//
// Visual language follows the cream + peach + dark-brown card aesthetic from
// alokkhatri.com: bold sans headlines, peach highlight on a key phrase, a
// floating pill header, and dark-brown rounded cards for high-contrast
// sections (thesis + closing CTA).

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

export default function FoundryLanding({ onSignIn }) {
  return (
    <div className="foundry-landing">
      <header className="fl-header">
        <div className="fl-header-pill">
          <div className="fl-brand">
            Foundry <span className="fl-brand-by">by Alok Khatri</span>
          </div>
          <nav className="fl-nav">
            <a href="#thesis">Thesis</a>
            <a href="#arc">The arc</a>
            <a href="#why">Why this works</a>
            <a className="fl-nav-cta" href="#join" onClick={(e) => { e.preventDefault(); onSignIn?.(); }}>Sign in</a>
          </nav>
        </div>
      </header>

      <section className="fl-hero">
        <div className="wrap">
          <div className="fl-eyebrow">For senior operators</div>
          <h1 className="fl-h1">
            You can&rsquo;t train your way to{' '}
            <span className="fl-highlight">AI native.</span>
          </h1>
          <p className="fl-hero-sub">
            A six-hour workshop sandbox where senior operators live through the shift from org chart to agent chart, with AI as a peer in the room. Built on Liberating Structures and the AI Nativity framework.
          </p>
          <div className="fl-cta-row">
            <CtaButton onClick={onSignIn}>Continue with Google</CtaButton>
            <span className="fl-cta-note">Sign in to join a workshop session</span>
          </div>

          <div className="fl-proof">
            <span className="fl-proof-dot" />
            <span className="fl-proof-num">3,300+</span>
            <span className="fl-proof-label">professionals trained across cohorts</span>
          </div>

          <div className="fl-byline">
            <div>
              <span className="name">Alok Khatri</span>
              <span className="roles"> &nbsp;&middot;&nbsp; Founder, Tangible Careers &nbsp;&middot;&nbsp; Founder, MSTC</span>
            </div>
          </div>
        </div>
      </section>

      <div className="fl-section-dark-wrap" id="thesis">
        <section className="fl-section-dark">
          <div className="fl-section-eyebrow">The thesis</div>
          <p className="fl-thesis-quote">
            AI isn&rsquo;t a tool your team uses. It&rsquo;s the <em>operating system</em> your company runs on. Hierarchy was the routing protocol of the old company. The intelligence layer is the routing protocol of the new one &mdash; and humans sit at the edges, guiding it rather than relaying through it.
          </p>
          <div className="fl-thesis-attr">&mdash; The Delegation Dilemma</div>
        </section>
      </div>

      <section className="fl-section" id="arc">
        <div className="wrap">
          <div className="fl-section-eyebrow">The arc</div>
          <h2 className="fl-h2">Six hours. Four movements. One new shape of work.</h2>
          <p className="fl-lede">
            You walk in using AI like a chatbox. You leave having orchestrated a mixed team of humans and AI through a real workflow, with every decision on the record. Most of what shifts is invisible &mdash; and that&rsquo;s the point.
          </p>

          <div className="fl-arc-grid">
            <div className="fl-arc-card">
              <span className="fl-arc-num">01 &middot; Shape it</span>
              <div className="fl-arc-title">From chatbox to context engine.</div>
              <p className="fl-arc-body">
                Preferences, files, and skills make the AI your AI. By the end of the first hour, you&rsquo;ve authored behavior, not just consumed it.
              </p>
            </div>
            <div className="fl-arc-card">
              <span className="fl-arc-num">02 &middot; Name it</span>
              <div className="fl-arc-title">Build a coworker.</div>
              <p className="fl-arc-body">
                Package instructions, knowledge, and persona into a named teammate. Not a prompt. Not a bot. A coworker who produces artifacts the rest of the room can read.
              </p>
            </div>
            <div className="fl-arc-card">
              <span className="fl-arc-num">03 &middot; Mix it</span>
              <div className="fl-arc-title">Orchestrate the mixed team.</div>
              <p className="fl-arc-body">
                Wire AI coworkers and humans into a real workflow on a visual canvas. Each step produces. Each review gates. The artifact only exists when the team agrees.
              </p>
            </div>
            <div className="fl-arc-card">
              <span className="fl-arc-num">04 &middot; Own it</span>
              <div className="fl-arc-title">See the loop close.</div>
              <p className="fl-arc-body">
                Every run leaves a trail. Every trail makes the next coworker smarter. You leave with a competency scorecard built from what you actually did &mdash; not a participation tile.
              </p>
            </div>
          </div>
        </div>
      </section>

      <section className="fl-section" id="why">
        <div className="wrap">
          <div className="fl-section-eyebrow">Why this works</div>
          <div className="fl-pillars-intro">
            <h2 className="fl-h2">Most AI workshops teach tools. Foundry rehearses a new shape of work.</h2>
            <p className="fl-lede">
              Three principles separate a sandbox from a slide deck. Each one is felt, not lectured.
            </p>
          </div>

          <div className="fl-pillars">
            <div className="fl-pillar">
              <div className="fl-pillar-icon">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="9" />
                  <path d="M12 3v18M3 12h18" />
                </svg>
              </div>
              <h3>The whole organization is queryable.</h3>
              <p>
                Nothing important happens off-record. Files are shared. Decisions land on the trail. The intelligence layer can read the company&rsquo;s state at any moment &mdash; because every action left an artifact behind.
              </p>
            </div>
            <div className="fl-pillar">
              <div className="fl-pillar-icon">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M4 12c0-4.4 3.6-8 8-8s8 3.6 8 8" />
                  <path d="M20 12c0 4.4-3.6 8-8 8s-8-3.6-8-8" />
                  <path d="M16 8l-2 2M8 16l2-2" />
                </svg>
              </div>
              <h3>Every loop closes.</h3>
              <p>
                Open-loop organizations decide, execute, and forget. AI-native organizations decide, execute, observe, and feed the result into the next pass. Each cycle leaves the team smarter than the last.
              </p>
            </div>
            <div className="fl-pillar">
              <div className="fl-pillar-icon">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="8" cy="8" r="3" />
                  <circle cx="16" cy="16" r="3" />
                  <path d="M11 8h2M11 16h2M8 11v2M16 11v2" />
                </svg>
              </div>
              <h3>AI and humans are peers.</h3>
              <p>
                Same sidebar. Same DM. Same role in a workflow. Liberating Structures provide the grammar for working as peers when no one is the manager &mdash; and AI takes a seat at the table.
              </p>
            </div>
          </div>
        </div>
      </section>

      <div className="fl-section-dark-wrap" id="join">
        <section className="fl-section-dark">
          <div className="fl-section-eyebrow">Ready</div>
          <h2 className="fl-closing-h2">The org chart you came in with isn&rsquo;t the one you&rsquo;ll leave with.</h2>
          <p className="fl-closing-sub">
            Foundry runs as a closed cohort with a live facilitator. Sign in to claim a seat or request a private session for your team.
          </p>
          <div className="fl-cta-row">
            <CtaButton onClick={onSignIn}>Continue with Google</CtaButton>
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
            <span className="roles"> &nbsp;&middot;&nbsp; Founder, Tangible Careers &nbsp;&middot;&nbsp; Founder, MSTC</span>
          </div>
          <div className="right">&copy; 2026 Foundry. A workshop sandbox.</div>
        </div>
      </footer>
    </div>
  );
}
