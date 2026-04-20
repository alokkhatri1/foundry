const STAGE_ORDER = ['1', '2', '3', '4', '5a', '5b', '6', '7', '8'];

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
  '1':  { label: 'Chat',                 description: 'Go say hi to the humans in the room, {name} — and try a chat with the AI too.' },
  '2':  { label: 'Preferences',          description: 'Alright {name} — time to tell the AI who you are and how you like to work.' },
  '3':  { label: 'Files as context',     description: 'Okay {name}, now you can hand it files to read before it answers you.' },
  '4':  { label: 'Files as skills',      description: 'Going deeper, {name}. Write instructions that shape how the AI thinks.' },
  '5a': { label: 'AI Coworkers',         description: 'Let\u2019s build your team, {name} \u2014 named AI teammates with their own style.' },
  '5b': { label: 'Coworker Tools',       description: 'Now hand your coworkers real tools, {name} \u2014 research, messaging, action.' },
  '6':  { label: 'Orchestration',        description: 'Now choreograph it, {name} \u2014 chain coworkers and humans into a workflow with human-in-loop checks.' },
  '7':  { label: 'Observability',        description: 'Last one, {name} \u2014 every run, approval, and tool call on the record. See what your team actually did.' },
  '8':  { label: 'Graduation',           description: 'Here\u2019s a read of what you built, {name} \u2014 your competency scorecard across everything we just did together.' },
};

export { STAGE_ORDER };

export default function RevealAt({ stage, currentStage, children, fallback = null }) {
  return stageReached(currentStage, stage) ? children : fallback;
}
