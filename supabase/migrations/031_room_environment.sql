-- 031: tag every room with the environment it was created in.
--
-- We share one Supabase project across production
-- (foundry.alokkhatri.com) and staging (dev.foundry.alokkhatri.com), so
-- without an environment tag a workshop created from dev would show up on
-- production's admin list and a participant on production could
-- accidentally join a test workshop with its code. The column lets the
-- frontend filter at the right surfaces:
--
--   - production admin list      -> environment = 'production' only
--   - dev admin list             -> no filter (dev needs visibility into
--                                   prod data to develop the research view)
--   - join code lookup           -> strict to current environment in both
--                                   directions, so cross-env joins fail
--                                   with a clean "not found" rather than
--                                   pulling someone into the wrong workshop
--
-- Defaults to 'production' so every existing row gets backfilled to prod,
-- which is correct since they were all created before this split existed.

alter table rooms
  add column if not exists environment text not null default 'production';

create index if not exists rooms_admin_env_idx on rooms(admin_id, environment);
create index if not exists rooms_code_env_idx on rooms(code, environment);
