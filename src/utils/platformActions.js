// Platform Action Tools — natural language control of platform entities via chat

import { CONNECTOR_PROVIDERS } from '../data/connectorProviders';

const VALID_ICONS = new Set([
  'user', 'users', 'search', 'chart', 'document', 'shield',
  'code', 'scales', 'target', 'bulb', 'package', 'globe',
  'alert', 'gavel', 'wallet', 'checklist',
]);

function normalizeIconAvatar(input) {
  if (!input) return 'icon:user';
  const trimmed = String(input).trim();
  const id = trimmed.startsWith('icon:') ? trimmed.slice(5) : trimmed;
  return VALID_ICONS.has(id) ? 'icon:' + id : 'icon:user';
}

// ===== Tree helpers =====
function collectFiles(node, path = '') {
  const results = [];
  const currentPath = path ? `${path}/${node.name}` : node.name;
  if (node.type === 'file') {
    results.push({ id: node.id, name: node.name, path: currentPath });
  }
  if (node.children) {
    for (const child of node.children) {
      results.push(...collectFiles(child, currentPath));
    }
  }
  return results;
}

function findFileByName(tree, name) {
  if (!tree) return null;
  const lower = name.toLowerCase().replace(/\.md$/, '');
  if (tree.type === 'file') {
    const treeLower = tree.name.toLowerCase().replace(/\.md$/, '');
    if (treeLower === lower || tree.name.toLowerCase() === name.toLowerCase()) return tree;
  }
  if (tree.children) {
    for (const child of tree.children) {
      const found = findFileByName(child, name);
      if (found) return found;
    }
  }
  return null;
}

function findNodeById(tree, id) {
  if (!tree) return null;
  if (tree.id === id) return tree;
  if (tree.children) {
    for (const child of tree.children) {
      const found = findNodeById(child, id);
      if (found) return found;
    }
  }
  return null;
}

function findFolderByType(tree, folderType, deptName) {
  if (!tree || !tree.children) return null;
  // Accept legacy "instructions" as an alias for the renamed "skills" folder
  // so LLM tool calls referencing the old term still resolve.
  const target = folderType.toLowerCase() === 'instructions' ? 'skills' : folderType.toLowerCase();
  for (const dept of tree.children) {
    if (deptName && !dept.name.toLowerCase().includes(deptName.toLowerCase())) continue;
    if (dept.children) {
      for (const subfolder of dept.children) {
        if (subfolder.name.toLowerCase() === target) {
          return subfolder;
        }
      }
    }
  }
  // Fallback: try without department filter
  if (deptName) return findFolderByType(tree, folderType, null);
  return null;
}

// ===== Display names and icons for tool execution cards =====
export const TOOL_DISPLAY_NAMES = {
  list_files: 'List Files',
  read_file: 'Read File',
  create_file: 'Create File',
  update_file: 'Update File',
  list_tools: 'List Tools',
  add_connector: 'Add Connector',
  configure_tool: 'Configure Tool',
  list_coworkers: 'List Coworkers',
  create_coworker: 'Create Coworker',
  list_workflows: 'List Workflows',
  create_workflow: 'Create Workflow',
  run_workflow: 'Run Workflow',
};

export const TOOL_ICONS = {
  list_files: '\uD83D\uDCC2',
  read_file: '\uD83D\uDCC4',
  create_file: '\uD83D\uDCDD',
  update_file: '\u270F\uFE0F',
  list_tools: '\uD83E\uDDF0',
  add_connector: '\uD83D\uDD17',
  configure_tool: '\u2699\uFE0F',
  list_coworkers: '\uD83D\uDC65',
  create_coworker: '\uD83E\uDD16',
  list_workflows: '\uD83D\uDD04',
  create_workflow: '\u26A1',
  run_workflow: '\u25B6\uFE0F',
};

// ===== Tool Schemas (Claude API format) =====
export const PLATFORM_TOOL_SCHEMAS = [
  {
    name: 'list_files',
    description: 'List all files in the platform organized by department and folder type (knowledge/skills). Use this to see what exists before creating or referencing files.',
    input_schema: {
      type: 'object',
      properties: {
        folder_type: {
          type: 'string',
          description: 'Optional filter: "knowledge" or "skills". Omit to list all files.',
        },
      },
      required: [],
    },
  },
  {
    name: 'read_file',
    description: 'Read the full content of a file by name. Use to check contents before updating or to answer questions about a file.',
    input_schema: {
      type: 'object',
      properties: {
        file_name: {
          type: 'string',
          description: 'File name (e.g., "review-criteria.md"). Partial name matching works.',
        },
      },
      required: ['file_name'],
    },
  },
  {
    name: 'create_file',
    description: 'Create a new file. Knowledge files contain policies, rules, and reference material. Skill files define how an AI coworker should behave.',
    input_schema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'File name ending in .md (e.g., "lending-policy.md")' },
        content: { type: 'string', description: 'Full file content in markdown format' },
        folder_type: { type: 'string', description: '"knowledge" or "skills"', enum: ['knowledge', 'skills'] },
        department: { type: 'string', description: 'Department name. If omitted, uses the first department.' },
      },
      required: ['name', 'content', 'folder_type'],
    },
  },
  {
    name: 'update_file',
    description: 'Replace the content of an existing file with new content.',
    input_schema: {
      type: 'object',
      properties: {
        file_name: { type: 'string', description: 'Name of the file to update' },
        content: { type: 'string', description: 'New full content for the file' },
      },
      required: ['file_name', 'content'],
    },
  },
  {
    name: 'list_tools',
    description: 'List all tools on the platform with type, description, and template.',
    input_schema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'add_connector',
    description: `Add an external connector. For platform providers (${CONNECTOR_PROVIDERS.map(p => p.name).join(', ')}), pass provider ID and token. For custom APIs, pass name and url.`,
    input_schema: {
      type: 'object',
      properties: {
        provider: { type: 'string', description: `Provider ID for pre-configured connectors: ${CONNECTOR_PROVIDERS.map(p => `"${p.id}" (${p.name})`).join(', ')}. Omit for custom API.` },
        token: { type: 'string', description: 'API token for the provider (required when provider is set)' },
        name: { type: 'string', description: 'Connector name (required for custom API, optional override for providers)' },
        description: { type: 'string', description: 'What this connector does' },
        url: { type: 'string', description: 'API endpoint URL (required for custom API, ignored for providers)' },
        method: { type: 'string', description: 'HTTP method (for custom API)', enum: ['GET', 'POST'] },
      },
      required: [],
    },
  },
  {
    name: 'configure_tool',
    description: 'Update settings on an existing tool. For checklist tools: change the required items list. For API tools: change URL or method. For custom tools: also change name or description.',
    input_schema: {
      type: 'object',
      properties: {
        tool_name: { type: 'string', description: 'Name of the tool to configure' },
        settings: { type: 'string', description: 'JSON object of settings. Keys: "requiredItems" (array of strings), "url" (string), "method" (string), "name" (string), "description" (string)' },
      },
      required: ['tool_name', 'settings'],
    },
  },
  {
    name: 'list_coworkers',
    description: 'List all AI coworkers with their roles, instruction files, knowledge files, and tools.',
    input_schema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'create_coworker',
    description: 'Create a new AI coworker with a role, instruction files (behavior), knowledge files (context), and tools (capabilities). Files and tools must already exist.',
    input_schema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Coworker name' },
        role: { type: 'string', description: 'Short role description' },
        avatar: { type: 'string', description: 'Icon id (one of: user, users, search, chart, document, shield, code, scales, target, bulb, package, globe, alert, gavel, wallet, checklist). Pass bare id or prefixed with "icon:".' },
        instruction_files: { type: 'string', description: 'Comma-separated instruction file names (must exist)' },
        knowledge_files: { type: 'string', description: 'Comma-separated knowledge file names (must exist)' },
        tool_names: { type: 'string', description: 'Comma-separated tool names (must exist)' },
      },
      required: ['name', 'role'],
    },
  },
  {
    name: 'list_workflows',
    description: 'List all workflows with their step sequences.',
    input_schema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'create_workflow',
    description: 'Create a workflow — a sequence of steps. Agent steps (AI coworker tasks), approval steps (human review gates), and system steps (automated actions). Coworkers referenced in agent steps must already exist.',
    input_schema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Workflow name' },
        steps: {
          type: 'string',
          description: 'JSON array of steps. Agent: {"type":"agent","name":"Step Name","coworker_name":"..."}. Approval: {"type":"approval","name":"Step Name","prompt":"Review instructions"}. System: {"type":"system","name":"Step Name","action":"update_status","description":"..."}.',
        },
      },
      required: ['name', 'steps'],
    },
  },
  {
    name: 'run_workflow',
    description: 'Start executing a workflow with case input text.',
    input_schema: {
      type: 'object',
      properties: {
        workflow_name: { type: 'string', description: 'Name of the workflow to run' },
        case_input: { type: 'string', description: 'Input text for the workflow to process' },
      },
      required: ['workflow_name', 'case_input'],
    },
  },
];

const COLORS = ['#4a7fb5', '#5a9e6f', '#c8956c', '#8b6fb0', '#c45c5c', '#4a9e9e', '#b5784a', '#6f8bb0', '#9e6f8b', '#6fb06f'];

// ===== Main Executor =====
// ctx holds mutable working state so consecutive tool calls in one turn see each other's changes.
// ctx: { fileTree, tools, coworkers, workflows, onUpdateTree, onUpdateTools, onUpdateCoworkers, onUpdateWorkflows, onRunWorkflow }
export function executePlatformAction(toolName, input, ctx) {
  switch (toolName) {
    case 'list_files': {
      const files = collectFiles(ctx.fileTree);
      if (files.length === 0) return 'No files found in the platform.';
      const rawFilter = input.folder_type?.toLowerCase();
      const filterType = rawFilter === 'instructions' ? 'skills' : rawFilter;
      const filtered = filterType
        ? files.filter(f => f.path.toLowerCase().includes(filterType))
        : files;
      if (filtered.length === 0) return `No ${filterType} files found.`;
      return `Files (${filtered.length}):\n\n` + filtered.map(f => `- ${f.name}  (${f.path})`).join('\n');
    }

    case 'read_file': {
      const file = findFileByName(ctx.fileTree, input.file_name);
      if (!file) return `File "${input.file_name}" not found. Use list_files to see available files.`;
      return `## ${file.name}\n\n${file.content}`;
    }

    case 'create_file': {
      const fileName = input.name.endsWith('.md') ? input.name : input.name + '.md';
      const existing = findFileByName(ctx.fileTree, fileName);
      if (existing) return `File "${fileName}" already exists. Use update_file to modify it.`;

      const newTree = JSON.parse(JSON.stringify(ctx.fileTree));
      const folder = findFolderByType(newTree, input.folder_type, input.department);
      if (!folder) return `Could not find a "${input.folder_type}" folder. Check the file structure.`;

      if (!folder.children) folder.children = [];
      folder.children.push({
        id: 'f-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
        name: fileName,
        type: 'file',
        content: input.content,
      });
      ctx.onUpdateTree(newTree);
      ctx.fileTree = newTree;
      return `Created "${fileName}" in ${folder.name}/.`;
    }

    case 'update_file': {
      const file = findFileByName(ctx.fileTree, input.file_name);
      if (!file) return `File "${input.file_name}" not found. Use list_files to see available files.`;
      const newTree = JSON.parse(JSON.stringify(ctx.fileTree));
      const node = findNodeById(newTree, file.id);
      if (node) node.content = input.content;
      ctx.onUpdateTree(newTree);
      ctx.fileTree = newTree;
      return `Updated "${file.name}".`;
    }

    case 'list_tools': {
      const tools = ctx.tools || [];
      if (tools.length === 0) return 'No tools configured.';
      return `Tools (${tools.length}):\n\n` + tools.map(t => {
        const label = t.isPrebuilt ? '[built-in]' : '[custom]';
        return `- **${t.name}** (${t.type}/${t.config?.templateId || '?'}) ${label} — ${t.description}`;
      }).join('\n');
    }

    case 'add_connector': {
      // Provider-based connector
      if (input.provider) {
        const providerDef = CONNECTOR_PROVIDERS.find(p => p.id === input.provider);
        if (!providerDef) return `Unknown provider "${input.provider}". Available: ${CONNECTOR_PROVIDERS.map(p => `${p.id} (${p.name})`).join(', ')}.`;
        if (!input.token) return `Token is required for ${providerDef.name}. ${providerDef.tokenHelp}`;

        const toolName = input.name || providerDef.tool.name;
        const existing = (ctx.tools || []).find(t => t.name.toLowerCase() === toolName.toLowerCase());
        if (existing) return `A connector named "${toolName}" already exists.`;

        const newTool = {
          id: 'tool-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
          name: toolName,
          type: 'connect',
          description: input.description || providerDef.tool.description,
          icon: providerDef.icon,
          createdBy: 'Platform Assistant',
          config: {
            templateId: 'api_caller',
            parameters: providerDef.tool.parameters || [],
            url: providerDef.tool.url,
            method: providerDef.tool.method,
            headers: { Authorization: `${providerDef.tokenPrefix} ${input.token}`, ...providerDef.tool.extraHeaders },
            bodyTemplate: providerDef.tool.bodyTemplate || null,
            provider: providerDef.id,
          },
          createdAt: Date.now(),
        };
        const newTools = [...(ctx.tools || []), newTool];
        ctx.onUpdateTools(newTools);
        ctx.tools = newTools;
        return `Connected to ${providerDef.name}! Added "${toolName}" connector. You can now assign it to a coworker with assign_tool.`;
      }

      // Custom API connector
      if (!input.name) return 'Name is required for custom connectors.';
      if (!input.url) return 'URL is required for custom connectors.';
      const existing = (ctx.tools || []).find(t => t.name.toLowerCase() === input.name.toLowerCase());
      if (existing) return `A connector named "${input.name}" already exists.`;

      const newTool = {
        id: 'tool-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
        name: input.name,
        type: 'connect',
        description: input.description || `Calls ${input.url}`,
        icon: '\uD83D\uDD17',
        createdBy: 'Platform Assistant',
        config: { templateId: 'api_caller', parameters: [], url: input.url, method: input.method || 'GET' },
        createdAt: Date.now(),
      };
      const newTools = [...(ctx.tools || []), newTool];
      ctx.onUpdateTools(newTools);
      ctx.tools = newTools;
      return `Added external connector "${input.name}" (${input.method || 'GET'} ${input.url}).`;
    }

    case 'configure_tool': {
      const tool = (ctx.tools || []).find(t => t.name.toLowerCase() === input.tool_name.toLowerCase());
      if (!tool) return `Tool "${input.tool_name}" not found. Use list_tools to see available tools.`;

      let settings;
      try { settings = JSON.parse(input.settings); }
      catch { return 'Invalid settings JSON.'; }

      const updated = JSON.parse(JSON.stringify(tool));
      // Config-level settings (allowed for all tools)
      if (settings.requiredItems && Array.isArray(settings.requiredItems)) {
        updated.config = { ...updated.config, requiredItems: settings.requiredItems };
      }
      if (settings.url !== undefined) updated.config = { ...updated.config, url: settings.url };
      if (settings.method !== undefined) updated.config = { ...updated.config, method: settings.method };
      // Token update for provider connectors
      if (settings.token && updated.config?.provider) {
        const provDef = CONNECTOR_PROVIDERS.find(p => p.id === updated.config.provider);
        if (provDef) {
          updated.config.headers = { ...updated.config.headers, Authorization: `${provDef.tokenPrefix} ${settings.token}` };
        }
      }
      // Identity settings (only for non-prebuilt tools)
      if (!tool.isPrebuilt) {
        if (settings.name) updated.name = settings.name;
        if (settings.description) updated.description = settings.description;
      }

      const newTools = (ctx.tools || []).map(t => t.id === tool.id ? updated : t);
      ctx.onUpdateTools(newTools);
      ctx.tools = newTools;
      return `Configured "${updated.name}".`;
    }

    case 'list_coworkers': {
      const coworkers = ctx.coworkers || [];
      if (coworkers.length === 0) return 'No coworkers configured.';
      return `Coworkers (${coworkers.length}):\n\n` + coworkers.map(cw => {
        const instrNames = (cw.instructionFileIds || []).map(id => findNodeById(ctx.fileTree, id)?.name || id);
        const knowledgeNames = (cw.knowledgeFileIds || []).map(id => findNodeById(ctx.fileTree, id)?.name || id);
        let details = '';
        if (instrNames.length) details += `  Instructions: ${instrNames.join(', ')}\n`;
        if (knowledgeNames.length) details += `  Knowledge: ${knowledgeNames.join(', ')}\n`;
        return `- **${cw.name}** — ${cw.role}\n${details}`;
      }).join('\n');
    }

    case 'create_coworker': {
      const existing = (ctx.coworkers || []).find(c => c.name.toLowerCase() === input.name.toLowerCase());
      if (existing) return `Coworker "${input.name}" already exists.`;

      const instructionFileIds = [];
      if (input.instruction_files) {
        for (const name of input.instruction_files.split(',').map(s => s.trim()).filter(Boolean)) {
          const f = findFileByName(ctx.fileTree, name);
          if (!f) return `Instruction file "${name}" not found. Create it first with create_file.`;
          instructionFileIds.push(f.id);
        }
      }

      const knowledgeFileIds = [];
      if (input.knowledge_files) {
        for (const name of input.knowledge_files.split(',').map(s => s.trim()).filter(Boolean)) {
          const f = findFileByName(ctx.fileTree, name);
          if (!f) return `Knowledge file "${name}" not found. Create it first with create_file.`;
          knowledgeFileIds.push(f.id);
        }
      }

      const toolIds = [];
      if (input.tool_names) {
        for (const name of input.tool_names.split(',').map(s => s.trim()).filter(Boolean)) {
          const t = (ctx.tools || []).find(t => t.name.toLowerCase() === name.toLowerCase());
          if (!t) return `Tool "${name}" not found.`;
          toolIds.push(t.id);
        }
      }

      const newCoworker = {
        id: 'cw-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
        name: input.name,
        role: input.role,
        avatar: normalizeIconAvatar(input.avatar),
        color: COLORS[(ctx.coworkers || []).length % COLORS.length],
        instructionFileIds,
        knowledgeFileIds,
        toolIds,
        createdBy: 'Platform Assistant',
        createdAt: Date.now(),
      };
      const newCoworkers = [...(ctx.coworkers || []), newCoworker];
      ctx.onUpdateCoworkers(newCoworkers);
      ctx.coworkers = newCoworkers;
      return `Created coworker "${input.name}".`;
    }

    case 'list_workflows': {
      const workflows = ctx.workflows || [];
      if (workflows.length === 0) return 'No workflows configured.';
      return `Workflows (${workflows.length}):\n\n` + workflows.map(wf => {
        const steps = wf.steps.map((s, i) => {
          if (s.type === 'agent') {
            const cw = (ctx.coworkers || []).find(c => c.id === s.coworkerId);
            return `  ${i + 1}. [Agent] ${s.name}${cw ? ` — ${cw.name}` : ''}`;
          }
          if (s.type === 'approval') return `  ${i + 1}. [Approval] ${s.name}`;
          return `  ${i + 1}. [System] ${s.name}`;
        }).join('\n');
        return `- **${wf.name}**\n${steps}`;
      }).join('\n\n');
    }

    case 'create_workflow': {
      let steps;
      try { steps = JSON.parse(input.steps); }
      catch { return 'Invalid steps JSON. Provide a JSON array of step objects.'; }

      const resolvedSteps = [];
      for (let i = 0; i < steps.length; i++) {
        const step = steps[i];
        const base = { id: 'step-' + (i + 1), type: step.type, name: step.name };

        if (step.type === 'agent') {
          const cw = (ctx.coworkers || []).find(c => c.name.toLowerCase() === (step.coworker_name || '').toLowerCase());
          if (!cw) return `Coworker "${step.coworker_name}" not found for step "${step.name}". Create the coworker first.`;
          resolvedSteps.push({ ...base, coworkerId: cw.id, inputDescription: step.description || '' });
        } else if (step.type === 'approval') {
          resolvedSteps.push({
            ...base,
            prompt: step.prompt || 'Review and decide',
            actions: step.actions || ['Approve', 'Reject', 'Request Correction', 'Escalate'],
            maxCorrections: step.max_corrections || 3,
            correctionTarget: step.correction_target || 'step-1',
          });
        } else if (step.type === 'system') {
          resolvedSteps.push({ ...base, action: step.action || 'update_status', description: step.description || '' });
        } else {
          resolvedSteps.push(base);
        }
      }

      const newWorkflow = {
        id: 'wf-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
        name: input.name,
        steps: resolvedSteps,
      };
      const newWorkflows = [...(ctx.workflows || []), newWorkflow];
      ctx.onUpdateWorkflows(newWorkflows);
      ctx.workflows = newWorkflows;
      return `Created workflow "${input.name}" with ${resolvedSteps.length} steps.`;
    }

    case 'run_workflow': {
      const wf = (ctx.workflows || []).find(w => w.name.toLowerCase().includes(input.workflow_name.toLowerCase()));
      if (!wf) return `Workflow "${input.workflow_name}" not found. Use list_workflows to see available workflows.`;
      ctx.onRunWorkflow(wf.id, input.case_input);
      return `Started workflow "${wf.name}". Check the Activity tab to monitor progress.`;
    }

    default:
      return `Unknown action: ${toolName}`;
  }
}
