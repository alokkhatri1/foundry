// ===== Tool Type System: 6 Universal Organizational Verbs =====

// ===== CALCULATE Templates =====
const CALCULATE_TEMPLATES = {
  weighted_scorer: {
    name: 'Weighted Scorer',
    parameters: [
      { name: 'score_items', label: 'Score Items (JSON)', type: 'string', required: true, description: 'JSON array of {name, value, weight} objects' },
      { name: 'threshold', label: 'Pass Threshold', type: 'number', required: true, description: 'Minimum score to pass' },
    ],
    execute(p) {
      try {
        const items = JSON.parse(p.score_items);
        const totalWeight = items.reduce((s, i) => s + (i.weight || 1), 0);
        const score = items.reduce((s, i) => s + (i.value || 0) * (i.weight || 1), 0) / totalWeight;
        const pass = score >= p.threshold;
        return { result: pass ? 'PASS' : 'FAIL', score: Math.round(score), details: items.map(i => `${i.name}: ${i.value} (weight: ${i.weight || 1})`).join('\n') + `\n\nWeighted Score: ${score.toFixed(1)}\nThreshold: ${p.threshold}` };
      } catch { return { result: 'ERROR', score: 0, details: 'Invalid JSON input for score items' }; }
    },
  },
  ratio_calculator: {
    name: 'Ratio Calculator',
    parameters: [
      { name: 'numerator', label: 'Numerator', type: 'number', required: true },
      { name: 'denominator', label: 'Denominator', type: 'number', required: true },
      { name: 'max_ratio', label: 'Max Allowed Ratio (%)', type: 'number', required: true },
    ],
    execute(p) {
      if (p.denominator === 0) return { result: 'ERROR', score: 0, details: 'Division by zero' };
      const ratio = (p.numerator / p.denominator) * 100;
      const pass = ratio <= p.max_ratio;
      return { result: pass ? 'WITHIN LIMIT' : 'EXCEEDS LIMIT', score: Math.round(Math.max(0, 100 - (ratio - p.max_ratio) * 2)), details: `Ratio: ${ratio.toFixed(1)}%\nMax Allowed: ${p.max_ratio}%` };
    },
  },
  cost_estimator: {
    name: 'Cost Estimator',
    parameters: [
      { name: 'base_cost', label: 'Base Cost', type: 'number', required: true },
      { name: 'quantity', label: 'Quantity / Units', type: 'number', required: true },
      { name: 'overhead_pct', label: 'Overhead (%)', type: 'number', required: true },
    ],
    execute(p) {
      const subtotal = p.base_cost * p.quantity;
      const overhead = subtotal * (p.overhead_pct / 100);
      const total = subtotal + overhead;
      return { result: `Total: ${Math.round(total).toLocaleString()}`, score: null, details: `Base Cost: ${p.base_cost.toLocaleString()} x ${p.quantity} = ${subtotal.toLocaleString()}\nOverhead (${p.overhead_pct}%): ${Math.round(overhead).toLocaleString()}\nTotal Estimated Cost: ${Math.round(total).toLocaleString()}` };
    },
  },
};

// ===== LOOKUP Templates =====
const LOOKUP_TEMPLATES = {
  file_search: {
    name: 'File Search',
    parameters: [
      { name: 'query', label: 'Search Query', type: 'string', required: true, description: 'Keywords to search for in files' },
    ],
    execute(p, fileTree) {
      const terms = p.query.toLowerCase().split(/\s+/).filter(w => w.length > 2);
      if (terms.length === 0) return { success: true, output: 'No search terms provided.' };
      const results = [];
      function search(node) {
        if (node.type === 'file' && node.content) {
          const lower = node.content.toLowerCase();
          const matches = terms.filter(t => lower.includes(t));
          if (matches.length > 0) results.push({ name: node.name, matches: matches.length, snippet: node.content.slice(0, 300) });
        }
        if (node.children) node.children.forEach(search);
      }
      search(fileTree);
      if (results.length === 0) return { success: true, output: `No files found matching: ${p.query}` };
      return { success: true, output: `Found ${results.length} files:\n\n` + results.sort((a, b) => b.matches - a.matches).map(r => `### ${r.name} (${r.matches} matches)\n${r.snippet}...`).join('\n\n') };
    },
  },
  topic_lookup: {
    name: 'Topic Lookup',
    parameters: [
      { name: 'topic', label: 'Topic', type: 'string', required: true, description: 'What topic to look up in knowledge files' },
    ],
    execute(p, fileTree) {
      return LOOKUP_TEMPLATES.file_search.execute({ query: p.topic }, fileTree);
    },
  },
};

// ===== CREATE Templates =====
const CREATE_TEMPLATES = {
  document_generator: {
    name: 'Document Generator',
    parameters: [
      { name: 'title', label: 'Document Title', type: 'string', required: true },
      { name: 'content', label: 'Document Content', type: 'string', required: true },
      { name: 'recommendation', label: 'Recommendation', type: 'string', required: false },
    ],
    execute(p, onCreateFile) {
      const md = `# ${p.title}\n\n${p.content}${p.recommendation ? '\n\n## Recommendation\n' + p.recommendation : ''}`;
      const fileName = p.title.toLowerCase().replace(/[^a-z0-9]+/g, '-') + '.md';
      if (onCreateFile) onCreateFile(fileName, md);
      return { success: true, output: `Document created: ${fileName}\n\n${md.slice(0, 500)}` };
    },
  },
  record_creator: {
    name: 'Record Creator',
    parameters: [
      { name: 'record_type', label: 'Record Type', type: 'string', required: true, description: 'e.g., Account, Case, Ticket' },
      { name: 'data', label: 'Record Data', type: 'string', required: true, description: 'Key information for the record' },
    ],
    execute(p) {
      const refId = `${p.record_type.toUpperCase().slice(0, 3)}-${new Date().getFullYear()}-${String(Math.floor(Math.random() * 99999)).padStart(5, '0')}`;
      return { success: true, output: `Record Created\nType: ${p.record_type}\nRef: ${refId}\nTimestamp: ${new Date().toISOString().slice(0, 19)}\nData: ${p.data}` };
    },
  },
};

// ===== COMMUNICATE Templates =====
const COMMUNICATE_TEMPLATES = {
  send_chat_message: {
    name: 'Send Chat Message',
    parameters: [
      { name: 'message', label: 'Message', type: 'string', required: true, description: 'Message to post to the shared chat' },
    ],
    execute(p, onMessage) {
      if (onMessage) onMessage({ type: 'system', content: `[Notification] ${p.message}` });
      return { success: true, output: `Message sent: "${p.message}"` };
    },
  },
  dm_participant: {
    name: 'DM Participant',
    parameters: [
      { name: 'recipient_name', label: 'Recipient', type: 'string', required: true },
      { name: 'message', label: 'Message', type: 'string', required: true },
    ],
    async execute(p, onMessage, onSendDm) {
      if (!onSendDm) return { success: false, output: 'Direct messaging is not available in this context.' };
      return await onSendDm(p.recipient_name, p.message);
    },
  },
  ask_human: {
    name: 'Ask Human',
    parameters: [
      { name: 'question', label: 'Question', type: 'string', required: true, description: 'The question or item to check with the human' },
    ],
    async execute(p, onMessage, onSendDm, onAskHuman) {
      if (!onAskHuman) return { success: false, output: 'Asking humans is not available in this context.' };
      return await onAskHuman(p.question);
    },
  },
  notify_person: {
    name: 'Notify Person',
    parameters: [
      { name: 'recipient', label: 'Recipient Name', type: 'string', required: true },
      { name: 'message', label: 'Message', type: 'string', required: true },
    ],
    execute(p, onMessage) {
      if (onMessage) onMessage({ type: 'system', content: `[To: ${p.recipient}] ${p.message}` });
      return { success: true, output: `Notification sent to ${p.recipient}: "${p.message}"` };
    },
  },
};

// ===== VALIDATE Templates =====
const VALIDATE_TEMPLATES = {
  checklist_validator: {
    name: 'Checklist Validator',
    parameters: [
      { name: 'submitted_items', label: 'Submitted Items', type: 'string', required: true, description: 'Comma-separated list of items to check' },
    ],
    execute(p, config) {
      const required = config?.requiredItems || [];
      const submitted = p.submitted_items.split(',').map(s => s.trim().toLowerCase());
      const results = required.map(req => {
        const found = submitted.some(s => s.includes(req.toLowerCase()) || req.toLowerCase().includes(s));
        return { item: req, status: found ? 'PRESENT' : 'MISSING' };
      });
      const passed = results.filter(r => r.status === 'PRESENT').length;
      const total = results.length;
      return { success: true, output: `Checklist: ${passed}/${total} items present\n\n` + results.map(r => `${r.status === 'PRESENT' ? '\u2713' : '\u2717'} ${r.item}: ${r.status}`).join('\n') + `\n\nResult: ${passed === total ? 'ALL ITEMS PRESENT' : `${total - passed} ITEMS MISSING`}` };
    },
  },
  rule_checker: {
    name: 'Rule Checker',
    parameters: [
      { name: 'input_value', label: 'Input Value', type: 'number', required: true },
      { name: 'rule_description', label: 'Rule Description', type: 'string', required: true, description: 'What rule to check against' },
      { name: 'threshold', label: 'Threshold', type: 'number', required: true },
    ],
    execute(p) {
      const pass = p.input_value <= p.threshold;
      return { success: true, output: `Rule: ${p.rule_description}\nInput: ${p.input_value}\nThreshold: ${p.threshold}\nResult: ${pass ? 'PASS' : 'FAIL'}` };
    },
  },
};

// ===== CONNECT Templates =====
const CONNECT_TEMPLATES = {
  api_caller: {
    name: 'API Caller',
    parameters: [
      { name: 'query_param', label: 'Query Parameter', type: 'string', required: false, description: 'Optional parameter to append to URL' },
    ],
    async execute(p, config) {
      let url = config?.url;
      if (!url) return { success: false, output: 'No URL configured.' };
      try {
        // Substitute {param} placeholders in URL path
        for (const [key, val] of Object.entries(p)) {
          url = url.replace(`{${key}}`, encodeURIComponent(String(val ?? '')));
        }

        // Build headers from config
        const headers = config?.headers ? { ...config.headers } : {};

        // Build body for POST requests
        let body;
        const method = config?.method || 'GET';
        if (method === 'POST') {
          if (config?.bodyTemplate) {
            body = config.bodyTemplate;
            for (const [key, val] of Object.entries(p)) {
              const escaped = String(val ?? '').replace(/\\/g, '\\\\').replace(/"/g, '\\"');
              body = body.replace(new RegExp(`\\{${key}\\}`, 'g'), escaped);
            }
          } else if (Object.keys(p).length > 0) {
            body = JSON.stringify(p);
            if (!headers['Content-Type']) headers['Content-Type'] = 'application/json';
          }
        }

        const fetchOpts = { method };
        if (Object.keys(headers).length > 0) fetchOpts.headers = headers;
        if (body) fetchOpts.body = body;

        const response = await fetch(url, fetchOpts);
        if (!response.ok) {
          const errBody = await response.text().catch(() => '');
          return { success: false, output: `API returned ${response.status}${errBody ? ': ' + errBody.slice(0, 500) : ''}` };
        }
        const contentType = response.headers.get('content-type') || '';
        const output = contentType.includes('json') ? JSON.stringify(await response.json(), null, 2) : await response.text();
        return { success: true, output: output.slice(0, 3000) };
      } catch (e) { return { success: false, output: `API error: ${e.message}` }; }
    },
  },
  webhook_sender: {
    name: 'Webhook Sender',
    parameters: [
      { name: 'payload', label: 'Payload', type: 'string', required: true, description: 'Data to send' },
    ],
    async execute(p, config) {
      const url = config?.url;
      if (!url) return { success: false, output: 'No webhook URL configured.' };
      try {
        const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: p.payload });
        return { success: true, output: `Webhook sent. Status: ${response.status}` };
      } catch (e) { return { success: false, output: `Webhook error: ${e.message}` }; }
    },
  },
};

// ===== RESEARCH Templates =====
const RESEARCH_TEMPLATES = {
  claude_research: {
    name: 'Claude Research',
    parameters: [
      { name: 'topic', label: 'Topic', type: 'string', required: true, description: 'The topic to research' },
    ],
    async execute(p, callClaudeAPI) {
      if (!callClaudeAPI) return { success: false, output: 'Research unavailable (no API).' };
      const systemPrompt = 'You are a research assistant. Produce a concise research brief on the topic below. Use markdown with clear sections (Overview, Key Points, Notes). Be accurate and specific. Do not fabricate sources.';
      const result = await callClaudeAPI(systemPrompt, `Research topic: ${p.topic}`);
      return {
        success: !!result.success,
        output: result.success ? result.content : `Research failed: ${result.error || 'unknown'}`,
      };
    },
  },
};

// ===== PROCESS Templates =====
const PROCESS_TEMPLATES = {
  claude_process_document: {
    name: 'Process Document',
    parameters: [
      { name: 'file_name', label: 'File Name', type: 'string', required: true },
      { name: 'instruction', label: 'Instruction', type: 'string', required: true },
    ],
    async execute(p, fileTree, callClaudeAPI) {
      function findByName(node, name) {
        if (!node) return null;
        if (node.type === 'file' && node.name === name) return node;
        if (node.children) {
          for (const c of node.children) {
            const found = findByName(c, name);
            if (found) return found;
          }
        }
        return null;
      }
      const file = findByName(fileTree, p.file_name);
      if (!file) return { success: false, output: `File not found: ${p.file_name}` };
      if (!file.content) return { success: false, output: `File is empty: ${p.file_name}` };
      if (!callClaudeAPI) return { success: false, output: 'Processing unavailable (no API).' };
      const systemPrompt = 'You process documents. Given a document and an instruction, follow the instruction precisely on the document and return the result. Stay focused on the instruction.';
      const userMsg = `Instruction: ${p.instruction}\n\nDocument (${file.name}):\n${file.content}`;
      const result = await callClaudeAPI(systemPrompt, userMsg);
      return {
        success: !!result.success,
        output: result.success ? result.content : `Processing failed: ${result.error || 'unknown'}`,
      };
    },
  },
};

// ===== All Templates Registry =====
const ALL_TEMPLATES = {
  calculate: CALCULATE_TEMPLATES,
  lookup: LOOKUP_TEMPLATES,
  create: CREATE_TEMPLATES,
  communicate: COMMUNICATE_TEMPLATES,
  validate: VALIDATE_TEMPLATES,
  connect: CONNECT_TEMPLATES,
  research: RESEARCH_TEMPLATES,
  process: PROCESS_TEMPLATES,
};

// ===== Get template for a tool =====
function getTemplate(tool) {
  const typeTemplates = ALL_TEMPLATES[tool.type];
  if (!typeTemplates) return null;
  return typeTemplates[tool.config?.templateId] || Object.values(typeTemplates)[0];
}

// ===== Convert tool → Claude API schema =====
function sanitizeName(id) {
  return id.replace(/[^a-zA-Z0-9_-]/g, '_');
}

export function toolToClaudeSchema(tool) {
  const template = getTemplate(tool);
  const params = tool.config?.parameters || template?.parameters || [];
  const properties = {};
  const required = [];
  for (const p of params) {
    properties[p.name] = { type: p.type === 'number' ? 'number' : 'string', description: p.description || p.label };
    if (p.required !== false) required.push(p.name);
  }
  return {
    name: sanitizeName(tool.id),
    description: `${tool.name}: ${tool.description}`,
    input_schema: { type: 'object', properties, required },
  };
}

export function toolFromClaudeName(name, tools) {
  return tools.find(t => sanitizeName(t.id) === name) || null;
}

// ===== Main executor =====
export async function executeTool(tool, input, fileTree, callClaudeAPI, callbacks = {}) {
  if (!tool) return { success: false, output: 'Tool not found.' };

  const template = getTemplate(tool);
  if (!template) return { success: false, output: `No template found for tool type: ${tool.type}` };

  // Dual input: object from Claude tool_use, or string from legacy
  const params = typeof input === 'object' && input !== null && !Array.isArray(input) ? input : parseStringInput(tool, input, template);

  try {
    switch (tool.type) {
      case 'calculate': {
        // Validate numbers
        for (const p of (template.parameters || [])) {
          if (p.type === 'number' && params[p.name] !== undefined) params[p.name] = Number(params[p.name]);
        }
        const result = template.execute(params);
        return { success: true, output: `## ${template.name} Result\n\n**${result.result}**\n\n${result.details}` };
      }
      case 'lookup':
        return template.execute(params, fileTree);
      case 'create':
        return template.execute(params, callbacks.onCreateFile);
      case 'communicate':
        return await template.execute(params, callbacks.onMessage, callbacks.onSendDm, callbacks.onAskHuman);
      case 'validate':
        return template.execute(params, tool.config);
      case 'connect':
        return await template.execute(params, tool.config);
      case 'research':
        return await template.execute(params, callClaudeAPI);
      case 'process':
        return await template.execute(params, fileTree, callClaudeAPI);
      default:
        return { success: false, output: `Unknown tool type: ${tool.type}` };
    }
  } catch (error) {
    return { success: false, output: `Tool error: ${error.message}` };
  }
}

// Parse string input into params by trying to match parameter labels
function parseStringInput(tool, input, template) {
  const params = {};
  const text = typeof input === 'string' ? input : '';
  for (const p of (template?.parameters || [])) {
    const regex = new RegExp(`${p.label}[:\\s]*(\\S+)`, 'i');
    const match = text.match(regex);
    if (match) params[p.name] = p.type === 'number' ? parseFloat(match[1].replace(/,/g, '')) : match[1];
  }
  // If nothing matched, put the whole input as the first string param
  if (Object.keys(params).length === 0 && template?.parameters?.length > 0) {
    const firstStr = template.parameters.find(p => p.type === 'string');
    if (firstStr) params[firstStr.name] = text;
  }
  return params;
}

export { ALL_TEMPLATES, CALCULATE_TEMPLATES };
