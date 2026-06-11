-- 047: Research Bench library — the year-over-year repo of reusable analysis
-- assets. Two kinds, one table:
--   skill  — an analysis recipe ("how to theme delegation boundaries")
--   theory — a literature/framework lens ("TAM", "algorithm aversion")
--
-- Global, not room-scoped: the same skills/theories are re-applied to every
-- cohort, so they compound across workshops. year_tag lets a researcher
-- version a recipe ('2026', 'v2') without losing the prior one.

create table if not exists research_library (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  body       text not null default '',
  kind       text not null check (kind in ('skill', 'theory')),
  year_tag   text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists research_library_kind_idx on research_library(kind);

-- has_research_access(): admins ∪ research_access allowlist. SECURITY DEFINER
-- so the policy can read admins/research_access regardless of the caller's own
-- row visibility. Pinned search_path per Supabase linter guidance.
create or replace function has_research_access()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from admins where id = auth.uid())
      or exists (select 1 from research_access
                 where lower(email) = lower(auth.jwt() ->> 'email'));
$$;

alter table research_library enable row level security;

create policy "research_library access" on research_library
  for all to authenticated
  using (has_research_access())
  with check (has_research_access());
