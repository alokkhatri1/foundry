import { useEffect, useMemo, useState } from 'react';
import { computeScorecard, LEVELS, LEVEL_COLORS } from '../utils/graduationScorecard';
import FeedbackForm from './FeedbackForm';

// Graduation screen — the "Own it" moment at workshop end. Editorial
// closing-letter posture: certificate plate (name + level + wax seal),
// hairline tally strip, letterhead-block dimensions with a 4-dot ladder
// and one italic line of evidence. Empty rows look complete; a level-4
// "influence" callout surfaces when the participant's work shaped peers.
//
// Before the rubric reveals, every participant must submit the
// post-workshop feedback survey once. The gate is per (workshop_id,
// participant_id) and short-circuits if a row already exists in
// workshop_feedback.

const OVERALL_HINTS = {
  0: "you didn't get a chance to use the platform this week.",
  1: "you've seen the shape of each primitive.",
  2: 'you put every piece into practice at least once.',
  3: 'you moved past first-use and started refining.',
  4: 'your work shaped how others on the team worked.',
};

function pad2(n) { return String(n).padStart(2, '0'); }

function formatIssuedDate(d) {
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}

export default function GraduationScreen({
  userName,
  conversations,
  coworkers,
  workflows,
  workflowRuns,
  flatFiles,
  participants,
  tools,
  fileTree,
  userPreferences,
  loadAllRoomApprovals,
  onSignOut,
  embedded = false,
  sb,
  myParticipantId,
}) {
  const [approvals, setApprovals] = useState(null);
  const [capstoneRows, setCapstoneRows] = useState(null);
  // Feedback gate state. 'unknown' until we've checked Supabase, then either
  // 'pending' (show form) or 'submitted' (show rubric). Without sb or a
  // participant id we can't gate, so fall through to 'submitted' silently.
  const canGate = !!(sb && myParticipantId);
  const [feedbackStatus, setFeedbackStatus] = useState(canGate ? 'unknown' : 'submitted');
  const [submitting, setSubmitting] = useState(false);
  const [feedbackError, setFeedbackError] = useState(null);

  // Issuance date is the moment the participant first sees the rubric.
  // Captured once on mount so re-renders don't shift the printed date.
  const issuedDate = useMemo(() => formatIssuedDate(new Date()), []);

  useEffect(() => {
    let cancelled = false;
    loadAllRoomApprovals?.().then(rows => {
      if (!cancelled) setApprovals(rows || []);
    }).catch(() => { if (!cancelled) setApprovals([]); });
    return () => { cancelled = true; };
  }, [loadAllRoomApprovals]);

  // Load the participant's Capstone draft so the scorecard's Capstone
  // dimension can score it. No draft = treated as "Not Started" by the
  // rubric, which is correct.
  useEffect(() => {
    if (!sb || !myParticipantId) {
      setCapstoneRows([]);
      return;
    }
    let cancelled = false;
    sb.loadCapstoneDraft(myParticipantId).then(rows => {
      if (cancelled) return;
      setCapstoneRows(Array.isArray(rows) ? rows : []);
    }).catch(() => { if (!cancelled) setCapstoneRows([]); });
    return () => { cancelled = true; };
  }, [sb, myParticipantId]);

  useEffect(() => {
    if (!canGate) return;
    let cancelled = false;
    sb.loadMyFeedback(myParticipantId).then(row => {
      if (cancelled) return;
      setFeedbackStatus(row ? 'submitted' : 'pending');
    }).catch(() => {
      // On error, don't strand the participant — let them through. The DB
      // unique constraint still prevents duplicate inserts on a later submit.
      if (!cancelled) setFeedbackStatus('submitted');
    });
    return () => { cancelled = true; };
  }, [canGate, sb, myParticipantId]);

  const scorecard = useMemo(() => {
    if (approvals === null) return null;
    if (capstoneRows === null) return null;
    return computeScorecard({
      userName, conversations, coworkers, workflows, workflowRuns,
      flatFiles, participants, approvals, tools, fileTree, userPreferences,
      capstoneRows,
    });
  }, [userName, conversations, coworkers, workflows, workflowRuns, flatFiles, participants, approvals, tools, fileTree, userPreferences, capstoneRows]);

  async function handleFeedbackSubmit(payload) {
    setFeedbackError(null);
    setSubmitting(true);
    const res = await sb.saveFeedback({
      ...payload,
      participant_id: myParticipantId,
      participant_name: userName,
    });
    setSubmitting(false);
    if (res.ok) {
      setFeedbackStatus('submitted');
    } else {
      setFeedbackError(res.error || 'Could not save feedback. Try again.');
    }
  }

  // User-scoped tallies. Counting room-wide totals here was misleading:
  // the screen reads as "your" graduation but the numbers were the
  // cohort's, so an admin viewing a deprecated workshop would see
  // "132 files" with every competency below saying "no activity".
  const tally = {
    messages: (conversations || []).reduce(
      (sum, c) => sum + (c.messages || []).filter(m => m.type === 'user').length,
      0,
    ),
    files: (flatFiles || []).filter(f => f.type === 'file' && f.createdBy === userName).length,
    coworkers: (coworkers || []).filter(c => c.createdBy === userName).length,
    workflowRuns: (workflowRuns || []).filter(r => r.startedBy === userName).length,
  };

  const overall = scorecard?.overallLevel ?? 0;

  if (feedbackStatus === 'unknown') {
    return (
      <div className={`gr-page${embedded ? ' is-embedded' : ''}`}>
        <main className="gr-container">
          <Loading />
        </main>
      </div>
    );
  }

  // Survey gate: render the new FeedbackForm at the top level — it owns its
  // own .sv-page surface, no .gr-container wrapping. Keeps the survey from
  // inheriting graduation's certificate layout.
  if (feedbackStatus === 'pending') {
    return (
      <FeedbackForm
        userName={userName}
        onSubmit={handleFeedbackSubmit}
        submitting={submitting}
        errorMessage={feedbackError}
      />
    );
  }

  return (
    <div className={`gr-page${embedded ? ' is-embedded' : ''}`}>
      <main className="gr-container">
        <CertificatePlate userName={userName} date={issuedDate} level={overall} />
        <Tally tally={tally} />
        {scorecard === null ? (
          <Loading />
        ) : (
          <Dimensions dimensions={scorecard.dimensions} />
        )}
        {!embedded && (
          <Footer onSignOut={onSignOut} date={issuedDate} userName={userName} />
        )}
        <div className="gr-attribution">
          Foundry by{' '}
          <a href="https://alokkhatri.com" target="_blank" rel="noopener noreferrer">
            Alok Khatri
          </a>
        </div>
      </main>
    </div>
  );
}

// (PendingHeader was a compact header used when the feedback survey was
// nested inside the graduation page. The new survey owns its own .sv-page
// surface so this header is no longer rendered, but kept as dead code in
// case we want to revert the routing.)
function PendingHeader({ userName }) {
  return (
    <header className="gr-pending-header">
      <div className="gr-eyebrow">
        <span className="gr-eyebrow-dot" aria-hidden />
        Graduation · A few questions first
      </div>
      <h1 className="gr-pending-title">
        Thanks for participating,&nbsp;<em>{userName}</em>.
      </h1>
      <p className="gr-pending-sub">
        A quick survey before your scorecard reveals. What worked, what didn't, what to keep. Five minutes.
      </p>
    </header>
  );
}

function CertificatePlate({ userName, date, level }) {
  const word = LEVELS[level];
  const color = LEVEL_COLORS[level];
  return (
    <header className="gr-plate" style={{ '--gr-level-color': color }}>
      <div className="gr-plate-body">
        <div className="gr-plate-eyebrow">
          <span className="gr-eyebrow-dot" aria-hidden />
          Foundry · Issued {date}
        </div>
        <p className="gr-plate-prelude">This certifies that</p>
        <h1 className="gr-plate-name"><em>{userName}</em></h1>
        <p className="gr-plate-prelude">completed the workshop and reached the level of</p>
        <div className="gr-plate-level">
          <span className="gr-plate-level-dot" aria-hidden />
          <span className="gr-plate-level-word">{word}</span>
        </div>
        <p className="gr-plate-hint"><em>{OVERALL_HINTS[level]}</em></p>
      </div>
      <WaxSeal />
    </header>
  );
}

function WaxSeal() {
  return (
    <div className="gr-seal" aria-hidden>
      <svg viewBox="0 0 140 140" className="gr-seal-svg">
        <defs>
          <radialGradient id="grSealGrad" cx="38%" cy="32%" r="75%">
            <stop offset="0%" stopColor="#f4c8a8" />
            <stop offset="55%" stopColor="#d97757" />
            <stop offset="100%" stopColor="#a04a30" />
          </radialGradient>
          <path id="grSealCircle" d="M 70,70 m -52,0 a 52,52 0 1,1 104,0 a 52,52 0 1,1 -104,0" />
        </defs>
        <circle cx="70" cy="70" r="64" fill="none" stroke="#d97757" strokeOpacity="0.35" strokeDasharray="2 4" />
        <circle cx="70" cy="70" r="58" fill="url(#grSealGrad)" />
        <circle cx="70" cy="70" r="58" fill="none" stroke="#7a3318" strokeOpacity="0.25" />
        <text className="gr-seal-mono" fontSize="7.5" letterSpacing="3">
          <textPath href="#grSealCircle" startOffset="0%">FOUNDRY · GRADUATION · ISSUED</textPath>
        </text>
        <text x="70" y="82" textAnchor="middle" className="gr-seal-mono-f">F</text>
      </svg>
    </div>
  );
}

function Tally({ tally }) {
  const items = [
    { key: 'messages',     num: tally.messages,     label: 'messages sent' },
    { key: 'files',        num: tally.files,        label: 'files created' },
    { key: 'coworkers',    num: tally.coworkers,    label: 'coworkers built' },
    { key: 'workflowRuns', num: tally.workflowRuns, label: 'workflow runs' },
  ];
  return (
    <section className="gr-tally" aria-label="Activity tally">
      {items.map(it => (
        <div key={it.key} className="gr-tally-cell">
          <div className="gr-tally-num">{it.num}</div>
          <div className="gr-tally-label">{it.label}</div>
        </div>
      ))}
    </section>
  );
}

function Ladder({ level }) {
  // Four dots along a track. Track fills up to (level - 1) / 3. Current
  // dot has a halo; its label floats above. level=0 leaves all dots empty.
  const fillWidth = level === 0 ? 0 : ((level - 1) / 3) * 100;
  return (
    <div className="gr-ladder" role="img" aria-label={`Level ${level}: ${LEVELS[level]}`}>
      <div className="gr-ladder-track" aria-hidden>
        <div className="gr-ladder-fill" style={{ width: `${fillWidth}%` }} />
      </div>
      {[1, 2, 3, 4].map(step => {
        const isOn = step <= level;
        const isCurrent = step === level;
        return (
          <div
            key={step}
            className={`gr-ladder-step${isOn ? ' is-on' : ''}${isCurrent ? ' is-current' : ''}`}
            title={LEVELS[step]}
          >
            <span className="gr-ladder-dot" aria-hidden />
            <span className="gr-ladder-step-label">{LEVELS[step]}</span>
          </div>
        );
      })}
    </div>
  );
}

function DimensionRow({ dim, index }) {
  const isInfluence = dim.level === 4;
  const isEmpty = dim.level === 0;
  return (
    <article
      className={`gr-dim level-${dim.level}${isInfluence ? ' is-influence' : ''}${isEmpty ? ' is-empty' : ''}`}
      style={{ '--gr-level-color': LEVEL_COLORS[dim.level] }}
    >
      <div className="gr-dim-index">{pad2(index + 1)}</div>
      <div className="gr-dim-body">
        <div className="gr-dim-head">
          <h3 className="gr-dim-label">{dim.label}</h3>
          <p className="gr-dim-hint">{dim.hint}</p>
        </div>
        <Ladder level={dim.level} />
        <p className="gr-dim-evidence">
          <span className="gr-dim-evidence-mark" aria-hidden>“</span>
          {dim.evidence}
        </p>
        {isInfluence && (
          <p className="gr-dim-influence">
            <span className="gr-dim-influence-mark">Influence ·</span>{' '}
            Your work was used by other participants in the room, not just by you.
          </p>
        )}
      </div>
    </article>
  );
}

function Dimensions({ dimensions }) {
  return (
    <section className="gr-dimensions">
      <header className="gr-dimensions-head">
        <div>
          <div className="gr-section-eyebrow">Witnessed by your work</div>
          <h2 className="gr-section-title">
            Five primitives,&nbsp;<em>five ladders</em>.
          </h2>
        </div>
        <div className="gr-ladder-key" aria-label="Level legend">
          {[1, 2, 3, 4].map(n => (
            <span key={n} className="gr-ladder-key-item">
              <span className="gr-ladder-key-dot" style={{ background: LEVEL_COLORS[n] }} />
              {LEVELS[n]}
            </span>
          ))}
        </div>
      </header>
      <div className="gr-dimensions-list">
        {dimensions.map((d, i) => <DimensionRow key={d.key} dim={d} index={i} />)}
      </div>
    </section>
  );
}

function Footer({ onSignOut, date, userName }) {
  const [downloading, setDownloading] = useState(false);

  // Lazy-import jspdf + html2canvas only when the user actually clicks
  // download. Both libs together are ~400KB; loading them upfront would
  // bloat every participant's bundle for a button most won't click.
  async function handleDownload() {
    if (downloading) return;
    setDownloading(true);
    try {
      const [{ default: html2canvas }, { jsPDF }] = await Promise.all([
        import('html2canvas'),
        import('jspdf'),
      ]);
      const el = document.querySelector('.gr-plate');
      if (!el) return;
      const canvas = await html2canvas(el, { scale: 2, backgroundColor: '#FBF4EE', useCORS: true });
      const imgData = canvas.toDataURL('image/png');
      const pdf = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });
      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();
      const imgRatio = canvas.width / canvas.height;
      const margin = 36;
      const maxW = pageWidth - margin * 2;
      const maxH = pageHeight - margin * 2;
      let w = maxW;
      let h = w / imgRatio;
      if (h > maxH) { h = maxH; w = h * imgRatio; }
      const x = (pageWidth - w) / 2;
      const y = (pageHeight - h) / 2;
      pdf.addImage(imgData, 'PNG', x, y, w, h);
      const safeName = (userName || 'Participant').replace(/[^a-zA-Z0-9_-]+/g, '_');
      pdf.save(`${safeName}_Foundry.pdf`);
    } finally {
      setDownloading(false);
    }
  }

  return (
    <footer className="gr-footer">
      <button type="button" className="gr-signout" onClick={onSignOut}>
        Sign out
      </button>
      <div className="gr-issuer">
        <svg className="gr-issuer-mark" viewBox="0 0 80 24" aria-hidden>
          <path d="M 4 18 C 14 4, 24 22, 34 12 S 54 4, 64 18" stroke="#d97757" strokeWidth="1.5" fill="none" strokeLinecap="round" />
          <circle cx="68" cy="18" r="1.5" fill="#d97757" />
        </svg>
        <div className="gr-issuer-lines">
          <span className="gr-issuer-line-1">Issued by Foundry</span>
          <span className="gr-issuer-line-2">{date}</span>
        </div>
      </div>
      <button type="button" className="gr-print" onClick={handleDownload} disabled={downloading}>
        {downloading ? 'Preparing…' : 'Download certificate'}
      </button>
    </footer>
  );
}

function Loading() {
  return (
    <div className="gr-loading">
      <span className="gr-loading-dot" aria-hidden />
      <span>Computing your scorecard…</span>
    </div>
  );
}
