-- 046: Research Bench access allowlist
--
-- The standalone Research Bench (research.foundry.alokkhatri.com) is gated to
-- admins + an email allowlist. Admins manage the allowlist from the dashboard;
-- a signed-in researcher can read their own row to self-check access.
--
-- Email is the key (lowercased by the app on insert) because we gate on the
-- Google identity's email, not an auth.users id — the person may never have
-- signed in before being granted access.

create table if not exists research_access (
  email      text primary key,
  added_by   uuid references auth.users(id),
  created_at timestamptz not null default now()
);

alter table research_access enable row level security;

-- A signed-in user can see their own allowlist row (drives the access check).
create policy "research_access read own" on research_access
  for select to authenticated
  using (lower(email) = lower(auth.jwt() ->> 'email'));

-- Admins can read and manage every row.
create policy "research_access admins manage" on research_access
  for all to authenticated
  using (exists (select 1 from admins a where a.id = auth.uid()))
  with check (exists (select 1 from admins a where a.id = auth.uid()));
