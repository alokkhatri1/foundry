-- rooms.paused_at: when set, the workshop is paused. Participant-initiated
-- writes (chat, workflow runs, file/coworker/workflow edits) refuse with a
-- "workshop is paused" toast. Admin actions (reveal stage, credit top-ups,
-- pause/resume itself) are unaffected so the facilitator keeps control of
-- the room across the pause boundary.
--
-- Use case is multi-day workshops: pause at end of day 1, resume morning
-- of day 2. Stage state is already persisted (current_stage), so the column
-- here adds the *behavioural* freeze, not the state preservation.
--
-- Pause is reversible: setting paused_at = null resumes. Differs from
-- deprecated_at, which is a one-way archive.

alter table rooms add column if not exists paused_at timestamptz null;
