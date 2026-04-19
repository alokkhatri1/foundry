-- 015: DAG-shaped workflow storage.
--
-- Phase 1 of the Stage 6 (Orchestration) rebuild from a linear chain into a
-- full visual DAG. Workflows now also carry nodes[] (with position + data) and
-- edges[] (source/target with handles), plus a destination folder + subfolder
-- the final output auto-saves into on successful completion. The legacy
-- steps[] column stays for the existing sequential runtime until the DAG
-- runtime replaces it in Phase 5.

alter table workflows
  add column if not exists nodes jsonb,
  add column if not exists edges jsonb,
  add column if not exists destination jsonb;
