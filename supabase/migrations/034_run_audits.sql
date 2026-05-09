-- 034: peer audits on workflow runs (Stage 7 — Observability).
--
-- Stage 7 already shows every participant's runs to the whole cohort —
-- the queryability part. This adds the *active* part: a peer can read
-- another participant's run and leave a structured audit using the
-- What/So What/Now What triplet from the Liberating Structures canon.
--
-- One audit = one auditor's response on one run. Many-to-many: any
-- participant can audit any run (including their own — self-audit lands
-- as a journal entry on your own work). Public to the cohort by default
-- so audits become first-class artefacts in the queryable substrate.
--
-- run_id is text to match workflow_runs.id (relaxed by migration 019).
-- reviewee_id is denormalised from the run's started_by participant for
-- query speed in the admin Research view.

create table if not exists run_audits (
  id uuid primary key default gen_random_uuid(),
  workshop_id uuid not null references rooms(id) on delete cascade,
  run_id text not null references workflow_runs(id) on delete cascade,
  auditor_id uuid not null references participants(id) on delete cascade,
  reviewee_id uuid references participants(id) on delete set null,
  observation text not null,
  meaning text not null,
  suggestion text not null,
  created_at timestamptz default now()
);

create index if not exists run_audits_run_idx on run_audits(run_id, created_at);
create index if not exists run_audits_workshop_idx on run_audits(workshop_id, created_at desc);
create index if not exists run_audits_auditor_idx on run_audits(auditor_id);

alter table run_audits enable row level security;
drop policy if exists "auth full access run_audits" on run_audits;
create policy "auth full access run_audits" on run_audits
  for all to authenticated using (true) with check (true);
drop policy if exists "anon full access run_audits" on run_audits;
create policy "anon full access run_audits" on run_audits
  for all to anon using (true) with check (true);

alter publication supabase_realtime add table run_audits;
