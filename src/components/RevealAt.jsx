const STAGE_ORDER = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11'];

// Rooms deprecated before each arc change can carry stage IDs that no longer
// exist in STAGE_ORDER. Without normalization, indexOf returns -1 and every
// stageReached() check fails, hiding all gated UI. Map retired IDs to their
// new positions.
//   '5c' / '5b' / '5a' → '5'
//     5b (Coworker Tools) was retired when tools were removed from the editor.
//     5a then collapsed into a single Coworkers stage and got renumbered '5'.
//     5c was an older collaboration substage folded earlier.
//   '7b' → '8'
//     Old Economics renumbered to '8' in an earlier pass.
//   Capstone-arc renumber: Capstone (new 8) and Copilot (new 9) were
//   inserted between Observability (7) and the older Economics/Graduation
//   stages. Anything that used to be '8' (Economics) is now '10'; anything
//   that used to be '9' (Graduation) is now '11'. The paired SQL migration
//   (025_renumber_stages_for_capstone.sql) shifts existing rooms in the DB;
//   these aliases keep any straggler that didn't get migrated routing
//   correctly.
//
// CAUTION: '7b' -> '8' was previously aliasing to old-Economics. Under the
// new numbering, 8 is now Capstone. We re-route '7b' to the new Economics
// position '10' so an old deprecated room with stage '7b' still sees the
// final Economics + Graduation tabs as it expected.
const STAGE_ALIASES = { '5c': '5', '5b': '5', '5a': '5', '7b': '10' };
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
  '7':  { label: 'Observability',        description: 'Watch the mixed team work, {name} \u2014 every run, approval, and tool call on the record.' },
  '8':  { label: 'Capstone',             description: 'Design the real thing, {name}. Lay out a full workflow as a five-column plan you can take away.' },
  '9':  { label: 'Copilot',              description: 'Now plug it in, {name}. Send your capstone to the workflow copilot and let it build with you.' },
  '10': { label: 'Economics',            description: 'Time to see the bill, {name} \u2014 every token your team spent is on the record now.' },
  '11': { label: 'Graduation',           description: 'Here\u2019s a read of what you built, {name} \u2014 your competency scorecard across everything we just did together.' },
};

export { STAGE_ORDER, normalizeStage };

export default function RevealAt({ stage, currentStage, children, fallback = null }) {
  return stageReached(currentStage, stage) ? children : fallback;
}
