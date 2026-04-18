-- 011: Delegation maps — the Stage 6 Strategic Delegation artifact.
-- Each map is authored by one user (per-user private) and stores the
-- strategy text + the structured before/after delegation JSON.

create table if not exists delegation_maps (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references rooms(id) on delete cascade,
  auth_user_id uuid references auth.users(id) on delete set null,
  author_name text,
  strategy text not null,
  map jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists delegation_maps_room_user_idx
  on delegation_maps(room_id, auth_user_id, created_at desc);

alter publication supabase_realtime add table delegation_maps;

alter table delegation_maps enable row level security;
grant all on delegation_maps to anon, authenticated, service_role;
create policy "delegation_maps open" on delegation_maps
  for all using (true) with check (true);
