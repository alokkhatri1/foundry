-- Scope direct_messages SELECT so realtime only broadcasts DMs to sender +
-- receiver. Cuts per-client realtime processing ~17× in a 35-person room.
--
-- APPLY 24-48 HOURS BEFORE THE 2026-04-29 WORKSHOP via `supabase db push`
-- or the migration UI. Follow the pre-apply checklist below. Do NOT apply
-- at go-time — RLS changes are hard to diagnose under live load.
--
-- ---------------------------------------------------------------------
-- Purpose
-- ---------------------------------------------------------------------
-- Tightens SELECT on `direct_messages` so Supabase realtime broadcasts
-- each DM only to the two participants actually involved (sender +
-- receiver), instead of every subscribed client in the room.
--
-- Current policy (from migrations 006/007) is `using (true)` — open SELECT
-- for all roles. Realtime respects RLS, so today every one of 35 clients
-- receives every DM insert in the room and filters in JS. Scale-bound
-- waste on CPU + bandwidth across all browsers.
--
-- ---------------------------------------------------------------------
-- Why INSERT stays permissive
-- ---------------------------------------------------------------------
-- AI coworker mirror rows in `participants` do not have `auth_user_id`
-- set (they represent a synthetic identity, not an authed human). When
-- a user's browser runs a coworker that DMs a human, the INSERT comes
-- from the user's session but `from_participant_id` is the coworker's
-- id. A scoped INSERT policy that keys off `auth.uid()` would reject
-- those writes. Leaving INSERT permissive keeps the existing app logic
-- working; only SELECT gets scoped, which is where the fan-out savings
-- actually come from.
--
-- ---------------------------------------------------------------------
-- Risks + rollback
-- ---------------------------------------------------------------------
-- - Any participant whose `participants.auth_user_id` is NULL (e.g.
--   pre-auth legacy rows, orphaned rows) will not see DMs addressed to
--   them after this applies. Verify with:
--     select count(*) from participants where auth_user_id is null and kind = 'human';
-- - Realtime evaluates this policy on every DM insert for every
--   subscribed client. The `exists()` join is indexed on
--   `participants.id` (primary key) and `participants.auth_user_id`
--   (from migration 003). Should be sub-millisecond per evaluation.
-- - Rollback is a one-liner:
--     drop policy if exists "dm scoped select" on direct_messages;
--     create policy "dm open" on direct_messages for all using (true) with check (true);
--
-- ---------------------------------------------------------------------
-- Pre-apply checklist
-- ---------------------------------------------------------------------
-- 1. Confirm 04-29 workshop has ended.
-- 2. Run: select count(*) from participants where auth_user_id is null and kind = 'human';
--    If > 0, investigate before applying — they would lose DM visibility.
-- 3. Take a DB backup or rely on Supabase's point-in-time recovery (Pro).
-- 4. Smoke test in a dev project first: two browsers, authenticated,
--    verify each sees only their own DMs via realtime.

-- ---------------------------------------------------------------------
-- Migration body
-- ---------------------------------------------------------------------

drop policy if exists "anon full access direct_messages" on direct_messages;
drop policy if exists "full access direct_messages" on direct_messages;
drop policy if exists "dm all access" on direct_messages;
drop policy if exists "dm open" on direct_messages;

grant all on direct_messages to authenticated, service_role;

-- SELECT scoped to sender-or-receiver. Realtime broadcasts inherit this.
create policy "dm scoped select" on direct_messages
  for select to authenticated
  using (
    exists (
      select 1 from participants p
      where p.id in (direct_messages.from_participant_id, direct_messages.to_participant_id)
        and p.auth_user_id = auth.uid()
    )
  );

-- INSERT stays permissive for authed users (see "Why INSERT stays permissive" above).
create policy "dm insert authed" on direct_messages
  for insert to authenticated
  with check (true);

-- Updates/deletes are not exercised by the current app. Keep a permissive
-- policy so future admin tooling isn't blocked.
create policy "dm modify authed" on direct_messages
  for update to authenticated using (true) with check (true);
create policy "dm delete authed" on direct_messages
  for delete to authenticated using (true);

alter table direct_messages enable row level security;
