-- Per-coworker tool configuration. Stored as JSON keyed by tool id so each
-- builtin tool (and any future ones) can carry its own setup without adding
-- columns. Create File uses it to remember a destination folder + subfolder.
ALTER TABLE coworkers
  ADD COLUMN IF NOT EXISTS tool_configs jsonb NOT NULL DEFAULT '{}'::jsonb;
