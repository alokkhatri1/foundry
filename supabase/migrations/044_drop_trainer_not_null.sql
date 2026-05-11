-- Drop NOT NULL on the trainer_* columns. Migration 029 left these
-- NOT NULL because the post-trim form still wrote them; the research
-- instrument (research-questions.md, Section 4) doesn't ask trainer-
-- specific questions, so submissions now arrive with those fields
-- NULL and the old NOT NULL constraint blocks the insert.
--
-- Columns kept in the schema (so historical rows stay queryable),
-- just no longer required.

alter table workshop_feedback alter column trainer_knowledge  drop not null;
alter table workshop_feedback alter column trainer_delivery   drop not null;
alter table workshop_feedback alter column trainer_engagement drop not null;
