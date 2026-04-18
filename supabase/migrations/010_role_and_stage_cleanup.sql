-- 010: Role capture (per user) + cleanup of deprecated '5c' stage.
--
-- Role is captured at sign-up and used by the Stage 6 Strategic Delegation
-- decomposer to assign tasks to humans by their organizational role.

alter table user_preferences add column if not exists role text;

-- Normalize any room that happens to sit on the removed '5c' stage to '5b'.
-- Admin can re-reveal forward from there.
update rooms set current_stage = '5b' where current_stage = '5c';
