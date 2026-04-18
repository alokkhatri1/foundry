-- 007: Re-enable RLS on direct_messages with a permissive policy that works
-- for authenticated users (the bug in 004 was the TO clause scoped to anon
-- only; this replaces it with a policy that applies to all roles).
--
-- Optional to run — RLS-off works fine for workshop settings. Apply if you
-- want defense-in-depth for longer-running deployments.

drop policy if exists "anon full access direct_messages" on direct_messages;
drop policy if exists "full access direct_messages" on direct_messages;
drop policy if exists "dm all access" on direct_messages;

grant all on direct_messages to anon, authenticated, service_role;

create policy "dm open" on direct_messages
  for all using (true) with check (true);

alter table direct_messages enable row level security;
