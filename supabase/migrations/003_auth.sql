-- 003: Admin + Participant auth system
-- Admins use magic link. Participants use Google/LinkedIn OAuth.

-- ============================================================================
-- admins: maps Supabase Auth users to admin role
-- ============================================================================
create table if not exists admins (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  name text,
  created_at timestamptz not null default now()
);

alter table admins enable row level security;
create policy "admins read own" on admins for select to authenticated using (id = auth.uid());
create policy "anon read admins" on admins for select to anon using (true);

-- ============================================================================
-- Add admin_id to rooms (who created the workshop)
-- ============================================================================
alter table rooms add column if not exists admin_id uuid references auth.users(id);

-- ============================================================================
-- Add auth_user_id to participants (links OAuth user to participant)
-- ============================================================================
alter table participants add column if not exists auth_user_id uuid references auth.users(id);
