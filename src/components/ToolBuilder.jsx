import { useState } from 'react';
import { executeTool } from '../utils/toolExecutor';
import { CONNECTOR_PROVIDERS } from '../data/connectorProviders';
import EducationalCue from './EducationalCue';
import { useConfirm } from './ConfirmDialog';

let toolCounter = Date.now();
function genToolId() { return 'tool-' + (toolCounter++); }

// ===== Provider Picker Modal =====
function ProviderPicker({ onSelectProvider, onSelectCustom, onClose }) {
  const [selectedProvider, setSelectedProvider] = useState(null);
  const [token, setToken] = useState('');
  const [connecting, setConnecting] = useState(false);

  if (selectedProvider) {
    const provider = CONNECTOR_PROVIDERS.find(p => p.id === selectedProvider);
    return (
      <div className="modal-overlay" onClick={onClose}>
        <div className="modal-box" style={{ maxWidth: 480 }} onClick={e => e.stopPropagation()}>
          <h3 style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 24 }}>{provider.icon}</span>
            Connect to {provider.name}
          </h3>
          <p style={{ fontSize: 13, color: 'var(--text-body)', margin: '8px 0 16px' }}>{provider.description}</p>

          <div className="cw-field">
            <label>{provider.tokenLabel}</label>
            <input
              type="password"
              value={token}
              onChange={e => setToken(e.target.value)}
              placeholder={`Paste your ${provider.tokenLabel.toLowerCase()}...`}
              autoFocus
              onKeyDown={e => { if (e.key === 'Enter' && token.trim()) onSelectProvider(provider.id, token.trim()); }}
            />
            <span style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4, display: 'block' }}>{provider.tokenHelp}</span>
          </div>

          <div className="modal-actions" style={{ marginTop: 20 }}>
            <button className="modal-btn cancel" onClick={() => setSelectedProvider(null)}>Back</button>
            <button
              className="modal-btn primary"
              disabled={!token.trim() || connecting}
              onClick={() => { setConnecting(true); onSelectProvider(provider.id, token.trim()); }}
            >
              {connecting ? 'Connecting...' : 'Connect'}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-box" style={{ maxWidth: 520 }} onClick={e => e.stopPropagation()}>
        <h3>Add a Connector</h3>
        <p style={{ fontSize: 14, color: 'var(--text-body)', marginBottom: 16 }}>
          Connect to an external platform or API.
        </p>

        <div className="tl-provider-grid">
          {CONNECTOR_PROVIDERS.map(provider => (
            <button key={provider.id} className="tl-provider-card" onClick={() => setSelectedProvider(provider.id)}>
              <span className="tl-provider-icon">{provider.icon}</span>
              <span className="tl-provider-name">{provider.name}</span>
              <span className="tl-provider-desc">{provider.description}</span>
            </button>
          ))}
          <button className="tl-provider-card" onClick={onSelectCustom}>
            <span className="tl-provider-icon">{'\uD83D\uDD17'}</span>
            <span className="tl-provider-name">Custom API</span>
            <span className="tl-provider-desc">Connect to any HTTP endpoint</span>
          </button>
        </div>

        <div className="modal-actions" style={{ marginTop: 16 }}>
          <button className="modal-btn cancel" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

// ===== Tool Card =====
function ToolCard({ tool, onSelect, onDelete }) {
  const provider = tool.config?.provider ? CONNECTOR_PROVIDERS.find(p => p.id === tool.config.provider) : null;
  return (
    <div className="tl-card" onClick={() => onSelect(tool.id)}>
      <div className="tl-card-icon">{tool.icon || '\uD83D\uDD17'}</div>
      <div className="tl-card-name">{tool.name}</div>
      <div className="tl-card-badges">
        {provider ? (
          <span className="tl-card-provider" style={{ color: provider.color, background: provider.color + '18' }}>{provider.name}</span>
        ) : (
          <span className="tl-card-type" style={{ color: '#b5784a', background: '#b5784a18' }}>Connect</span>
        )}
      </div>
      <div className="tl-card-desc">{tool.description}</div>
      {tool.config?.url && <div className="tl-card-url">{tool.config.url.replace(/^https:\/\/corsproxy\.io\/\?/, '')}</div>}
      {onDelete && (
        <button className="tl-card-delete" onClick={e => { e.stopPropagation(); onDelete(tool.id); }} title="Delete">{'\u2715'}</button>
      )}
    </div>
  );
}

// ===== Tool Editor =====
function ToolEditor({ tool, onUpdate, onBack, onDelete, fileTree, callClaudeAPI, showEducationalCues }) {
  const confirm = useConfirm();
  const [testInput, setTestInput] = useState('');
  const [testOutput, setTestOutput] = useState(null);
  const [testing, setTesting] = useState(false);

  const provider = tool.config?.provider ? CONNECTOR_PROVIDERS.find(p => p.id === tool.config.provider) : null;

  function handleTokenChange(newToken) {
    const prefix = provider?.tokenPrefix || 'Bearer';
    onUpdate({
      ...tool,
      config: {
        ...tool.config,
        headers: { ...tool.config.headers, Authorization: `${prefix} ${newToken}` },
      },
    });
  }

  // Extract current token from headers (strip prefix)
  const currentToken = (() => {
    const auth = tool.config?.headers?.Authorization || '';
    const prefix = (provider?.tokenPrefix || 'Bearer') + ' ';
    return auth.startsWith(prefix) ? auth.slice(prefix.length) : auth;
  })();

  async function handleTest() {
    setTesting(true);
    setTestOutput(null);
    const result = await executeTool(tool, testInput || 'Test input', fileTree, callClaudeAPI);
    setTestOutput(result);
    setTesting(false);
  }

  return (
    <div className="tl-editor">
      <div className="tl-editor-header">
        <button className="files-back-btn" onClick={onBack}>{'\u2190'} All Connectors</button>
        <span className="tl-editor-title">
          <span className="tl-editor-icon">{tool.icon || '\uD83D\uDD17'}</span>
          {tool.name || 'Connector'}
          {provider && <span className="tl-builtin-badge" style={{ background: provider.color + '18', color: provider.color }}>{provider.name}</span>}
        </span>
        {onDelete && (
          <button className="tl-duplicate-btn" style={{ color: 'var(--accent-error)' }} onClick={async () => { if (await confirm({ message: 'Delete this connector?', danger: true })) onDelete(tool.id); }}>Delete</button>
        )}
      </div>

      <div className="tl-editor-body">
        <div className="tl-editor-form">
          {/* Identity */}
          <div className="cw-editor-section">
            <h3>Connector</h3>
            <div className="cw-field">
              <label>Name</label>
              <input type="text" value={tool.name} onChange={e => onUpdate({ ...tool, name: e.target.value })} placeholder="Connector name" />
            </div>
            <div className="cw-field">
              <label>Description</label>
              <input type="text" value={tool.description} onChange={e => onUpdate({ ...tool, description: e.target.value })} placeholder="What does this connector do?" />
            </div>
          </div>

          {/* Auth — for provider connectors */}
          {provider && (
            <div className="cw-editor-section">
              <h3>Authentication</h3>
              <div className="cw-field">
                <label>{provider.tokenLabel}</label>
                <input type="password" value={currentToken} onChange={e => handleTokenChange(e.target.value)} placeholder={`Paste your ${provider.tokenLabel.toLowerCase()}...`} />
                <span style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4, display: 'block' }}>{provider.tokenHelp}</span>
              </div>
            </div>
          )}

          {/* API config */}
          <div className="cw-editor-section">
            <h3>API Configuration</h3>
            <EducationalCue cueId="tools-connect" show={showEducationalCues} />
            {provider ? (
              <div className="cw-field">
                <label>Endpoint</label>
                <div className="tl-readonly-url">{tool.config?.method || 'GET'} {tool.config?.url?.replace(/^https:\/\/corsproxy\.io\/\?/, '') || ''}</div>
              </div>
            ) : (
              <>
                <div className="cw-field">
                  <label>URL</label>
                  <input type="text" value={tool.config?.url || ''} onChange={e => onUpdate({ ...tool, config: { ...tool.config, url: e.target.value } })} placeholder="https://api.example.com/data" />
                </div>
                <div className="cw-field">
                  <label>Method</label>
                  <select value={tool.config?.method || 'GET'} onChange={e => onUpdate({ ...tool, config: { ...tool.config, method: e.target.value } })}>
                    <option value="GET">GET</option>
                    <option value="POST">POST</option>
                  </select>
                </div>
              </>
            )}
          </div>

          {/* Test */}
          <div className="cw-editor-section">
            <h3>Test Connector</h3>
            <EducationalCue cueId="tool-testing" show={showEducationalCues} />
            <div className="cw-field">
              <label>Test Input</label>
              <textarea value={testInput} onChange={e => setTestInput(e.target.value)} placeholder={provider ? 'Enter a search query to test...' : 'Enter test input...'} rows={3} style={{ width: '100%', padding: '10px 12px', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-sm)', fontSize: 14, outline: 'none', resize: 'vertical', fontFamily: 'inherit' }} />
            </div>
            <button className="run-btn" onClick={handleTest} disabled={testing} style={{ marginBottom: 12 }}>
              {testing ? 'Running...' : '\u25B6 Test Connector'}
            </button>
            {testOutput && (
              <div className={`tl-test-output${testOutput.success === false ? ' error' : ''}`}>
                <pre>{testOutput.output}</pre>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ===== Main ToolBuilder =====
export default function ToolBuilder({ tools, onUpdateTools, fileTree, callClaudeAPI, showEducationalCues }) {
  const confirm = useConfirm();
  const [selectedToolId, setSelectedToolId] = useState(null);
  const [showPicker, setShowPicker] = useState(false);
  const selectedTool = selectedToolId ? tools.find(t => t.id === selectedToolId) : null;

  const externalTools = tools.filter(t => !t.isPrebuilt && t.type === 'connect');

  function handleAddProvider(providerId, token) {
    const provider = CONNECTOR_PROVIDERS.find(p => p.id === providerId);
    if (!provider) return;
    const newTool = {
      id: genToolId(),
      name: provider.tool.name,
      type: 'connect',
      description: provider.tool.description,
      icon: provider.icon,
      createdBy: 'User',
      config: {
        templateId: 'api_caller',
        parameters: provider.tool.parameters || [],
        url: provider.tool.url,
        method: provider.tool.method,
        headers: {
          Authorization: `${provider.tokenPrefix} ${token}`,
          ...provider.tool.extraHeaders,
        },
        bodyTemplate: provider.tool.bodyTemplate || null,
        provider: provider.id,
      },
      createdAt: Date.now(),
    };
    onUpdateTools([...tools, newTool]);
    setSelectedToolId(newTool.id);
    setShowPicker(false);
  }

  function handleAddCustom() {
    const newTool = {
      id: genToolId(),
      name: 'New Connector',
      type: 'connect',
      description: '',
      icon: '\uD83D\uDD17',
      createdBy: 'User',
      config: { templateId: 'api_caller', parameters: [], url: '', method: 'GET' },
      createdAt: Date.now(),
    };
    onUpdateTools([...tools, newTool]);
    setSelectedToolId(newTool.id);
    setShowPicker(false);
  }

  function handleUpdateTool(updatedTool) {
    onUpdateTools(tools.map(t => t.id === updatedTool.id ? updatedTool : t));
  }

  async function handleDeleteTool(toolId) {
    const tool = tools.find(t => t.id === toolId);
    if (tool?.isPrebuilt) return;
    const ok = await confirm({ message: 'Delete this connector?', danger: true });
    if (!ok) return;
    onUpdateTools(tools.filter(t => t.id !== toolId));
    if (selectedToolId === toolId) setSelectedToolId(null);
  }

  if (selectedTool) {
    return (
      <div className="panel panel-center">
        <ToolEditor tool={selectedTool} onUpdate={handleUpdateTool} onBack={() => setSelectedToolId(null)} onDelete={() => handleDeleteTool(selectedTool.id)} fileTree={fileTree} callClaudeAPI={callClaudeAPI} showEducationalCues={showEducationalCues} />
      </div>
    );
  }

  return (
    <div className="panel panel-center">
      <div className="cw-list">
        <div className="cw-list-header">
          <div>
            <h2 className="cw-list-title">Connectors</h2>
            <p className="cw-list-subtitle">Connect your coworkers to external APIs and services.</p>
            <EducationalCue cueId="tools-overview" show={showEducationalCues} />
          </div>
          <button className="cw-hire-btn" onClick={() => setShowPicker(true)}>+ Add Connector</button>
        </div>

        <div className="cw-list-grid">
          {externalTools.length === 0 && (
            <div className="tl-external-empty" onClick={() => setShowPicker(true)}>
              <span className="tl-external-empty-icon">{'\uD83D\uDD17'}</span>
              <span className="tl-external-empty-text">Connect to Notion, Linear, or any external API</span>
            </div>
          )}
          {externalTools.map(tool => (
            <ToolCard key={tool.id} tool={tool} onSelect={setSelectedToolId} onDelete={handleDeleteTool} />
          ))}
        </div>
      </div>

      {showPicker && (
        <ProviderPicker
          onSelectProvider={handleAddProvider}
          onSelectCustom={handleAddCustom}
          onClose={() => setShowPicker(false)}
        />
      )}
    </div>
  );
}
