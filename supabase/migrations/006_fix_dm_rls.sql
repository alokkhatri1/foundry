-- 006: Fix RLS on direct_messages — the original policy (from 004) was scoped
-- to the anon role only, but authenticated clients hit 42501 on insert because
-- Supabase routes authenticated requests through the authenticated role.
-- Replace with a permissive policy that applies to all roles (public).

drop policy if exists "anon full access direct_messages" on direct_messages;
create policy "full access direct_messages" on direct_messages
  for all using (true) with check (true);
