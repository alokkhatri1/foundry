-- Renumber stages to make room for the new Capstone (8) and Copilot (9) stages.
--
-- Old layout:                             New layout:
--   8: Economics                            8: Capstone (NEW)
--   9: Graduation                           9: Copilot reveal (NEW)
--                                          10: Economics  (was 8)
--                                          11: Graduation (was 9)
--
-- Move existing rooms forward so a delivered workshop that ended at
-- "Graduation" stays at Graduation under the new numbering. Rooms below
-- stage 8 are unaffected. Order matters: shift 9 -> 11 first, otherwise
-- the 8 -> 10 update would also catch the now-also-10 rooms that started
-- as 9. Done as two distinct UPDATEs to keep it obvious.

update rooms set current_stage = '11' where current_stage = '9';
update rooms set current_stage = '10' where current_stage = '8';
