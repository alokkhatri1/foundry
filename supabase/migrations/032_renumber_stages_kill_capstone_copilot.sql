-- 032: Capstone + Copilot retired; renumber Economics + Graduation.
--
-- The 11-stage arc collapses to 9. Old:
--   ... 7 Observability · 8 Capstone · 9 Copilot · 10 Economics · 11 Graduation
-- New:
--   ... 7 Observability · 8 Economics · 9 Graduation
--
-- Capstone and Copilot were the place where workshops got stuck (the DAG
-- builder + plan-then-handoff metaphor wasn't landing). The case-driven
-- approach moves into Stage 6 itself; Capstone and Copilot disappear.
--
-- Remap for every row that carries a stage id:
--   '8' (old Capstone)  → '7'   — clamp to last live primitive
--   '9' (old Copilot)   → '7'   — same
--   '10' (old Economics) → '8'  — Economics is now Stage 8
--   '11' (old Graduation) → '9' — Graduation is now Stage 9
--   '1' .. '7' untouched
--
-- Done as one UPDATE per table with a CASE expression. Sequential
-- UPDATEs would double-touch rows: the second UPDATE would catch rows
-- we just rewrote to the same target value.

update rooms
set current_stage = case current_stage
  when '11' then '9'
  when '10' then '8'
  when '9'  then '7'
  when '8'  then '7'
  else current_stage
end
where current_stage in ('8', '9', '10', '11');

-- stage_events records every reveal transition; same renumber applies so
-- the audit trail stays interpretable under the new arc.
update stage_events
set from_stage = case from_stage
  when '11' then '9'
  when '10' then '8'
  when '9'  then '7'
  when '8'  then '7'
  else from_stage
end,
to_stage = case to_stage
  when '11' then '9'
  when '10' then '8'
  when '9'  then '7'
  when '8'  then '7'
  else to_stage
end
where from_stage in ('8', '9', '10', '11')
   or to_stage   in ('8', '9', '10', '11');

-- stage_reflections rows tagged to retired Capstone (8) or Copilot (9)
-- stages stay in the table for archival reads but get a clearly-marked
-- legacy stage value so they don't collide with new '8' / '9' meanings.
update stage_reflections
set stage = case stage
  when '11' then '9'
  when '10' then '8'
  when '9'  then 'legacy_copilot'
  when '8'  then 'legacy_capstone'
  else stage
end
where stage in ('8', '9', '10', '11');
