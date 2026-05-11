-- Per-stage reflections and end-of-workshop feedback — extended to the
-- research+industry instrument (research-questions.md, Sections 3 and 4).
--
-- stage_reflections previously stored:
--   confidence smallint  (1-5 "how clearly do you understand")
--   note       text      (in your own words)
--   habit      text      (what you'll try this week)
--
-- The instrument keeps the clarity rating (now stored in `confidence` so
-- HandoutPage rendering doesn't need a column rename) and replaces note
-- + habit with four shape-specific answers per stage. Columns added:
--   agreement      smallint  Q2 — 1-5 agreement scale (usefulness / trust /
--                            confidence / behavior change, per stage)
--   transfer_text  text      Q3 — free text (where Q3 is text; null for
--                            Stage 7 which has two single-selects)
--   structured     jsonb     Q4 — multi-select array or single-select string,
--                            plus a second key for Stage 7's two single-
--                            selects (confidence_shift + check_first)
--
-- The old `note` and `habit` columns stay so historical data is readable
-- and the new form can keep populating them if we want a smooth read in
-- the admin Research export (TBD per slice).
alter table stage_reflections
  add column if not exists agreement     smallint check (agreement between 1 and 5),
  add column if not exists transfer_text text,
  add column if not exists structured    jsonb not null default '{}'::jsonb;

-- workshop_feedback — restructured to match Section 4 of the instrument.
-- Existing columns that stay (already in the table since 021/022/028):
--   satisfaction, relevance, clarity, theory_practice, improved_skills,
--   can_apply, platform_rating, platform_reliability, platform_support,
--   would_recommend.
--
-- New columns added below for the perception-shift / trust / new text
-- and single-select Q's the instrument adds:
--   ai_was_chat_tool        smallint  Q53 "before this workshop, I thought of AI as a chat tool"
--   ai_repeatable_systems   smallint  Q54 "after, I see AI as organizable repeatable systems"
--   aware_human_oversight   smallint  Q55 "after, more aware of where AI needs human oversight"
--   aware_cost_tradeoffs    smallint  Q56 "after, more aware of cost/resource tradeoffs"
--   trust_when_inspectable  smallint  Q57 "trust AI more when I can inspect instructions/knowledge/workflow"
--   concept_used_first      text      Q51 single-select: which concept they'd use first
--   foundry_improvement_text text     Q46 "one thing that would make Foundry easier"
--   real_task_text          text      Q52 "one real task where you could imagine using Foundry"
--
-- Trainer-specific columns (trainer_knowledge / trainer_delivery /
-- trainer_engagement), materials_quality, duration_appropriate, and the
-- old free-text columns (most_valuable / future_topics / improvement_notes)
-- aren't in the new form. They stay in the schema as nullable so historical
-- rows survive and admin dashboards built on them keep working — the new
-- form just stops populating them.
alter table workshop_feedback
  add column if not exists ai_was_chat_tool         smallint check (ai_was_chat_tool         between 1 and 5),
  add column if not exists ai_repeatable_systems    smallint check (ai_repeatable_systems    between 1 and 5),
  add column if not exists aware_human_oversight    smallint check (aware_human_oversight    between 1 and 5),
  add column if not exists aware_cost_tradeoffs     smallint check (aware_cost_tradeoffs     between 1 and 5),
  add column if not exists trust_when_inspectable   smallint check (trust_when_inspectable   between 1 and 5),
  add column if not exists identify_ai_tasks        smallint check (identify_ai_tasks        between 1 and 5),
  add column if not exists identify_human_review    smallint check (identify_human_review    between 1 and 5),
  add column if not exists likely_to_use            smallint check (likely_to_use            between 1 and 5),
  add column if not exists concept_used_first       text,
  add column if not exists foundry_improvement_text text,
  add column if not exists real_task_text           text;
