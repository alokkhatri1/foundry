-- Demographics gate questionnaire — extended to the research+industry
-- instrument (research-questions.md, Section 1 Q1-Q13). Adds the columns
-- the new DemographicsForm writes; preserves the old shape's rows by
-- making the dropped fields (age_band, workshop_goal) nullable so the
-- new form can stop asking without invalidating historical data.
--
-- New columns:
--   work_type              text[]    Q4  multi-select work activity
--   ai_use_cases           text[]    Q8  multi-select what they use AI for
--   ai_mental_model        text      Q9  single-select mental model
--   evaluation_confidence  smallint  Q10 1-5 "can usually tell when good enough"
--   delegation_comfort     smallint  Q11 1-5 "comfortable delegating w/ review"
--   adoption_criteria_top3 text[]    Q12 ordered top-3 ranking (position = rank)
--   delegation_boundary    text      Q13 free text "what you would not delegate"
--
-- ai_mental_model / work_type / ai_use_cases / adoption_criteria_top3 are
-- not CHECK-constrained at the DB level — the frontend enforces the
-- option set and we'd rather not have to ship a migration every time the
-- research team renames an option. Codes are stored verbatim and decoded
-- to human labels in researchBundle.js for the admin export.

alter table participant_demographics
  add column if not exists work_type              text[]   not null default '{}',
  add column if not exists ai_use_cases           text[]   not null default '{}',
  add column if not exists ai_mental_model        text,
  add column if not exists evaluation_confidence  smallint check (evaluation_confidence between 1 and 5),
  add column if not exists delegation_comfort     smallint check (delegation_comfort between 1 and 5),
  add column if not exists adoption_criteria_top3 text[]   not null default '{}',
  add column if not exists delegation_boundary    text;

-- Loosen the original 041 schema: the new form doesn't ask age or a
-- separate workshop goal, so existing rows are still valid but new rows
-- can leave them null. Same posture applies to industry's CHECK — the
-- option set in the new form (Q3) is identical, so no constraint change
-- is needed there.
alter table participant_demographics
  alter column age_band      drop not null,
  alter column workshop_goal drop not null;
