-- 006: Fix RLS + grants on direct_messages so authenticated users can insert.
-- The original 004 policy was scoped to anon only, which caused 42501 on
-- insert from Supabase authenticated sessions. Also ensure grants.

drop policy if exists "anon full access direct_messages" on direct_messages;
drop policy if exists "full access direct_messages" on direct_messages;

grant all on direct_messages to anon, authenticated, service_role;

create policy "dm all access" on direct_messages
  for all to anon, authenticated, service_role using (true) with check (true);
