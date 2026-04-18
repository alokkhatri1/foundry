-- 009: User preferences — global per user (follows them across workshops).

create table if not exists user_preferences (
  auth_user_id uuid primary key references auth.users(id) on delete cascade,
  content text not null default '',
  updated_at timestamptz not null default now()
);

alter publication supabase_realtime add table user_preferences;

alter table user_preferences enable row level security;
grant all on user_preferences to anon, authenticated, service_role;
create policy "preferences open" on user_preferences
  for all using (true) with check (true);
