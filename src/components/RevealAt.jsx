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
  '1':  { label: 'Chat',                 description: 'Chat with AI and message the humans in the room.' },
  '2':  { label: 'Preferences',          description: 'Teach the AI who you are and how you like to work.' },
  '3':  { label: 'Files as context',     description: 'Add files the AI can draw from when it answers you.' },
  '4':  { label: 'Files as skills',      description: 'Write files that shape how the AI thinks and responds.' },
  '5a': { label: 'AI Coworkers',         description: 'Build named AI teammates with their own knowledge and style.' },
  '5b': { label: 'Coworker Tools',       description: 'Give your coworkers tools to research, message, and take action.' },
  '6':  { label: 'Strategic Delegation', description: 'Map a strategy and see how work redistributes across humans and AI.' },
};

export { STAGE_ORDER };

export default function RevealAt({ stage, currentStage, children, fallback = null }) {
  return stageReached(currentStage, stage) ? children : fallback;
}
