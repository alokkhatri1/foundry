-- 004: Phase 1 — workshop deprecation + 1:1 direct messages

-- ============================================================================
-- rooms.deprecated_at: when set, room is archived/sealed (no new joiners)
-- ============================================================================
alter table rooms add column if not exists deprecated_at timestamptz null;

-- ============================================================================
-- direct_messages: 1:1 DMs between participants in a room
-- ============================================================================
create table if not exists direct_messages (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references rooms(id) on delete cascade,
  from_participant_id uuid not null references participants(id) on delete cascade,
  to_participant_id uuid not null references participants(id) on delete cascade,
  content text not null,
  created_at timestamptz not null default now()
);

create index if not exists direct_messages_thread_idx
  on direct_messages (room_id, from_participant_id, to_participant_id, created_at);
create index if not exists direct_messages_to_idx
  on direct_messages (room_id, to_participant_id, created_at);

-- ============================================================================
-- Realtime publication
-- ============================================================================
alter publication supabase_realtime add table direct_messages;

-- ============================================================================
-- Row-Level Security (sandbox posture: anon full access within room scope)
-- ============================================================================
alter table direct_messages enable row level security;
create policy "anon full access direct_messages" on direct_messages
  for all to anon using (true) with check (true);
