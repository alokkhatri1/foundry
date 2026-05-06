-- 028: workshop_feedback adds a `pace` column to capture the new
-- three-state pace question on the trimmed final survey
-- (too_slow / just_right / too_fast). The existing duration_appropriate
-- yes/no column is preserved for backward compatibility but no longer
-- written by new submissions.

alter table workshop_feedback add column if not exists pace text;
