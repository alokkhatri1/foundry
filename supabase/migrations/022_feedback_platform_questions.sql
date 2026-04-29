-- Adds two platform-experience columns to workshop_feedback. The original
-- 021 migration carries platform_rating as the single platform question;
-- this expands it into three (ease / reliability / support) since the
-- training is delivered via the platform and one rating wasn't enough
-- signal. Nullable so the migration is safe if any rows pre-exist; the
-- client-side form enforces required-ness for new submissions.

alter table workshop_feedback
  add column if not exists platform_reliability smallint check (platform_reliability between 1 and 5),
  add column if not exists platform_support smallint check (platform_support between 1 and 5);
