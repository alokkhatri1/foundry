import { useState, useEffect } from 'react';
import { lookupStageExample } from '../data/stageExamples';

// Per-stage "see how this looks" panel. Renders the canonical example for
// a given stage, dismissible, persists dismissal per (workshop, stage) so
// a refresh doesn't replay it. A small "Show example" pill re-opens it on
// demand. If a stage has no example registered (1, 8, 9), renders nothing.

function dismissalKey(workshopCode, stage) {
  return `sandbox:stage-example-dismissed:${workshopCode || 'default'}:${stage}`;
}

function readDismissed(workshopCode, stage) {
  try { return localStorage.getItem(dismissalKey(workshopCode, stage)) === '1'; }
  catch { return false; }
}

function writeDismissed(workshopCode, stage, value) {
  try {
    if (value) localStorage.setItem(dismissalKey(workshopCode, stage), '1');
    else localStorage.removeItem(dismissalKey(workshopCode, stage));
  } catch {}
}

export default function StageExamplePanel({ stage, workshopCode }) {
  const example = lookupStageExample(stage);
  const [dismissed, setDismissed] = useState(() => readDismissed(workshopCode, stage));

  // Re-evaluate dismissal when the stage changes — moving from stage 4
  // back to a re-revealed stage 4 in the same browser shouldn't cause the
  // old dismissal to be ignored, but switching tabs across stages should
  // still pick the right per-stage flag.
  useEffect(() => {
    setDismissed(readDismissed(workshopCode, stage));
  }, [workshopCode, stage]);

  if (!example) return null;

  if (dismissed) {
    return (
      <button
        type="button"
        className="stage-example-reopen"
        onClick={() => { writeDismissed(workshopCode, stage, false); setDismissed(false); }}
      >
        Show example
      </button>
    );
  }

  return (
    <div className="stage-example-panel">
      <div className="stage-example-header">
        <div className="stage-example-eyebrow">Example</div>
        <h3 className="stage-example-title">{example.title}</h3>
      </div>
      {example.intro && <p className="stage-example-intro">{example.intro}</p>}
      <ExampleArtifact artifact={example.artifact} />
      <div className="stage-example-actions">
        <button
          type="button"
          className="stage-example-dismiss"
          onClick={() => { writeDismissed(workshopCode, stage, true); setDismissed(true); }}
        >
          Got it
        </button>
      </div>
    </div>
  );
}

function ExampleArtifact({ artifact }) {
  if (!artifact) return null;
  if (artifact.kind === 'text' || artifact.kind === 'markdown') {
    return (
      <div className="stage-example-artifact">
        {artifact.label && <div className="stage-example-artifact-label">{artifact.label}</div>}
        <pre className="stage-example-artifact-body">{artifact.body}</pre>
      </div>
    );
  }
  if (artifact.kind === 'card') {
    return (
      <div className="stage-example-artifact">
        {artifact.label && <div className="stage-example-artifact-label">{artifact.label}</div>}
        <div className="stage-example-card">
          {(artifact.fields || []).map(f => (
            <div key={f.name} className="stage-example-card-row">
              <div className="stage-example-card-name">{f.name}</div>
              <div className="stage-example-card-value">{f.value}</div>
            </div>
          ))}
        </div>
      </div>
    );
  }
  return null;
}
