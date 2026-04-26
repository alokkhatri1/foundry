const STAGE_ORDER = ['1', '2', '3', '4', '5', '6', '7', '8', '9'];

// Rooms deprecated before the arc change can carry stage IDs that no longer
// exist in STAGE_ORDER. Without normalization, indexOf returns -1 and every
// stageReached() check fails, hiding all gated UI. Map retired IDs to their
// nearest still-valid predecessor.
//   '5c' / '5b' / '5a' → '5'
//     5b (Coworker Tools) was retired when tools were removed from the editor.
//     5a then collapsed into a single Coworkers stage and got renumbered '5'.
//     5c was an older collaboration substage folded earlier.
//   '7b' → '8'
//     Economics renumbered to '8'; old Graduation '8' is now '9'. The
//     paired SQL migration (020_renumber_stages_7b_8.sql) shifts existing
//     rooms in the DB; this alias keeps any straggler that didn't get
//     migrated routing correctly.
const STAGE_ALIASES = { '5c': '5', '5b': '5', '5a': '5', '7b': '8' };
function normalizeStage(s) {
  return STAGE_ALIASES[s] || s;
}

export function stageReached(currentStage, targetStage) {
  if (!currentStage) return false;
  const cur = STAGE_ORDER.indexOf(normalizeStage(currentStage));
  const tgt = STAGE_ORDER.indexOf(normalizeStage(targetStage));
  if (cur === -1 || tgt === -1) return false;
  return cur >= tgt;
}

export function nextStage(currentStage) {
  const idx = STAGE_ORDER.indexOf(normalizeStage(currentStage));
  if (idx === -1 || idx >= STAGE_ORDER.length - 1) return null;
  return STAGE_ORDER[idx + 1];
}

export const STAGE_META = {
  '1':  { label: 'Chat',                 description: 'Go say hi to the humans in the room, {name} — and try a chat with the AI too.' },
  '2':  { label: 'Preferences',          description: 'Alright {name} — time to tell the AI who you are and how you like to work.' },
  '3':  { label: 'Files as context',     description: 'Okay {name}, now you can hand it files to read before it answers you.' },
  '4':  { label: 'Files as skills',      description: 'Going deeper, {name}. Write instructions that shape how the AI thinks.' },
  '5':  { label: 'AI Coworkers',         description: 'Let\u2019s build your team, {name} \u2014 named AI teammates with skills, knowledge, and a voice.' },
  '6':  { label: 'Orchestration',        description: 'Now choreograph it, {name} \u2014 chain coworkers and humans into a workflow with human-in-loop checks.' },
  '7':  { label: 'Observability',        description: 'Last one, {name} \u2014 every run, approval, and tool call on the record. See what your team actually did.' },
  '8':  { label: 'Economics',            description: 'Time to see the bill, {name} \u2014 every token your team spent is on the record now.' },
  '9':  { label: 'Graduation',           description: 'Here\u2019s a read of what you built, {name} \u2014 your competency scorecard across everything we just did together.' },
};

export { STAGE_ORDER, normalizeStage };

export default function RevealAt({ stage, currentStage, children, fallback = null }) {
  return stageReached(currentStage, stage) ? children : fallback;
}
