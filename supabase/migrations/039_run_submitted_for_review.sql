-- 039: workflow_runs gets a "submitted for review" flag.
--
-- The peer audit cycle on Observability needs an explicit gesture from
-- the run's author saying "this version is the one I want feedback
-- on." Without it, every Run sits on the dashboard with equal weight
-- and peers don't know which to read; with it, the gesture matches the
-- "open a PR" beat from real-world engineering.
--
-- Two columns:
--   submitted_for_review_at  — null until submitted; set to now() on
--                              submit; nulled on retraction.
--   submitted_for_review_by  — the participant who submitted. Useful
--                              for the audit trail; will usually be
--                              the run's started_by participant but
--                              we don't enforce that — admin / co-
--                              builder might submit on someone's
--                              behalf later.
--
-- One submission at a time per workflow: when a fresh run is submitted,
-- prior runs of the same workflow get their flag cleared via a
-- transactional update from the client. No constraint enforces this in
-- DB (the constraint would need to be a partial unique index, which
-- works but adds rigidity); the client maintains it on submit.

alter table workflow_runs
  add column if not exists submitted_for_review_at timestamptz,
  add column if not exists submitted_for_review_by uuid references participants(id) on delete set null;

-- Partial index so "show me runs up for review in this workshop" is
-- a fast, single-column-on-non-null lookup.
create index if not exists workflow_runs_submitted_idx
  on workflow_runs(room_id, submitted_for_review_at desc)
  where submitted_for_review_at is not null;
