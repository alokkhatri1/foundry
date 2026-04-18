-- 008: Phase 2 — reveal mechanic.
--
-- rooms.current_stage: the stage the admin has currently revealed. Default
-- '6' so existing workshops aren't locked out of any surface. New workshops
-- created via createWorkshop should explicitly set '1' so they start gated.
--
-- stage_events: audit log of every reveal (from/to stage, actor, timestamp).
-- Feeds the research archive and lets us replay a workshop's pacing.

alter table rooms add column if not exists current_stage text not null default '6';

create table if not exists stage_events (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references rooms(id) on delete cascade,
  from_stage text,
  to_stage text not null,
  actor uuid references auth.users(id),
  created_at timestamptz not null default now()
);
create index if not exists stage_events_room_idx on stage_events(room_id, created_at);

alter publication supabase_realtime add table stage_events;

alter table stage_events enable row level security;
create policy "stage events open" on stage_events
  for all using (true) with check (true);
