-- 002: Break room_state JSONB blob into granular tables for real-time collaboration
-- Each entity gets its own table so concurrent edits don't overwrite each other.

-- ============================================================================
-- files: flat rows with parent_id (tree reconstructed client-side)
-- ============================================================================
create table if not exists files (
  id text primary key,
  room_id uuid not null references rooms(id) on delete cascade,
  parent_id text,
  name text not null,
  type text not null check (type in ('file', 'folder')),
  content text,
  sort_order integer not null default 0,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists files_room_idx on files(room_id);
create index if not exists files_parent_idx on files(room_id, parent_id);

-- ============================================================================
-- coworkers: one row per coworker, file IDs as JSONB arrays
-- ============================================================================
create table if not exists coworkers (
  id text primary key,
  room_id uuid not null references rooms(id) on delete cascade,
  name text not null,
  role text,
  avatar text,
  color text,
  instruction_file_ids jsonb not null default '[]'::jsonb,
  knowledge_file_ids jsonb not null default '[]'::jsonb,
  tool_ids jsonb not null default '[]'::jsonb,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists coworkers_room_idx on coworkers(room_id);

-- ============================================================================
-- tools: one row per tool, config as JSONB
-- ============================================================================
create table if not exists tools (
  id text primary key,
  room_id uuid not null references rooms(id) on delete cascade,
  name text not null,
  type text,
  description text,
  icon text,
  is_builtin boolean not null default false,
  config jsonb,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists tools_room_idx on tools(room_id);

-- ============================================================================
-- workflows: one row per workflow, steps as JSONB array
-- ============================================================================
create table if not exists workflows (
  id text primary key,
  room_id uuid not null references rooms(id) on delete cascade,
  name text not null,
  steps jsonb not null default '[]'::jsonb,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists workflows_room_idx on workflows(room_id);

-- ============================================================================
-- Recursive file tree flattening helper
-- ============================================================================
create or replace function migrate_tree_node(
  p_room_id uuid,
  p_parent_id text,
  p_children jsonb
) returns void as $$
declare
  child jsonb;
  i integer := 0;
begin
  if p_children is null then return; end if;
  for child in select * from jsonb_array_elements(p_children) loop
    insert into files (id, room_id, parent_id, name, type, content, sort_order)
    values (
      child->>'id',
      p_room_id,
      p_parent_id,
      child->>'name',
      child->>'type',
      child->>'content',
      i
    ) on conflict (id) do nothing;

    if child->'children' is not null then
      perform migrate_tree_node(p_room_id, child->>'id', child->'children');
    end if;
    i := i + 1;
  end loop;
end;
$$ language plpgsql;

-- ============================================================================
-- Recursive file deletion helper
-- ============================================================================
create or replace function delete_file_tree(p_file_id text) returns void as $$
  with recursive descendants as (
    select id from files where id = p_file_id
    union all
    select f.id from files f join descendants d on f.parent_id = d.id
  )
  delete from files where id in (select id from descendants);
$$ language sql;

-- ============================================================================
-- Migrate existing room_state data into granular tables
-- ============================================================================
do $$
declare
  r record;
  room_uuid uuid;
  cw jsonb;
  tool jsonb;
  wf jsonb;
begin
  for r in select * from room_state loop
    room_uuid := r.room_id;

    -- Migrate file_tree
    if r.file_tree is not null then
      insert into files (id, room_id, parent_id, name, type, content, sort_order)
      values (
        r.file_tree->>'id', room_uuid, null,
        r.file_tree->>'name', r.file_tree->>'type',
        r.file_tree->>'content', 0
      ) on conflict (id) do nothing;

      perform migrate_tree_node(room_uuid, r.file_tree->>'id', r.file_tree->'children');
    end if;

    -- Migrate coworkers
    if r.coworkers is not null and jsonb_array_length(r.coworkers) > 0 then
      for cw in select * from jsonb_array_elements(r.coworkers) loop
        insert into coworkers (id, room_id, name, role, avatar, color,
                               instruction_file_ids, knowledge_file_ids, tool_ids,
                               created_by)
        values (
          cw->>'id', room_uuid, cw->>'name', cw->>'role',
          cw->>'avatar', cw->>'color',
          coalesce(cw->'instructionFileIds', '[]'::jsonb),
          coalesce(cw->'knowledgeFileIds', '[]'::jsonb),
          coalesce(cw->'toolIds', '[]'::jsonb),
          cw->>'createdBy'
        ) on conflict (id) do nothing;
      end loop;
    end if;

    -- Migrate tools
    if r.tools is not null and jsonb_array_length(r.tools) > 0 then
      for tool in select * from jsonb_array_elements(r.tools) loop
        insert into tools (id, room_id, name, type, description, icon, is_builtin,
                          config, created_by)
        values (
          tool->>'id', room_uuid, tool->>'name', tool->>'type',
          tool->>'description', tool->>'icon',
          coalesce((tool->>'isBuiltin')::boolean, (tool->>'isPrebuilt')::boolean, false),
          tool->'config',
          tool->>'createdBy'
        ) on conflict (id) do nothing;
      end loop;
    end if;

    -- Migrate workflows
    if r.workflows is not null and jsonb_array_length(r.workflows) > 0 then
      for wf in select * from jsonb_array_elements(r.workflows) loop
        insert into workflows (id, room_id, name, steps)
        values (
          wf->>'id', room_uuid, wf->>'name', coalesce(wf->'steps', '[]'::jsonb)
        ) on conflict (id) do nothing;
      end loop;
    end if;
  end loop;
end $$;

-- ============================================================================
-- Realtime publication
-- ============================================================================
alter publication supabase_realtime add table files, coworkers, tools, workflows;

-- ============================================================================
-- Row-Level Security (workshop-appropriate: open access)
-- ============================================================================
alter table files      enable row level security;
alter table coworkers  enable row level security;
alter table tools      enable row level security;
alter table workflows  enable row level security;

create policy "anon full access files"      on files      for all to anon using (true) with check (true);
create policy "anon full access coworkers"  on coworkers  for all to anon using (true) with check (true);
create policy "anon full access tools"      on tools      for all to anon using (true) with check (true);
create policy "anon full access workflows"  on workflows  for all to anon using (true) with check (true);
