-- 027: add habit-forming intention column to stage_reflections.
-- Captures the participant's implementation intention coming out of each
-- primitive stage — "when will I use this?", "what document will I try
-- this with?". Required client-side, nullable in DB so backfilling
-- legacy rows from 026 doesn't break.

alter table stage_reflections add column if not exists habit text;
