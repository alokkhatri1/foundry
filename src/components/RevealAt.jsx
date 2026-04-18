const STAGE_ORDER = ['1', '2', '3', '4', '5a', '5b', '6'];

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
  '1':  { label: 'Chat',                description: 'AI conversation + human DMs.' },
  '2':  { label: 'Preferences',         description: 'Personal context: the AI shaped to me.' },
  '3':  { label: 'Files as context',    description: 'Knowledge the AI can draw from.' },
  '4':  { label: 'Files as skills',     description: 'Instructions that shape how the AI responds.' },
  '5a': { label: 'AI Coworkers',        description: 'Build named AI teammates with their own instructions + knowledge.' },
  '5b': { label: 'Coworker Tools',      description: 'Give coworkers capabilities — research, DM humans, process documents.' },
  '6':  { label: 'Strategic Delegation', description: 'Input a strategy; see how work redistributes across humans + AI. The closing act.' },
};

export { STAGE_ORDER };

export default function RevealAt({ stage, currentStage, children, fallback = null }) {
  return stageReached(currentStage, stage) ? children : fallback;
}
