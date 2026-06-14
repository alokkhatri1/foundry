-- 048: Research Bench — saved Findings (the accumulating insight repo) and a
-- corpus-wide per-participant usage aggregation.

-- research_findings: the output of a skill Run, saved so analyses compound
-- year over year. scope is 'all' (lifetime) or a room id; scope_label is the
-- human name. body is the generated insight (markdown).
create table if not exists research_findings (
  id          uuid primary key default gen_random_uuid(),
  title       text not null,
  skill_id    uuid references research_library(id) on delete set null,
  skill_name  text,
  scope       text not null default 'all',
  scope_label text,
  body        text not null default '',
  model       text,
  cost_usd    numeric,
  created_by  uuid references auth.users(id),
  created_at  timestamptz not null default now()
);
create index if not exists research_findings_created_idx on research_findings(created_at desc);

alter table research_findings enable row level security;
create policy "research_findings access" on research_findings
  for all to authenticated
  using (has_research_access())
  with check (has_research_access());

-- usage_by_participant(): per-participant token/cost totals + a per-segment
-- token map, aggregated server-side across ALL cohorts. The browser can't sum
-- llm_usage corpus-wide (tens of thousands of rows, 1000-row cap). SECURITY
-- DEFINER returns only aggregates, no row-level data.
create or replace function usage_by_participant()
returns table (
  participant_id uuid,
  total_tokens   bigint,
  total_cost     numeric,
  n_calls        bigint,
  by_segment     jsonb
)
language sql
stable
security definer
set search_path = public
as $$
  with per_seg as (
    select
      participant_id,
      coalesce(segment, 'other') as segment,
      sum(coalesce(input_tokens,0) + coalesce(output_tokens,0)
        + coalesce(cache_creation_input_tokens,0) + coalesce(cache_read_input_tokens,0)) as toks,
      sum(coalesce(cost_usd,0)) as cost,
      count(*) as calls
    from llm_usage
    where participant_id is not null
    group by participant_id, coalesce(segment, 'other')
  )
  select
    participant_id,
    sum(toks)::bigint    as total_tokens,
    sum(cost)::numeric    as total_cost,
    sum(calls)::bigint    as n_calls,
    jsonb_object_agg(segment, toks) as by_segment
  from per_seg
  group by participant_id;
$$;

grant execute on function usage_by_participant() to authenticated, anon;
