-- 026: per-stage reflection prompts captured as a participant advances.
-- Replaces the all-at-once end-of-workshop survey for the per-primitive
-- learning checks; the final workshop_feedback row keeps NPS, trainer,
-- and the open-text wrap-up only.
--
-- One row per (workshop, participant, stage). Both fields nullable so a
-- "skipped" row can still be persisted (which doubles as the "we already
-- asked" flag — same shape we'd add to dedup re-prompting later).

create table if not exists stage_reflections (
  id uuid primary key default gen_random_uuid(),
  workshop_id uuid not null references rooms(id) on delete cascade,
  participant_id uuid not null references participants(id) on delete cascade,
  stage text not null,
  confidence int,
  note text,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (workshop_id, participant_id, stage)
);

create index if not exists stage_reflections_workshop_idx on stage_reflections(workshop_id);
create index if not exists stage_reflections_participant_idx on stage_reflections(participant_id);

alter table stage_reflections enable row level security;
drop policy if exists "auth full access stage_reflections" on stage_reflections;
create policy "auth full access stage_reflections" on stage_reflections
  for all to authenticated using (true) with check (true);
drop policy if exists "anon full access stage_reflections" on stage_reflections;
create policy "anon full access stage_reflections" on stage_reflections
  for all to anon using (true) with check (true);
