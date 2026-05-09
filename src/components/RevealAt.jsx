const STAGE_ORDER = ['1', '2', '3', '4', '5', '6', '7', '8', '9'];

// Rooms deprecated before each arc change can carry stage IDs that no longer
// exist in STAGE_ORDER. Without normalization, indexOf returns -1 and every
// stageReached() check fails, hiding all gated UI. Map retired IDs to their
// new positions.
//
//   '5c' / '5b' / '5a' → '5'  — older Coworker substages collapsed into '5'.
//
// The 9-stage renumber on 2026-05-09 (Capstone + Copilot retired; Economics
// 10→8; Graduation 11→9) is handled by a one-shot SQL migration
// (032_renumber_stages_kill_capstone_copilot.sql) that updates every
// `rooms.current_stage` row in place — there's no in-code alias for it
// because the DB itself has been normalised.
const STAGE_ALIASES = {
  '5c': '5', '5b': '5', '5a': '5',
};
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
  // No stage yet, or a stale value the new numbering doesn't know — treat
  // as pre-Stage-1 so the admin reveal panel always offers Stage 1's
  // Reveal button. Without this fallback, a renumber that strands an old
  // current_stage value (e.g. '8' from before the Capstone retirement)
  // leaves the room with every stage Locked and no way to recover from
  // the UI.
  if (!currentStage) return STAGE_ORDER[0];
  const idx = STAGE_ORDER.indexOf(normalizeStage(currentStage));
  if (idx === -1) return STAGE_ORDER[0];
  if (idx >= STAGE_ORDER.length - 1) return null;
  return STAGE_ORDER[idx + 1];
}

export const STAGE_META = {
  '1': { label: 'Chat',             description: 'Go say hi to the humans in the room, {name} — and try a chat with the AI too.' },
  '2': { label: 'Preferences',      description: 'Alright {name} — time to tell the AI who you are and how you like to work.' },
  '3': { label: 'Files as skills',     description: 'Time to author behavior, {name} — write instruction files that shape how the AI thinks.' },
  '4': { label: 'Files as knowledge',  description: 'Now hand the AI documents to read before it answers — your knowledge becomes its working memory.' },
  '5': { label: 'AI Coworkers',     description: 'Let’s build your team, {name} — named AI teammates with skills, knowledge, and a voice.' },
  '6': { label: 'Orchestration',    description: 'Now choreograph it, {name} — chain coworkers and humans into a workflow with human-in-loop checks.' },
  '7': { label: 'Observability',    description: 'Watch the mixed team work, {name} — every run, approval, and tool call on the record.' },
  '8': { label: 'Economics',        description: 'Time to see the bill, {name} — every token your team spent is on the record now.' },
  '9': { label: 'Graduation',       description: 'Here’s a read of what you built, {name} — your competency scorecard across everything we just did together.' },
};

export { STAGE_ORDER, normalizeStage };

export default function RevealAt({ stage, currentStage, children, fallback = null }) {
  return stageReached(currentStage, stage) ? children : fallback;
}
