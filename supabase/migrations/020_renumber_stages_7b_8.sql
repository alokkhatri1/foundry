-- 020: Renumber stages 7b -> 8 and 8 -> 9
--
-- Rationale: removing the 'a' / 'b' suffixes now that 5b is gone leaves
-- the Coworker stage as plain '5'. The remaining tail (Economics + Graduation)
-- still carries '7b' / '8' which is asymmetric. Flatten to integers so the
-- arc reads 1, 2, 3, 4, 5, 6, 7, 8, 9.
--
-- Order of operations matters: shift the literal '8' (Graduation) up to '9'
-- FIRST. If we did 7b -> 8 first, both old '7b' and old '8' rooms would
-- collide on the new '8' label.
--
-- Run this in the Supabase SQL editor immediately before deploying the
-- matching code change. Existing rooms at any pre-rename stage will land
-- correctly on the new label after this script + the alias table in
-- RevealAt.jsx (which keeps '7b' -> '8' as a forward-compat safety net).

begin;

-- rooms.current_stage
update rooms set current_stage = '9' where current_stage = '8';
update rooms set current_stage = '8' where current_stage = '7b';

-- stage_events audit trail
update stage_events set to_stage   = '9' where to_stage   = '8';
update stage_events set to_stage   = '8' where to_stage   = '7b';
update stage_events set from_stage = '9' where from_stage = '8';
update stage_events set from_stage = '8' where from_stage = '7b';

commit;
