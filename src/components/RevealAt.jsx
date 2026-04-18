const STAGE_ORDER = ['1', '2', '3', '4', '5a', '5b', '5c', '6'];

export function stageReached(currentStage, targetStage) {
  if (!currentStage) return false;
  const cur = STAGE_ORDER.indexOf(currentStage);
  const tgt = STAGE_ORDER.indexOf(targetStage);
  if (cur === -1 || tgt === -1) return false;
  return cur >= tgt;
}

export function nextStage(currentStage) {
  const idx = STAGE_ORDER.indexOf(currentStage);
  if (idx === -1 || idx >= STAGE_ORDER.length - 1) return null;
  return STAGE_ORDER[idx + 1];
}

export const STAGE_META = {
  '1':  { label: 'Chat',                       description: 'The default conversation surface.' },
  '2':  { label: 'Preferences',                description: 'Personal context: AI shaped to me.' },
  '3':  { label: 'Files as context',           description: 'Knowledge the AI draws from.' },
  '4':  { label: 'Files as skills',            description: 'Reusable instructions that shape AI behavior.' },
  '5a': { label: 'Coworker L1',                description: 'Bundle skill + context + identity.' },
  '5b': { label: 'Coworker L2 (tools)',        description: 'The coworker can act, not just explain.' },
  '5c': { label: 'Coworker L3 (orchestrator)', description: 'Coworker calls other coworkers + humans.' },
  '6':  { label: 'Workflow + humans-in-loop',  description: 'Choreograph AI + human teams.' },
};

export { STAGE_ORDER };

export default function RevealAt({ stage, currentStage, children, fallback = null }) {
  return stageReached(currentStage, stage) ? children : fallback;
}
