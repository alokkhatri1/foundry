-- 005: Use email (from Google OAuth) as participant uniqueness key per workshop.
-- Fixes the case where two different accounts share a display name and collide
-- on the old (room_id, name) unique constraint.

alter table participants add column if not exists email text;

-- Drop the default (room_id, name) unique constraint from 001_init.sql.
alter table participants drop constraint if exists participants_room_id_name_key;

-- New uniqueness: (room_id, email). Postgres allows multiple NULL emails, so
-- legacy rows with email=null are not blocked; new rows always carry email.
alter table participants add constraint participants_room_id_email_unique unique (room_id, email);
