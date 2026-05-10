-- participant_demographics: a one-shot baseline questionnaire that gates
-- the chat. Eight questions split across "About you" (role / tenure /
-- industry / age) and "You and AI" (familiarity / use frequency / tools /
-- workshop goal). Required at first sign-in; cannot reach Chat until
-- submitted. Joined into the research bundle export per participant.
--
-- One row per (workshop_id, participant_id). RLS is open to match the
-- rest of the app's posture so the admin Research view can read peer
-- demographics into the bundle without elevated credentials. Versioned
-- via questions_text_version so a future wording change is recoverable
-- when interpreting historical rows.

create table if not exists participant_demographics (
  id uuid primary key default gen_random_uuid(),
  workshop_id uuid not null references rooms(id) on delete cascade,
  participant_id uuid not null references participants(id) on delete cascade,
  participant_name text,
  -- Section A · About you
  role text not null,
  tenure_band text not null check (tenure_band in ('lt_1y', '1_3y', '3_7y', '7_15y', 'gt_15y')),
  industry text not null,
  age_band text not null check (age_band in ('18_24', '25_34', '35_44', '45_54', '55_plus')),
  -- Section B · You and AI
  ai_familiarity smallint not null check (ai_familiarity between 1 and 5),
  ai_use_frequency text not null check (ai_use_frequency in ('never', 'occasional', 'weekly', 'daily', 'multi_daily')),
  ai_tools text[] not null default '{}',
  workshop_goal text not null,
  questions_text_version smallint not null default 1,
  created_at timestamptz default now(),
  unique (workshop_id, participant_id)
);

create index if not exists participant_demographics_workshop_idx
  on participant_demographics(workshop_id);

alter table participant_demographics enable row level security;
-- Both roles get the same posture as research_consent: anon for the
-- pre-login JoinScreen path, authenticated once Supabase auth has stamped
-- the request. Missing the authenticated policy was the cause of the
-- "new row violates RLS" error participants hit at first sign-in.
create policy "auth full access participant_demographics"
  on participant_demographics
  for all to authenticated
  using (true)
  with check (true);
create policy "anon full access participant_demographics"
  on participant_demographics
  for all to anon
  using (true)
  with check (true);

alter publication supabase_realtime add table participant_demographics;
