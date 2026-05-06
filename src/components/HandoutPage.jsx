import { REFLECTION_PROMPTS } from '../data/reflectionPrompts';
import { LEVELS } from '../utils/graduationScorecard';

// Designed takeaway page. Rendered offscreen, captured by html2canvas,
// embedded into jsPDF (image-based PDF, not text-based — same approach
// the certificate uses, accepts a file-size hit in exchange for the
// editorial typography and brand styling). Multi-page slicing happens
// in handoutPdf.js after the capture.
//
// Empty sections render nothing so a participant who didn't reach
// capstone (or didn't fill reflections) doesn't get hollow headers.

function fileLookup(flatFiles) {
  const map = new Map();
  for (const f of (flatFiles || [])) map.set(f.id, f);
  return map;
}
function nameForFile(byId, id) { const f = byId.get(id); return f ? f.name.replace(/\.md$/, '') : id; }
function nameForParticipant(participants, id) {
  const p = (participants || []).find(x => x.id === id);
  return p ? p.name : id;
}

export default function HandoutPage({
  userName,
  orgName,
  level,
  date,
  scorecard,
  reflections,
  capstoneRows,
  coworkers,
  workflows,
  flatFiles,
  participants,
}) {
  const orderedReflectionStages = ['3', '4', '5', '6', '7', '8', '9', '10'];
  const reflectionRows = (reflections || [])
    .filter(r => orderedReflectionStages.includes(String(r.stage)))
    .sort((a, b) => Number(a.stage) - Number(b.stage));

  const filledCapstone = (capstoneRows || []).filter(row => {
    const step = (row.step || '').trim();
    const node = (row.node || '').trim();
    return step.length > 0 || node.length > 0;
  });

  const myCoworkers = (coworkers || []).filter(c => (c.createdBy || c.created_by) === userName);
  const myWorkflows = (workflows || []).filter(w => (w.createdBy || w.created_by) === userName);
  const fileById = fileLookup(flatFiles);

  const levelWord = (typeof level === 'number' && LEVELS[level]) ? LEVELS[level] : null;
  const metaParts = [userName || 'Participant'];
  if (orgName) metaParts.push(orgName);
  metaParts.push(`Issued ${date}`);
  if (levelWord) metaParts.push(`Level: ${levelWord}`);

  return (
    <div className="gr-handout">
      {/* Cover */}
      <header className="gr-handout-cover">
        <div className="gr-handout-eyebrow">
          <span className="gr-handout-eyebrow-dot" aria-hidden />
          FOUNDRY · WORKSHOP TAKEAWAY
        </div>
        <h1 className="gr-handout-title">
          What you built,&nbsp;<em>what you learned</em>.
        </h1>
        <div className="gr-handout-meta">
          {metaParts.map((p, i) => (
            <span key={i} className="gr-handout-meta-bit">{p}</span>
          ))}
        </div>
      </header>

      {/* Reflections */}
      {reflectionRows.length > 0 && (
        <section className="gr-handout-section">
          <div className="gr-handout-section-eyebrow">SECTION ONE</div>
          <h2 className="gr-handout-section-title">
            Six primitives,&nbsp;<em>in your own words</em>.
          </h2>
          <p className="gr-handout-section-sub">Your understanding rating and your reflection on each stage of the workshop.</p>
          <div className="gr-handout-reflections">
            {reflectionRows.map(r => {
              const prompt = REFLECTION_PROMPTS[String(r.stage)];
              const label = prompt ? prompt.label : `Stage ${r.stage}`;
              return (
                <div key={r.stage} className="gr-handout-reflection">
                  <div className="gr-handout-reflection-head">
                    <span className="gr-handout-reflection-stage">Stage {r.stage}</span>
                    <span className="gr-handout-reflection-rule" aria-hidden />
                    <span className="gr-handout-reflection-label">{label}</span>
                  </div>
                  {typeof r.confidence === 'number' && (
                    <div className="gr-handout-reflection-confidence">
                      <span className="gr-handout-reflection-confidence-l">Understanding</span>
                      <span className="gr-handout-reflection-confidence-v">{r.confidence}</span>
                      <span className="gr-handout-reflection-confidence-of">/ 5</span>
                    </div>
                  )}
                  {r.note && r.note.trim() && (
                    <blockquote className="gr-handout-quote">
                      {r.note.trim()}
                    </blockquote>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* Capstone */}
      {filledCapstone.length > 0 && (
        <section className="gr-handout-section">
          <div className="gr-handout-section-eyebrow">SECTION TWO</div>
          <h2 className="gr-handout-section-title">
            Your capstone,&nbsp;<em>step by step</em>.
          </h2>
          <p className="gr-handout-section-sub">The end-to-end workflow you laid out at the close of the workshop.</p>
          <div className="gr-handout-steps">
            {filledCapstone.map((row, i) => {
              const num = String(i + 1).padStart(2, '0');
              const type = (row.type || 'coworker') === 'human' ? 'Human' : 'Coworker';
              const heading = (row.step || '').trim() || `Step ${i + 1}`;
              const knowledgeNames = (row.knowledgeFileIds || []).map(id => nameForFile(fileById, id)).filter(Boolean);
              const skillsNames = (row.skillsFileIds || []).map(id => nameForFile(fileById, id)).filter(Boolean);
              return (
                <div key={i} className={`gr-handout-step is-${type.toLowerCase()}`}>
                  <div className="gr-handout-step-head">
                    <span className="gr-handout-step-num">{num}</span>
                    <span className="gr-handout-step-type">{type}</span>
                  </div>
                  <h3 className="gr-handout-step-name">{heading}</h3>
                  <dl className="gr-handout-step-fields">
                    {row.node && row.node.trim() && (
                      <><dt>Role</dt><dd>{row.node.trim()}</dd></>
                    )}
                    {knowledgeNames.length > 0 && (
                      <><dt>Reads</dt><dd>{knowledgeNames.join(', ')}</dd></>
                    )}
                    {skillsNames.length > 0 && (
                      <><dt>Produces</dt><dd>{skillsNames.join(', ')}</dd></>
                    )}
                    {row.reviewerId && (
                      <><dt>Reviewer</dt><dd>{nameForParticipant(participants, row.reviewerId)}</dd></>
                    )}
                    {row.remarks && row.remarks.trim() && (
                      <><dt>Notes</dt><dd>{row.remarks.trim()}</dd></>
                    )}
                  </dl>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* What you built */}
      {(myCoworkers.length > 0 || myWorkflows.length > 0) && (
        <section className="gr-handout-section">
          <div className="gr-handout-section-eyebrow">SECTION THREE</div>
          <h2 className="gr-handout-section-title">
            What you built,&nbsp;<em>by your own hand</em>.
          </h2>
          <p className="gr-handout-section-sub">Coworkers and workflows credited to you in the room.</p>
          {myCoworkers.length > 0 && (
            <div className="gr-handout-collection">
              <div className="gr-handout-collection-head">Coworkers <span>({myCoworkers.length})</span></div>
              {myCoworkers.map(c => (
                <div key={c.id} className="gr-handout-collection-row">
                  <span className="gr-handout-collection-name">{c.name}</span>
                  <span className="gr-handout-collection-meta">{(c.role || '').slice(0, 80) || '—'}</span>
                </div>
              ))}
            </div>
          )}
          {myWorkflows.length > 0 && (
            <div className="gr-handout-collection">
              <div className="gr-handout-collection-head">Workflows <span>({myWorkflows.length})</span></div>
              {myWorkflows.map(w => {
                const stepCount = Array.isArray(w.steps) ? w.steps.length : 0;
                return (
                  <div key={w.id} className="gr-handout-collection-row">
                    <span className="gr-handout-collection-name">{w.name}</span>
                    <span className="gr-handout-collection-meta">{stepCount} step{stepCount === 1 ? '' : 's'}</span>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      )}

      {/* Scorecard */}
      {scorecard && Array.isArray(scorecard.dimensions) && scorecard.dimensions.length > 0 && (
        <section className="gr-handout-section">
          <div className="gr-handout-section-eyebrow">SECTION FOUR</div>
          <h2 className="gr-handout-section-title">
            Six ladders,&nbsp;<em>your read on each</em>.
          </h2>
          <p className="gr-handout-section-sub">A snapshot of where you landed across the primitives.</p>
          <div className="gr-handout-scorecard">
            {scorecard.dimensions.map(d => {
              const word = LEVELS[d.level] || '—';
              return (
                <div key={d.key} className="gr-handout-score-row">
                  <span className="gr-handout-score-name">{d.title || d.key}</span>
                  <span className="gr-handout-score-level">{word}</span>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* Closing */}
      <footer className="gr-handout-closer">
        <div className="gr-handout-closer-mark">
          <svg viewBox="0 0 80 24" aria-hidden>
            <path d="M 4 18 C 14 4, 24 22, 34 12 S 54 4, 64 18" stroke="#d97757" strokeWidth="1.5" fill="none" strokeLinecap="round" />
            <circle cx="68" cy="18" r="1.5" fill="#d97757" />
          </svg>
        </div>
        <div className="gr-handout-closer-text">
          Generated by Foundry. Save this somewhere you’ll see it when you next sit down to build.
        </div>
      </footer>
    </div>
  );
}
