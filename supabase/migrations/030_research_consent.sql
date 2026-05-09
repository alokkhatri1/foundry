-- research_consent: per-participant decision on whether their workshop
-- artifacts can be used for research. Captured as the 6th question on the
-- pre-graduation feedback form. Stored in its own table (not folded into
-- workshop_feedback) because consent has its own lifecycle: it is versioned
-- against the consent text the participant actually saw, can be withdrawn
-- later, and may eventually be re-asked across cohorts as the wording
-- evolves. Workshop_feedback is once-and-done; consent is durable.
--
-- Tri-state model:
--   row absent           -> not asked yet
--   granted = true       -> participant said yes
--   granted = false      -> participant said no (still recorded; we honour
--                           it by excluding their data from research surfaces)
--
-- scope is reserved for future granular consent (e.g. 'chats-only',
-- 'no-dms'); v1 only ever writes 'all-anonymized'. consent_text_version
-- bumps whenever the on-screen consent copy materially changes, so we can
-- always tell what wording each row corresponds to.

create table if not exists research_consent (
  id uuid primary key default gen_random_uuid(),
  workshop_id uuid not null references rooms(id) on delete cascade,
  participant_id uuid not null references participants(id) on delete cascade,
  granted boolean not null,
  scope text not null default 'all-anonymized',
  consent_text_version integer not null default 1,
  granted_at timestamptz default now(),
  withdrawn_at timestamptz,
  unique (workshop_id, participant_id)
);

create index if not exists research_consent_workshop_idx on research_consent(workshop_id);
create index if not exists research_consent_participant_idx on research_consent(participant_id);

alter table research_consent enable row level security;
drop policy if exists "auth full access research_consent" on research_consent;
create policy "auth full access research_consent" on research_consent
  for all to authenticated using (true) with check (true);
drop policy if exists "anon full access research_consent" on research_consent;
create policy "anon full access research_consent" on research_consent
  for all to anon using (true) with check (true);

-- Realtime so the admin Research view's per-participant consent badges
-- can flip live as the cohort works through the closing feedback form.
alter publication supabase_realtime add table research_consent;
