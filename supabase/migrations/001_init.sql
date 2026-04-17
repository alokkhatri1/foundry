-- Workshop Sandbox — shared-state schema
-- Apply via the Supabase SQL editor or `supabase db push`.

create extension if not exists "pgcrypto";

-- ============================================================================
-- rooms: one row per workshop code (e.g., "alok")
-- ============================================================================
create table if not exists rooms (
  id uuid primary key default gen_random_uuid(),
  code text unique not null,
  org_name text,
  created_at timestamptz not null default now()
);

-- ============================================================================
-- participants: workshop attendees per room
-- ============================================================================
create table if not exists participants (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references rooms(id) on delete cascade,
  name text not null,
  color text,
  online boolean not null default false,
  joined_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  unique (room_id, name)
);
create index if not exists participants_room_idx on participants(room_id);

-- ============================================================================
-- room_state: shared tree, coworkers, tools, workflows (one row per room)
-- ============================================================================
create table if not exists room_state (
  room_id uuid primary key references rooms(id) on delete cascade,
  file_tree jsonb,
  coworkers jsonb not null default '[]'::jsonb,
  tools jsonb not null default '[]'::jsonb,
  workflows jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);

-- ============================================================================
-- messages: append-only chat log
-- ============================================================================
create table if not exists messages (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references rooms(id) on delete cascade,
  conversation_id text,
  type text not null,
  participant_name text,
  content text,
  label text,
  coworker_avatar text,
  tool_name text,
  tool_icon text,
  tool_type text,
  tool_inputs jsonb,
  tool_outputs jsonb,
  payload jsonb,
  created_at timestamptz not null default now()
);
create index if not exists messages_room_created_idx on messages(room_id, created_at);
create index if not exists messages_conversation_idx on messages(conversation_id);

-- ============================================================================
-- workflow_runs: per-case run metadata + step_results
-- ============================================================================
create table if not exists workflow_runs (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references rooms(id) on delete cascade,
  workflow_id text,
  workflow_name text,
  status text,
  current_step_index integer,
  started_by text,
  case_input text,
  step_results jsonb not null default '[]'::jsonb,
  started_at timestamptz not null default now(),
  completed_at timestamptz
);
create index if not exists workflow_runs_room_idx on workflow_runs(room_id, started_at desc);

-- ============================================================================
-- approvals: first-class human-in-the-loop decisions (research-friendly)
-- ============================================================================
create table if not exists approvals (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references rooms(id) on delete cascade,
  run_id uuid references workflow_runs(id) on delete cascade,
  step_id text,
  step_name text,
  prompt text,
  assignee_name text,
  resolved_by text,
  action text,
  comment text,
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);
create index if not exists approvals_room_idx on approvals(room_id, created_at desc);
create index if not exists approvals_run_idx on approvals(run_id);

-- ============================================================================
-- tool_calls: first-class tool executions (research-friendly)
-- ============================================================================
create table if not exists tool_calls (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references rooms(id) on delete cascade,
  run_id uuid references workflow_runs(id) on delete cascade,
  coworker_id text,
  coworker_name text,
  tool_name text not null,
  tool_type text,
  inputs jsonb,
  outputs jsonb,
  success boolean,
  created_at timestamptz not null default now()
);
create index if not exists tool_calls_room_idx on tool_calls(room_id, created_at desc);
create index if not exists tool_calls_run_idx on tool_calls(run_id);

-- ============================================================================
-- Realtime publication — so the client can subscribe to changes
-- ============================================================================
do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
end $$;

alter publication supabase_realtime add table
  participants, room_state, messages, workflow_runs, approvals, tool_calls;

-- ============================================================================
-- Row-Level Security
-- Sandbox posture: anon key can read/write anything in any room. The room code
-- is the only gate (workshop-appropriate, not production-grade).
-- ============================================================================
alter table rooms         enable row level security;
alter table participants  enable row level security;
alter table room_state    enable row level security;
alter table messages      enable row level security;
alter table workflow_runs enable row level security;
alter table approvals     enable row level security;
alter table tool_calls    enable row level security;

create policy "anon full access rooms"         on rooms         for all to anon using (true) with check (true);
create policy "anon full access participants"  on participants  for all to anon using (true) with check (true);
create policy "anon full access room_state"    on room_state    for all to anon using (true) with check (true);
create policy "anon full access messages"      on messages      for all to anon using (true) with check (true);
create policy "anon full access workflow_runs" on workflow_runs for all to anon using (true) with check (true);
create policy "anon full access approvals"     on approvals     for all to anon using (true) with check (true);
create policy "anon full access tool_calls"    on tool_calls    for all to anon using (true) with check (true);
