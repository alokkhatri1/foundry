import { REFLECTION_PROMPTS } from '../data/reflectionPrompts';
import { LEVELS } from '../utils/graduationScorecard';

// Reflections takeaway. Rendered offscreen, captured by html2canvas,
// embedded as A4 portrait pages in jsPDF. The doc is just a clean,
// well-designed record of what the participant wrote — for each stage
// they reflected on, we show the stage's intent (the anchor we
// authored) plus their understanding rating, their note, and their
// daily-action habit.
//
// Multi-page is fine — handoutPdf.js slices the captured canvas into
// page-height chunks. Empty stages are skipped so the doc only grows
// with what the participant actually generated.

// Stages 1, 2, and 9 (Graduation) don't have reflection prompts in the
// 9-stage arc, so they're absent here. The takeaway PDF iterates this
// list and renders one card per stage that has content.
const REFLECTION_STAGES_ORDERED = ['3', '4', '5', '6', '7', '8'];

export default function HandoutPage({
  userName,
  orgName,
  level,
  date,
  reflections,
}) {
  const reflectionsByStage = new Map();
  for (const r of (reflections || [])) {
    reflectionsByStage.set(String(r.stage), r);
  }

  // Only show stages where the participant actually wrote something.
  const filledStages = REFLECTION_STAGES_ORDERED
    .map(stage => ({ stage, prompt: REFLECTION_PROMPTS[stage], r: reflectionsByStage.get(stage) }))
    .filter(({ r }) => r && (r.note?.trim() || r.habit?.trim() || typeof r.confidence === 'number'));

  const levelWord = (typeof level === 'number' && LEVELS[level]) ? LEVELS[level] : null;
  const metaParts = [userName || 'Participant'];
  if (orgName) metaParts.push(orgName);
  metaParts.push(`Issued ${date}`);
  if (levelWord) metaParts.push(`Level: ${levelWord}`);

  return (
    <div className="gr-takeaway">
      {/* Cover */}
      <header className="gr-takeaway-cover">
        <div className="gr-takeaway-eyebrow">
          <span className="gr-takeaway-eyebrow-dot" aria-hidden />
          FOUNDRY · YOUR REFLECTIONS
        </div>
        <h1 className="gr-takeaway-title">
          You rehearse&nbsp;<em>to become AI native</em>.
        </h1>
        <div className="gr-takeaway-meta">
          {metaParts.map((p, i) => (
            <span key={i} className="gr-takeaway-meta-bit">{p}</span>
          ))}
        </div>
      </header>

      {/* Per-stage reflection cards */}
      <div className="gr-takeaway-cards">
        {filledStages.map(({ stage, prompt, r }) => (
          <article key={stage} className="gr-takeaway-card">
            <header className="gr-takeaway-card-head">
              <div className="gr-takeaway-card-meta">
                <span className="gr-takeaway-card-stage">Stage {stage}</span>
                {typeof r.confidence === 'number' && (
                  <span className="gr-takeaway-card-rating" aria-label={`Understanding ${r.confidence} of 5`}>
                    {[1, 2, 3, 4, 5].map(n => (
                      <span
                        key={n}
                        className={`gr-takeaway-card-rating-dot${n <= r.confidence ? ' is-on' : ''}`}
                        aria-hidden
                      />
                    ))}
                    <span className="gr-takeaway-card-rating-num">{r.confidence} / 5</span>
                  </span>
                )}
              </div>
              <h2 className="gr-takeaway-card-label">{prompt?.label || `Stage ${stage}`}</h2>
              {prompt?.anchor && (
                <p className="gr-takeaway-card-anchor"><em>{prompt.anchor}</em></p>
              )}
            </header>

            {r.note && r.note.trim() && (
              <div className="gr-takeaway-card-section">
                <div className="gr-takeaway-card-section-label">What you wrote</div>
                <blockquote className="gr-takeaway-card-quote">{r.note.trim()}</blockquote>
              </div>
            )}

            {r.habit && r.habit.trim() && (
              <div className="gr-takeaway-card-section">
                <div className="gr-takeaway-card-section-label">What you’ll try</div>
                <blockquote className="gr-takeaway-card-quote">{r.habit.trim()}</blockquote>
              </div>
            )}
          </article>
        ))}
      </div>

      {/* Closer */}
      <footer className="gr-takeaway-closer">
        <div className="gr-takeaway-closer-mark">
          <svg viewBox="0 0 80 24" aria-hidden>
            <path d="M 4 18 C 14 4, 24 22, 34 12 S 54 4, 64 18" stroke="#d97757" strokeWidth="1.5" fill="none" strokeLinecap="round" />
            <circle cx="68" cy="18" r="1.5" fill="#d97757" />
          </svg>
        </div>
        <div className="gr-takeaway-closer-text">
          Save this somewhere you’ll see it when you next sit down to build.
        </div>
        <div className="gr-takeaway-closer-credit">
          Foundry by Alok Khatri
        </div>
      </footer>
    </div>
  );
}
