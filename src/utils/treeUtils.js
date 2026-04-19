// Convert between flat DB rows and nested tree structure

// Flat rows → nested tree (for rendering)
//
// Always returns a single synthetic root labelled "files". All rows with
// parent_id = null are hung directly off this root, so legacy top-level
// folders (e.g. a stray "Instructions" or "Knowledge" from removed
// auto-creation logic) become siblings of the real dept folders instead of
// overtaking the breadcrumb — and the breadcrumb always starts from "files".
export function buildTree(flatFiles) {
  if (!flatFiles || flatFiles.length === 0) return null;

  const map = new Map();
  const syntheticRoot = {
    id: 'root',
    name: 'files',
    type: 'folder',
    children: [],
    _sort: -1,
    _parentId: null,
  };

  // First pass: create node objects
  for (const f of flatFiles) {
    map.set(f.id, {
      id: f.id,
      name: f.name,
      type: f.type,
      ...(f.type === 'file' ? { content: f.content || '' } : { children: [] }),
      _sort: f.sortOrder ?? f.sort_order ?? 0,
      _parentId: f.parentId ?? f.parent_id ?? null,
    });
  }

  // Heal: a previous bug wrote a phantom row with id='root' and reparented
  // real top-level folders under it. Drop that row and promote its children
  // back to the true top level so the breadcrumb doesn't grow an extra "files"
  // layer for rooms that experienced the bug.
  map.delete('root');

  // Second pass: wire parent-child. Every parent-less node hangs off the
  // synthetic root, preserving legacy data without corrupting the hierarchy.
  // Anything pointing at the deleted phantom 'root' is also treated as
  // parent-less.
  for (const [, node] of map) {
    const pid = node._parentId === 'root' ? null : node._parentId;
    if (pid === null) {
      syntheticRoot.children.push(node);
    } else {
      const parent = map.get(pid);
      if (parent && parent.children) {
        parent.children.push(node);
      }
    }
  }

  // Third pass: sort children and clean temp fields
  function clean(node) {
    if (node.children) {
      node.children.sort((a, b) => a._sort - b._sort);
      node.children.forEach(c => clean(c));
    }
    delete node._sort;
    delete node._parentId;
  }
  clean(syntheticRoot);

  return syntheticRoot;
}

// Nested tree → flat rows (for seeding DB)
//
// The synthetic root (id='root', name='files') is UI-only — it must never be
// written to the DB. If the incoming tree is the synthetic root, flatten its
// children directly as parent-less top-level rows. Writing the synthetic root
// would create a phantom 'root' row that everything else points to, which
// breaks on reload.
export function flattenTree(tree, roomId) {
  if (!tree) return [];
  const rows = [];

  function walk(node, pid, order) {
    rows.push({
      id: node.id,
      room_id: roomId,
      parent_id: pid,
      name: node.name,
      type: node.type,
      content: node.content || null,
      sort_order: order,
    });
    if (node.children) {
      node.children.forEach((child, i) => walk(child, node.id, i));
    }
  }

  if (tree.id === 'root') {
    (tree.children || []).forEach((child, i) => walk(child, null, i));
  } else {
    walk(tree, null, 0);
  }

  return rows;
}

// Preserve a local coworker's toolConfigs when the DB-sourced version comes
// back empty. Covers three sync paths — realtime echo, initial room load,
// and handleJoin — where migration 013 not being applied would otherwise
// strip the user's Create File destination / Request Review whitelist on
// every sync. If the incoming has any configs, it wins (normal case).
export function preserveToolConfigs(incoming, previous) {
  if (!incoming) return incoming;
  const hasIncoming = incoming.toolConfigs && Object.keys(incoming.toolConfigs).length > 0;
  if (hasIncoming) return incoming;
  const localConfigs = previous?.toolConfigs;
  if (!localConfigs || Object.keys(localConfigs).length === 0) return incoming;
  return { ...incoming, toolConfigs: localConfigs };
}

// Map a Supabase DB row to the flat file format used internally
export function mapFileRow(row) {
  return {
    id: row.id,
    parentId: row.parent_id,
    name: row.name,
    type: row.type,
    content: row.content,
    sortOrder: row.sort_order ?? 0,
    roomId: row.room_id,
  };
}

// Map a Supabase coworker row to JS shape
export function mapCoworkerRow(row) {
  return {
    id: row.id,
    name: row.name,
    role: row.role,
    avatar: row.avatar,
    color: row.color,
    instructionFileIds: row.instruction_file_ids || [],
    knowledgeFileIds: row.knowledge_file_ids || [],
    toolIds: row.tool_ids || [],
    toolConfigs: row.tool_configs || {},
    createdBy: row.created_by,
    createdAt: row.created_at ? new Date(row.created_at).getTime() : Date.now(),
  };
}

// Map a Supabase tool row to JS shape
export function mapToolRow(row) {
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    description: row.description,
    icon: row.icon,
    isBuiltin: row.is_builtin,
    config: row.config,
    createdBy: row.created_by,
    createdAt: row.created_at ? new Date(row.created_at).getTime() : Date.now(),
  };
}

// Map a Supabase workflow row to JS shape
export function mapWorkflowRow(row) {
  return {
    id: row.id,
    name: row.name,
    steps: row.steps || [],
    createdBy: row.created_by,
    createdAt: row.created_at ? new Date(row.created_at).getTime() : Date.now(),
  };
}
