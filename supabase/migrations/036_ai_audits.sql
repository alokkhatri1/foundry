-- 036: AI audits — Stage 8 Auditability.
--
-- For each participant, the platform runs one comprehensive AI audit
-- pass over everything they produced (files, coworkers, workflows,
-- runs) and writes structured findings. The Auditability stage shows
-- those findings alongside the peer audits captured at Stage 7, so the
-- participant sees the gap between human and AI reads of the same work.
--
-- One row per (workshop, participant). Re-running an audit overwrites.
-- `findings` is JSONB carrying both per-artefact rows and an overall
-- read — schema-light so the prompt can evolve without migrations.
-- `prompt_version` lets us track which audit prompt produced the row
-- (so we can re-audit older sessions when the prompt changes).
--
-- Open RLS to match the workshop posture; realtime so the page fills
-- in live when the audit completes for the cohort.

create table if not exists ai_audits (
  id uuid primary key default gen_random_uuid(),
  workshop_id uuid not null references rooms(id) on delete cascade,
  participant_id uuid not null references participants(id) on delete cascade,
  findings jsonb not null default '{}'::jsonb,
  prompt_version integer not null default 1,
  status text not null default 'pending',
  error text,
  model text,
  input_tokens integer not null default 0,
  output_tokens integer not null default 0,
  cost_usd numeric(10, 6) not null default 0,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (workshop_id, participant_id)
);

create index if not exists ai_audits_workshop_idx on ai_audits(workshop_id, updated_at desc);
create index if not exists ai_audits_participant_idx on ai_audits(participant_id);

alter table ai_audits enable row level security;
drop policy if exists "auth full access ai_audits" on ai_audits;
create policy "auth full access ai_audits" on ai_audits
  for all to authenticated using (true) with check (true);
drop policy if exists "anon full access ai_audits" on ai_audits;
create policy "anon full access ai_audits" on ai_audits
  for all to anon using (true) with check (true);

alter publication supabase_realtime add table ai_audits;
