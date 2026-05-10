-- 037: AI audit moves from per-participant to per-run.
--
-- Original Auditability scope (migration 036, ai_audits) audited a
-- participant's entire substrate at once — every file, every coworker,
-- every workflow, every run. That had two problems:
--   1) Cost scaled with how much each participant produced (variable,
--      sometimes large) — easily $0.05–$0.15 per participant.
--   2) The AI's read was generic against their substrate rather than
--      aligned with what they actually engaged with via peer audit.
--
-- New scope: AI audits a *run* — same scope as peer audit. One AI audit
-- per run, shared across all viewers. The Auditability page renders the
-- AI's read alongside whatever peer audits the participant wrote at
-- Stage 7, on the SAME run — direct apples-to-apples comparison.
--
-- The old ai_audits table stays in the schema (rows remain queryable)
-- but new code stops writing to it.

create table if not exists ai_run_audits (
  id uuid primary key default gen_random_uuid(),
  workshop_id uuid not null references rooms(id) on delete cascade,
  run_id text not null references workflow_runs(id) on delete cascade,
  findings jsonb not null default '{}'::jsonb,
  prompt_version integer not null default 1,
  status text not null default 'pending',
  error text,
  model text,
  triggered_by uuid references participants(id) on delete set null,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (workshop_id, run_id)
);

create index if not exists ai_run_audits_workshop_idx on ai_run_audits(workshop_id, updated_at desc);
create index if not exists ai_run_audits_run_idx on ai_run_audits(run_id);

alter table ai_run_audits enable row level security;
drop policy if exists "auth full access ai_run_audits" on ai_run_audits;
create policy "auth full access ai_run_audits" on ai_run_audits
  for all to authenticated using (true) with check (true);
drop policy if exists "anon full access ai_run_audits" on ai_run_audits;
create policy "anon full access ai_run_audits" on ai_run_audits
  for all to anon using (true) with check (true);

alter publication supabase_realtime add table ai_run_audits;
