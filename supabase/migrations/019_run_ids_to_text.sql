-- 019: Change workflow_runs.id, approvals.run_id, tool_calls.run_id from uuid to text.
--
-- The app has always generated non-UUID run ids like "run-1776844988334-o3eq"
-- but the 001_init migration typed these columns as uuid. Writes have been
-- silently failing with "invalid input syntax for type uuid" ever since,
-- which is why approvals and tool_calls never persisted across sessions.
-- Relax the type so what the app sends is what Supabase stores.

alter table approvals  drop constraint if exists approvals_run_id_fkey;
alter table tool_calls drop constraint if exists tool_calls_run_id_fkey;

alter table workflow_runs alter column id drop default;
alter table workflow_runs alter column id set data type text using id::text;

alter table approvals  alter column run_id set data type text using run_id::text;
alter table tool_calls alter column run_id set data type text using run_id::text;

alter table approvals
  add constraint approvals_run_id_fkey
  foreign key (run_id) references workflow_runs(id) on delete cascade;

alter table tool_calls
  add constraint tool_calls_run_id_fkey
  foreign key (run_id) references workflow_runs(id) on delete cascade;

-- Nudge PostgREST so the schema change propagates without waiting for the
-- periodic auto-reload.
notify pgrst, 'reload schema';
