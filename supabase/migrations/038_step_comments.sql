-- 038: step_comments — Stage 7 peer audit becomes inline step comments.
--
-- The W/SW/NW whole-run audit shape (run_audits, migration 034) was
-- replaced with per-step decision comments. Each comment sits on one
-- step of one run, asking the same question phrased to fit the actor:
--   - coworker step: "Is the AI making decisions correctly?"
--   - review step:   "Is the human making decisions correctly?"
--
-- Author kind ('human' | 'ai') lets peer audits and AI auditor outputs
-- share the same table; Auditability (Stage 8) reads both kinds and
-- renders them side-by-side per step.
--
-- run_audits + ai_run_audits stay in schema for archival reads of older
-- workshops; new code only writes to step_comments.

create table if not exists step_comments (
  id uuid primary key default gen_random_uuid(),
  workshop_id uuid not null references rooms(id) on delete cascade,
  run_id text not null references workflow_runs(id) on delete cascade,
  step_id text not null,
  body text not null,
  author_id uuid references participants(id) on delete set null,
  author_kind text not null default 'human' check (author_kind in ('human', 'ai')),
  created_at timestamptz default now()
);

create index if not exists step_comments_run_step_idx on step_comments(run_id, step_id, created_at);
create index if not exists step_comments_workshop_idx on step_comments(workshop_id, created_at desc);
create index if not exists step_comments_author_idx on step_comments(author_id);

alter table step_comments enable row level security;
drop policy if exists "auth full access step_comments" on step_comments;
create policy "auth full access step_comments" on step_comments
  for all to authenticated using (true) with check (true);
drop policy if exists "anon full access step_comments" on step_comments;
create policy "anon full access step_comments" on step_comments
  for all to anon using (true) with check (true);

alter publication supabase_realtime add table step_comments;
