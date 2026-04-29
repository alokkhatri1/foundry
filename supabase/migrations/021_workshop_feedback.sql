-- workshop_feedback: post-workshop survey responses, one row per participant.
-- Shown as a mandatory gate before the graduation rubric. Open RLS so peers
-- can read each other's submissions for the admin review surface; the unique
-- constraint enforces "one submission per participant per workshop".

create table if not exists workshop_feedback (
  id uuid primary key default gen_random_uuid(),
  workshop_id uuid not null references rooms(id) on delete cascade,
  participant_id uuid not null references participants(id) on delete cascade,
  participant_name text,
  -- Section A: Training Evaluation (1-5)
  satisfaction          smallint not null check (satisfaction          between 1 and 5),
  relevance             smallint not null check (relevance             between 1 and 5),
  clarity               smallint not null check (clarity               between 1 and 5),
  trainer_knowledge     smallint not null check (trainer_knowledge     between 1 and 5),
  trainer_delivery      smallint not null check (trainer_delivery      between 1 and 5),
  trainer_engagement    smallint not null check (trainer_engagement    between 1 and 5),
  -- Section B: Design & Materials
  materials_quality     smallint not null check (materials_quality     between 1 and 5),
  duration_appropriate  boolean  not null,
  theory_practice       smallint not null check (theory_practice       between 1 and 5),
  -- Section C: Learning Impact (1-5)
  improved_skills       smallint not null check (improved_skills       between 1 and 5),
  can_apply             smallint not null check (can_apply             between 1 and 5),
  -- Section D: Open feedback (optional)
  most_valuable         text,
  future_topics         text,
  improvement_notes     text,
  -- Section E: Recommendation
  would_recommend       boolean  not null,
  -- Section F: Platform (the one extra question — separate from trainer/content)
  platform_rating       smallint not null check (platform_rating       between 1 and 5),
  created_at timestamptz default now(),
  unique (workshop_id, participant_id)
);

create index if not exists workshop_feedback_workshop_idx on workshop_feedback(workshop_id);

alter table workshop_feedback enable row level security;
create policy "anon full access workshop_feedback" on workshop_feedback for all to anon using (true) with check (true);

alter publication supabase_realtime add table workshop_feedback;
