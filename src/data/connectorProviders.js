// Provider definitions for external connectors.
// Each provider defines how to authenticate and what API action to perform.

const CORS_PROXY = 'https://corsproxy.io/?';

export const CONNECTOR_PROVIDERS = [
  {
    id: 'notion',
    name: 'Notion',
    icon: '\uD83D\uDCD3',
    color: '#000000',
    description: 'Search pages and databases in your Notion workspace',
    tokenLabel: 'Integration Token',
    tokenHelp: 'Create at notion.so/my-integrations',
    tokenPrefix: 'Bearer',
    tool: {
      name: 'Notion - Search',
      description: 'Search for pages and databases in Notion',
      url: CORS_PROXY + 'https://api.notion.com/v1/search',
      method: 'POST',
      extraHeaders: { 'Notion-Version': '2022-06-28', 'Content-Type': 'application/json' },
      parameters: [
        { name: 'query', label: 'Search Query', type: 'string', required: true, description: 'Text to search for in Notion' },
      ],
      bodyTemplate: '{"query":"{query}","page_size":5}',
    },
  },
  {
    id: 'linear',
    name: 'Linear',
    icon: '\uD83D\uDCD0',
    color: '#5E6AD2',
    description: 'List and manage issues in Linear',
    tokenLabel: 'API Key',
    tokenHelp: 'Get from Linear > Settings > API',
    tokenPrefix: 'Bearer',
    tool: {
      name: 'Linear - Issues',
      description: 'List recent issues from Linear with status and assignee',
      url: CORS_PROXY + 'https://api.linear.app/graphql',
      method: 'POST',
      extraHeaders: { 'Content-Type': 'application/json' },
      parameters: [],
      bodyTemplate: '{"query":"{ issues(first: 10, orderBy: updatedAt) { nodes { id title state { name } priority assignee { name } } } }"}',
    },
  },
];
