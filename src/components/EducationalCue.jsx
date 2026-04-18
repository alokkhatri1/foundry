// EducationalCue — deprecated as of the stage-aware AI guidance refactor.
// The AI in chat now carries pedagogical guidance per stage (see
// src/data/stageGuidance.js), so static tooltip chips are redundant. This
// component now renders nothing; all existing <EducationalCue /> call sites
// continue to work (no-op). Import/prop cleanup will follow in a later pass.
export default function EducationalCue() {
  return null;
}
