-- capstone_drafts: per-participant five-column workflow plan from the new
-- Stage 8 Capstone tab. One row per (workshop_id, participant_id);
-- `rows` is the JSONB array of step objects each shaped:
--   { id, step, node, dataSource, fileIds: [...], remarks }
--
-- No realtime subscription — single-author edits to their own draft.
-- Same RLS pattern as workshop_feedback: open to authenticated so the
-- post-OAuth client can upsert; the unique constraint is the dedup gate.

create table if not exists capstone_drafts (
  id uuid primary key default gen_random_uuid(),
  workshop_id uuid not null references rooms(id) on delete cascade,
  participant_id uuid not null references participants(id) on delete cascade,
  rows jsonb not null default '[]'::jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (workshop_id, participant_id)
);

create index if not exists capstone_drafts_workshop_idx on capstone_drafts(workshop_id);

alter table capstone_drafts enable row level security;
drop policy if exists "auth full access capstone_drafts" on capstone_drafts;
create policy "auth full access capstone_drafts" on capstone_drafts
  for all to authenticated using (true) with check (true);
drop policy if exists "anon full access capstone_drafts" on capstone_drafts;
create policy "anon full access capstone_drafts" on capstone_drafts
  for all to anon using (true) with check (true);
