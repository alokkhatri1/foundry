-- 035: insert Auditability as the new Stage 8.
--
-- The 9-stage arc (post 2026-05-09 renumber) put Economics at 8 and
-- Graduation at 9. Stage 8 — Auditability — gets inserted between
-- Observability and Economics so participants experience the meta-lesson
-- "compare peer audit vs AI audit" before they see the bill.
--
-- New arc:
--   1 Chat · 2 Preferences · 3 Files-as-skills · 4 Files-as-knowledge ·
--   5 Coworkers · 6 Orchestration · 7 Observability · 8 Auditability ·
--   9 Economics · 10 Graduation
--
-- Existing rows that referenced the old 8 (Economics) and 9 (Graduation)
-- need to slide to 9 and 10 respectively. Single CASE-based UPDATE per
-- table so rows aren't double-touched.

update rooms
set current_stage = case current_stage
  when '9' then '10'
  when '8' then '9'
  else current_stage
end
where current_stage in ('8', '9');

update stage_events
set from_stage = case from_stage
  when '9' then '10'
  when '8' then '9'
  else from_stage
end,
to_stage = case to_stage
  when '9' then '10'
  when '8' then '9'
  else to_stage
end
where from_stage in ('8', '9') or to_stage in ('8', '9');

-- stage_reflections has UNIQUE (workshop_id, participant_id, stage),
-- which Postgres checks per row, not at statement end. A single CASE-
-- based UPDATE collides: when the row at '8' tries to become '9',
-- the row already at '9' hasn't moved to '10' yet. Two ordered steps
-- avoid the collision: empty '9' first, then fill it.
update stage_reflections set stage = '10' where stage = '9';
update stage_reflections set stage = '9'  where stage = '8';
