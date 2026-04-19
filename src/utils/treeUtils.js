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

  // Second pass: wire parent-child. Every parent-less node hangs off the
  // synthetic root, preserving legacy data without corrupting the hierarchy.
  for (const [, node] of map) {
    if (node._parentId === null) {
      syntheticRoot.children.push(node);
    } else {
      const parent = map.get(node._parentId);
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
export function flattenTree(tree, roomId, parentId = null) {
  if (!tree) return [];
  const rows = [];
  let sortOrder = 0;

  function walk(node, parentId) {
    rows.push({
      id: node.id,
      room_id: roomId,
      parent_id: parentId,
      name: node.name,
      type: node.type,
      content: node.content || null,
      sort_order: sortOrder++,
    });
    if (node.children) {
      let childOrder = 0;
      for (const child of node.children) {
        // Reset sort order per parent for proper ordering
        rows[rows.length] = undefined; // placeholder
        rows.pop();
        walk(child, node.id);
      }
    }
  }

  // Simpler version: just walk and assign global order
  rows.length = 0;
  function walkSimple(node, pid, order) {
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
      node.children.forEach((child, i) => walkSimple(child, node.id, i));
    }
  }
  walkSimple(tree, null, 0);

  return rows;
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
