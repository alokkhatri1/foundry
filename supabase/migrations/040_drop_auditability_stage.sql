-- 040: drop the Auditability stage. Back to a 9-stage arc.
--
-- The Stage 8 Auditability beat (peer audit + AI auditor + comparison
-- view) was retired on 2026-05-10 in favour of "build → observe" only.
-- The pedagogy shifted to: participants build at Stage 6, watch the
-- cohort's runs at Stage 7, then close on Economics + Graduation.
-- Active engagement on Observability (peer step comments, send-for-
-- review) is also retired — Stage 7 is read-only.
--
-- New arc:
--   1 Chat · 2 Preferences · 3 Files-as-skills · 4 Files-as-knowledge ·
--   5 Coworkers · 6 Orchestration · 7 Observability · 8 Economics ·
--   9 Graduation
--
-- Schema cleanup is *deliberately partial*: the tables that supported
-- the retired features (step_comments, run_audits, ai_run_audits,
-- ai_audits) and the workflow_runs.submitted_for_review_at columns
-- stay in place. Their rows are preserved for the research archive of
-- what was tested; new code stops writing to them.

-- rooms.current_stage: '8' (Auditability) clamps to '7' (last live
-- primitive); '9' (Economics) → '8'; '10' (Graduation) → '9'. Sequential
-- updates are safe — rooms has no unique constraint on current_stage.
update rooms set current_stage = '7' where current_stage = '8';
update rooms set current_stage = '8' where current_stage = '9';
update rooms set current_stage = '9' where current_stage = '10';

-- stage_events: same remap on both columns. CASE keeps the row count
-- and avoids partial overwrites.
update stage_events
  set from_stage = case from_stage
        when '8'  then '7'
        when '9'  then '8'
        when '10' then '9'
        else from_stage
      end,
      to_stage = case to_stage
        when '8'  then '7'
        when '9'  then '8'
        when '10' then '9'
        else to_stage
      end
  where from_stage in ('8', '9', '10') or to_stage in ('8', '9', '10');

-- stage_reflections has UNIQUE (workshop_id, participant_id, stage).
-- Park Auditability reflections (current '8') under a legacy key first
-- so the swap doesn't collide; then move Economics ('9' → '8') and
-- Graduation ('10' → '9') in order.
update stage_reflections set stage = '8_legacy_auditability' where stage = '8';
update stage_reflections set stage = '8' where stage = '9';
update stage_reflections set stage = '9' where stage = '10';
