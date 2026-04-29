import './FoundryLanding.css';

// Marketing landing page shown to unauthenticated visitors. Replaces the
// minimal sign-in screen that AuthGate used to render in its !session branch.
// Every CTA delegates to onSignIn (the existing sb.signInWithGoogle handler)
// so post-sign-in routing stays in AuthGate. The Blueprint/stages-table
// section from the design source was deliberately omitted.
export default function FoundryLanding({ onSignIn }) {
  return (
    <div className="foundry-landing">
      <nav>
        <div className="wrap">
          <div className="brand">
            <span className="brand-mark">Foundry</span>
            <span className="brand-tag">A workshop sandbox</span>
          </div>
          <div className="nav-links">
            <a href="#thesis">Thesis</a>
            <a href="#arc">The arc</a>
            <a href="#join">Join</a>
          </div>
        </div>
      </nav>

      <header className="hero">
        <div className="wrap">
          <div className="eyebrow">For senior operators</div>
          <h1>
            You can&rsquo;t train your way
            <span className="accent">to AI native.</span>
          </h1>
          <p className="hero-sub">
            A six-hour workshop sandbox where senior operators live through the shift from org chart to agent chart, with AI as a peer in the room. Built on Liberating Structures and the AI Nativity framework.
          </p>
          <div className="cta-row">
            <button className="btn-primary" onClick={onSignIn}>
              <svg width="18" height="18" viewBox="0 0 24 24">
                <path fill="#F5EFE4" d="M21.35 11.1h-9.17v2.73h6.51c-.33 3.81-3.5 5.44-6.5 5.44C8.36 19.27 5 16.25 5 12c0-4.1 3.2-7.27 7.2-7.27 3.09 0 4.9 1.97 4.9 1.97L19 4.72S16.56 2 12.1 2C6.42 2 2.03 6.8 2.03 12c0 5.05 4.13 10 10.22 10 5.35 0 9.25-3.67 9.25-9.09 0-1.15-.15-1.81-.15-1.81Z" />
              </svg>
              Continue with Google
            </button>
            <span className="cta-note">Sign in to join a workshop session</span>
          </div>

          <div className="hero-byline">
            <div>
              <span className="name">Alok Khatri</span>
              <span className="roles"> &nbsp;&middot;&nbsp; Founder, Tangible Careers &nbsp;&middot;&nbsp; Founder, MSTC</span>
            </div>
          </div>
        </div>
      </header>

      <section className="thesis bordered" id="thesis">
        <div className="wrap">
          <div className="section-eyebrow">The thesis</div>
          <p className="thesis-quote">
            AI isn&rsquo;t a tool your team uses. It&rsquo;s the <em>operating system</em> your company runs on. Hierarchy was the routing protocol of the old company. The intelligence layer is the routing protocol of the new one &mdash; and humans sit at the edges, guiding it rather than relaying through it.
          </p>
          <div className="thesis-attr">&mdash; The Delegation Dilemma</div>
        </div>
      </section>

      <section className="bordered" id="arc">
        <div className="wrap">
          <div className="section-eyebrow">The arc</div>
          <h2>Six hours. Four movements. One new shape of work.</h2>
          <p className="section-lede">
            You walk in using AI like a chatbox. You leave having orchestrated a mixed team of humans and AI through a real workflow, with every decision on the record. Most of what shifts is invisible &mdash; and that&rsquo;s the point.
          </p>

          <div className="arc-grid">
            <div className="arc-item">
              <div className="arc-num">01 &nbsp; Shape it</div>
              <div className="arc-title">From chatbox to context engine.</div>
              <p className="arc-body">
                Preferences, files, and skills make the AI your AI. By the end of the first hour, you&rsquo;ve authored behavior, not just consumed it.
              </p>
            </div>
            <div className="arc-item">
              <div className="arc-num">02 &nbsp; Name it</div>
              <div className="arc-title">Build a coworker.</div>
              <p className="arc-body">
                Package instructions, knowledge, and persona into a named teammate. Not a prompt. Not a bot. A coworker who produces artifacts the rest of the room can read.
              </p>
            </div>
            <div className="arc-item">
              <div className="arc-num">03 &nbsp; Mix it</div>
              <div className="arc-title">Orchestrate the mixed team.</div>
              <p className="arc-body">
                Wire AI coworkers and humans into a real workflow on a visual canvas. Each step produces. Each review gates. The artifact only exists when the team agrees.
              </p>
            </div>
            <div className="arc-item">
              <div className="arc-num">04 &nbsp; Own it</div>
              <div className="arc-title">See the loop close.</div>
              <p className="arc-body">
                Every run leaves a trail. Every trail makes the next coworker smarter. You leave with a competency scorecard built from what you actually did &mdash; not a participation tile.
              </p>
            </div>
          </div>
        </div>
      </section>

      <section className="bordered">
        <div className="wrap">
          <div className="section-eyebrow">Why this works</div>
          <div className="pillars-intro">
            <h2>Most AI workshops teach tools. Foundry rehearses a new shape of work.</h2>
            <p className="section-lede">
              Three principles separate a sandbox from a slide deck. Each one is felt, not lectured.
            </p>
          </div>

          <div className="pillars">
            <div className="pillar">
              <svg className="pillar-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <circle cx="12" cy="12" r="9" />
                <path d="M12 3v18M3 12h18" />
              </svg>
              <h3>The whole organization is queryable.</h3>
              <p>
                Nothing important happens off-record. Files are shared. Decisions land on the trail. The intelligence layer can read the company&rsquo;s state at any moment &mdash; because every action left an artifact behind.
              </p>
            </div>
            <div className="pillar">
              <svg className="pillar-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M4 12c0-4.4 3.6-8 8-8s8 3.6 8 8" />
                <path d="M20 12c0 4.4-3.6 8-8 8s-8-3.6-8-8" />
                <path d="M16 8l-2 2M8 16l2-2" />
              </svg>
              <h3>Every loop closes.</h3>
              <p>
                Open-loop organizations decide, execute, and forget. AI-native organizations decide, execute, observe, and feed the result into the next pass. Each cycle leaves the team smarter than the last.
              </p>
            </div>
            <div className="pillar">
              <svg className="pillar-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <circle cx="8" cy="8" r="3" />
                <circle cx="16" cy="16" r="3" />
                <path d="M11 8h2M11 16h2M8 11v2M16 11v2" />
              </svg>
              <h3>AI and humans are peers.</h3>
              <p>
                Same sidebar. Same DM. Same role in a workflow. Liberating Structures provide the grammar for working as peers when no one is the manager &mdash; and AI takes a seat at the table.
              </p>
            </div>
          </div>
        </div>
      </section>

      <section className="closing" id="join">
        <div className="wrap">
          <div className="section-eyebrow" style={{ color: 'rgba(245, 239, 228, 0.5)' }}>Ready</div>
          <h2>The org chart you came in with isn&rsquo;t the one you&rsquo;ll leave with.</h2>
          <p className="closing-sub">
            Foundry runs as a closed cohort with a live facilitator. Sign in to claim a seat or request a private session for your team.
          </p>
          <div className="cta-row">
            <button className="btn-primary" onClick={onSignIn}>
              <svg width="18" height="18" viewBox="0 0 24 24">
                <path fill="#1a1a1a" d="M21.35 11.1h-9.17v2.73h6.51c-.33 3.81-3.5 5.44-6.5 5.44C8.36 19.27 5 16.25 5 12c0-4.1 3.2-7.27 7.2-7.27 3.09 0 4.9 1.97 4.9 1.97L19 4.72S16.56 2 12.1 2C6.42 2 2.03 6.8 2.03 12c0 5.05 4.13 10 10.22 10 5.35 0 9.25-3.67 9.25-9.09 0-1.15-.15-1.81-.15-1.81Z" />
              </svg>
              Continue with Google
            </button>
            <span className="cta-note">
              Or email <a href="mailto:alok@mstc.ai">alok@mstc.ai</a> to book a private cohort.
            </span>
          </div>
        </div>
      </section>

      <footer>
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
