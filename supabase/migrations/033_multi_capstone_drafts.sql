-- 033: capstone_drafts becomes multi-draft per participant.
--
-- Stage 6 (case-driven Orchestration) is the active surface that writes
-- here now. The original schema enforced one draft per (workshop_id,
-- participant_id) via a unique constraint, which means a participant
-- can only ever have ONE case in flight — to start a new one they have
-- to wipe the existing one. That's the wrong constraint for an
-- iteration tool: people want a saved library of cases they can switch
-- between.
--
-- This migration:
--   - drops the unique constraint
--   - adds a `name` column so each draft has a human-readable label
--     in the chooser (auto-derived from the case input when blank)
--
-- Existing rows survive untouched — they just become single entries in
-- a now-multi-row library for their participant.

alter table capstone_drafts
  add column if not exists name text;

alter table capstone_drafts
  drop constraint if exists capstone_drafts_workshop_id_participant_id_key;

create index if not exists capstone_drafts_participant_idx
  on capstone_drafts(participant_id, updated_at desc);
