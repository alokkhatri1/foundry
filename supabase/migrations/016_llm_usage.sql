-- 016: LLM usage logging.
--
-- Every Claude API call from the platform writes one row here with the token
-- counts returned in the response's `usage` block plus a precomputed USD cost.
-- The Stage 7b (Economics) reveal surfaces these rows to participants as
-- accumulated spend + per-segment breakdown. cost_usd is stored (not derived)
-- so historical rows survive future price changes.
--
-- segment: what kind of operation triggered the call. Example values:
--   'chat'                  — a regular chat turn (no coworker)
--   'coworker_chat'         — a turn in a DM/chat with a saved coworker
--   'workflow_run'          — a coworker step executing inside a workflow run
--   'workflow_copilot'      — the chat-to-DAG copilot
--   'refine_description'    — the "Refine" button on coworker description
--
-- segment_ref_id: optional pointer to the specific thing. For 'workflow_run'
-- this is `<runId>:<stepId>`; for 'coworker_chat' the conversation id; etc.

create table if not exists llm_usage (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  workshop_id uuid references rooms(id) on delete cascade,
  participant_id uuid references participants(id) on delete set null,
  segment text not null,
  segment_ref_id text,
  model text not null,
  input_tokens int not null default 0,
  output_tokens int not null default 0,
  cache_creation_input_tokens int not null default 0,
  cache_read_input_tokens int not null default 0,
  cost_usd numeric(10, 6) not null default 0
);

create index if not exists llm_usage_workshop_idx on llm_usage(workshop_id, created_at);
create index if not exists llm_usage_participant_idx on llm_usage(participant_id, created_at);
create index if not exists llm_usage_segment_idx on llm_usage(workshop_id, segment);

alter publication supabase_realtime add table llm_usage;

alter table llm_usage enable row level security;
-- Matches the permissive policy used across the rest of the tables in this
-- codebase (see stage_events, direct_messages). RLS tightening is a later
-- chore — not a blocker for the workshop.
create policy "llm usage open" on llm_usage
  for all using (true) with check (true);
