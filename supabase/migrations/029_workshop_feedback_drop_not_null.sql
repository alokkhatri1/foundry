-- 029: drop NOT NULL on the workshop_feedback columns the trimmed
-- final survey no longer asks about. The columns themselves stay so
-- historical rows remain queryable, but new submissions arrive with
-- those fields NULL. Without this, every new submission upserts
-- against a NOT NULL constraint and errors.
--
-- Affected columns: satisfaction, relevance, clarity, materials_quality,
-- duration_appropriate, theory_practice, improved_skills, can_apply,
-- platform_rating. The trainer_* / would_recommend columns stay NOT NULL
-- because the new form still writes them.

alter table workshop_feedback alter column satisfaction         drop not null;
alter table workshop_feedback alter column relevance            drop not null;
alter table workshop_feedback alter column clarity              drop not null;
alter table workshop_feedback alter column materials_quality    drop not null;
alter table workshop_feedback alter column duration_appropriate drop not null;
alter table workshop_feedback alter column theory_practice      drop not null;
alter table workshop_feedback alter column improved_skills      drop not null;
alter table workshop_feedback alter column can_apply            drop not null;
alter table workshop_feedback alter column platform_rating      drop not null;
