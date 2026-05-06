import { REFLECTION_PROMPTS } from '../data/reflectionPrompts';
import { LEVELS } from '../utils/graduationScorecard';

// One-page synthesis takeaway. Rendered offscreen, captured by
// html2canvas, embedded into a single A4-portrait jsPDF page. The doc
// is meant to *help the participant reflect*, not enumerate everything
// they did — so it picks one signal from each piece of data they
// generated:
//
//   - their voice         → hero quote pulled from their longest note
//   - their progress      → confidence ladder across the eight primitives
//   - their commitments   → their accumulated habit answers as a practice plan
//   - their next move     → three carry-forward prompts authored by us
//
// Sized to fit a single A4 portrait page; if a participant didn't
// reflect on every stage, the page just gets quieter, not longer.

const REFLECTION_STAGES_ORDERED = ['3', '4', '5', '6', '7', '8', '9', '10'];

// Three prompts for the participant to sit with after the workshop.
// Authored, not collected — the per-stage habit answers above are the
// "what to do tomorrow"; these are the "what to think about beyond it".
const CARRY_FORWARD = [
  'Which primitive felt easiest, and which still feels fuzzy?',
  'What’s the first real workflow at work where you’ll start applying this?',
  'Who on your team would benefit most from learning this with you?',
];

function pickHeroQuote(reflections) {
  // Pull the longest non-empty reflection note as the hero. Length is a
  // proxy for "they had the most to say there" — better than picking
  // the first or last, both of which are positional accidents.
  let best = null;
  for (const r of (reflections || [])) {
    const text = (r.note || '').trim();
    if (!text) continue;
    if (!best || text.length > best.text.length) {
      best = { text, stage: String(r.stage) };
    }
  }
  return best;
}

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

  const levelWord = (typeof level === 'number' && LEVELS[level]) ? LEVELS[level] : null;
  const metaParts = [userName || 'Participant'];
  if (orgName) metaParts.push(orgName);
  metaParts.push(`Issued ${date}`);
  if (levelWord) metaParts.push(`Level: ${levelWord}`);

  const hero = pickHeroQuote(reflections);
  const heroLabel = hero ? (REFLECTION_PROMPTS[hero.stage]?.label || `Stage ${hero.stage}`) : null;

  // Practice plan: each habit the participant wrote, paired with its stage.
  const practicePlan = REFLECTION_STAGES_ORDERED
    .map(stage => {
      const r = reflectionsByStage.get(stage);
      const habit = r?.habit?.trim();
      if (!habit) return null;
      return {
        stage,
        label: REFLECTION_PROMPTS[stage]?.label || `Stage ${stage}`,
        habit,
      };
    })
    .filter(Boolean);

  return (
    <div className="gr-handout">
      {/* Cover */}
      <header className="gr-handout-cover">
        <div className="gr-handout-eyebrow">
          <span className="gr-handout-eyebrow-dot" aria-hidden />
          FOUNDRY · WORKSHOP TAKEAWAY
        </div>
        <h1 className="gr-handout-title">
          What you learned,&nbsp;<em>what to try next</em>.
        </h1>
        <div className="gr-handout-meta">
          {metaParts.map((p, i) => (
            <span key={i} className="gr-handout-meta-bit">{p}</span>
          ))}
        </div>
      </header>

      {/* Hero quote — their voice, pulled from their longest reflection */}
      {hero && (
        <section className="gr-handout-hero">
          <div className="gr-handout-hero-eyebrow">In your own words</div>
          <blockquote className="gr-handout-hero-quote">
            {hero.text}
          </blockquote>
          <div className="gr-handout-hero-attr">— Stage {hero.stage} · {heroLabel}</div>
        </section>
      )}

      {/* Confidence ladder — visual snapshot of their progress */}
      <section className="gr-handout-ladder-section">
        <div className="gr-handout-section-eyebrow">THE ARC OF YOUR UNDERSTANDING</div>
        <div className="gr-handout-ladder">
          {REFLECTION_STAGES_ORDERED.map(stage => {
            const r = reflectionsByStage.get(stage);
            const confidence = typeof r?.confidence === 'number' ? r.confidence : 0;
            const label = REFLECTION_PROMPTS[stage]?.label || `Stage ${stage}`;
            return (
              <div key={stage} className="gr-handout-ladder-row">
                <span className="gr-handout-ladder-stage">Stage {stage}</span>
                <span className="gr-handout-ladder-name">{label}</span>
                <span className="gr-handout-ladder-dots" aria-label={`${confidence} of 5`}>
                  {[1, 2, 3, 4, 5].map(n => (
                    <span
                      key={n}
                      className={`gr-handout-ladder-dot${n <= confidence ? ' is-on' : ''}`}
                      aria-hidden
                    />
                  ))}
                </span>
                <span className="gr-handout-ladder-num">{confidence || '—'}</span>
              </div>
            );
          })}
        </div>
      </section>

      {/* Practice plan — their accumulated habit answers */}
      {practicePlan.length > 0 && (
        <section className="gr-handout-practice">
          <div className="gr-handout-section-eyebrow">YOUR PRACTICE PLAN</div>
          <h2 className="gr-handout-practice-title">
            Eight small habits,&nbsp;<em>in your own hand</em>.
          </h2>
          <ol className="gr-handout-practice-list">
            {practicePlan.map(item => (
              <li key={item.stage} className="gr-handout-practice-item">
                <div className="gr-handout-practice-stage">{item.label}</div>
                <div className="gr-handout-practice-text">{item.habit}</div>
              </li>
            ))}
          </ol>
        </section>
      )}

      {/* Carry forward — authored prompts for after the workshop */}
      <section className="gr-handout-carry">
        <div className="gr-handout-section-eyebrow">CARRY FORWARD</div>
        <ol className="gr-handout-carry-list">
          {CARRY_FORWARD.map((q, i) => (
            <li key={i} className="gr-handout-carry-item">{q}</li>
          ))}
        </ol>
      </section>

      {/* Closer */}
      <footer className="gr-handout-closer">
        <div className="gr-handout-closer-mark">
          <svg viewBox="0 0 80 24" aria-hidden>
            <path d="M 4 18 C 14 4, 24 22, 34 12 S 54 4, 64 18" stroke="#d97757" strokeWidth="1.5" fill="none" strokeLinecap="round" />
            <circle cx="68" cy="18" r="1.5" fill="#d97757" />
          </svg>
        </div>
      </footer>
    </div>
  );
}
