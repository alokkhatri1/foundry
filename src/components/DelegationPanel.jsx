import { useState, useEffect, useRef } from 'react';

// Parse Claude's JSON response tolerantly — strips markdown fences.
function tryParseJSON(text) {
  if (!text) return null;
  let cleaned = text.trim();
  // Strip markdown code fences if present
  cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  // Find the first { and last }
  const first = cleaned.indexOf('{');
  const last = cleaned.lastIndexOf('}');
  if (first !== -1 && last !== -1 && last > first) {
    cleaned = cleaned.slice(first, last + 1);
  }
  try {
    return JSON.parse(cleaned);
  } catch {
    return null;
  }
}

function buildDecomposerPrompt({ strategy, participants, coworkers, authorRole, authorName }) {
  const humansList = (participants || [])
    .map(p => `- ${p.name}${p.role ? ` (${p.role})` : ''}`)
    .join('\n') || '- (no other humans captured yet)';
  const aiList = (coworkers || [])
    .map(cw => `- ${cw.name}${cw.role ? ` — ${String(cw.role).slice(0, 100)}` : ''}`)
    .join('\n') || '- (no AI coworkers built yet)';

  return `You are a delegation designer helping a workshop participant see how their organization's work would redistribute across humans and AI.

Context:
- The participant asking: ${authorName}${authorRole ? ` (${authorRole})` : ''}
- Humans in the room (available for assignment):
${humansList}
- AI coworkers already built in this workshop (available for assignment):
${aiList}

Produce a delegation map: 10-15 tasks that together accomplish the strategic intent. For each task:
- title: short task name (3-7 words)
- description: one sentence explaining the task
- before: who currently does this in a human-only org. Pick a human from the list above (by name) or a generic role (e.g., "Support Agent").
- after: how this task could be done once AI coworkers are in the mix.
  - assignee: a human name OR an AI coworker name from the lists above
  - type: "human" or "ai"
  - loop: one of "agent-in-loop" (AI acts, human reviews), "agent-over-loop" (AI acts autonomously, human monitors), "human-in-loop" (human acts, AI assists), "human-over-loop" (human only, AI observes)
  - oversight: the human name who retains override authority (required for any AI "agent-in-loop" or "agent-over-loop"; null for human tasks)

Rules:
- Balance realism: some tasks stay human, others shift to AI. Don't delegate everything to AI.
- When shifting to AI, name a specific oversight human — decision rights matter.
- Reference specific names from the lists when you can.
- Output pure JSON. No explanation, no markdown fences.

JSON shape:
{
  "summary": "1-2 sentence framing of the delegation — what shifts, what stays",
  "tasks": [
    {
      "id": "t1",
      "title": "Review new application",
      "description": "Read the application and confirm completeness.",
      "before": { "assignee": "Credit Manager" },
      "after": { "assignee": "Credit Analyst Coworker", "type": "ai", "loop": "agent-in-loop", "oversight": "Credit Manager" }
    }
  ]
}

Strategic intent to decompose: "${strategy}"`;
}

function AssigneePill({ name, type, color }) {
  const isAi = type === 'ai';
  return (
    <span className={`del-assignee${isAi ? ' ai' : ''}`} style={!isAi && color ? { background: color, color: '#fff' } : undefined}>
      {isAi ? 'AI ' : ''}{name}
    </span>
  );
}

function LoopBadge({ loop }) {
  if (!loop) return null;
  const labels = {
    'agent-in-loop': 'agent in-loop',
    'agent-over-loop': 'agent over-loop',
    'human-in-loop': 'human in-loop',
    'human-over-loop': 'human over-loop',
  };
  return <span className={`del-loop ${loop}`}>{labels[loop] || loop}</span>;
}

function DelegationMapCard({ map, onSave, saving, saved }) {
  if (!map || !Array.isArray(map.tasks)) return null;
  return (
    <div className="del-map-card">
      {map.summary && <p className="del-map-summary">{map.summary}</p>}
      <div className="del-map-header">
        <span>Task</span>
        <span>Current state</span>
        <span>Future state</span>
      </div>
      {map.tasks.map((t, i) => (
        <div key={t.id || i} className="del-task-row">
          <div className="del-task-title">
            <strong>{t.title}</strong>
            {t.description && <div className="del-task-desc">{t.description}</div>}
          </div>
          <div className="del-task-col del-before">
            {t.before && <AssigneePill name={t.before.assignee || '—'} type="human" />}
          </div>
          <div className="del-task-col del-after">
            {t.after && (
              <>
                <AssigneePill name={t.after.assignee || '—'} type={t.after.type || 'human'} />
                <LoopBadge loop={t.after.loop} />
                {t.after.oversight && (
                  <div className="del-oversight">oversight: {t.after.oversight}</div>
                )}
              </>
            )}
          </div>
        </div>
      ))}
      {onSave && (
        <div className="del-map-footer">
          <button className="landing-join-btn" style={{ width: 'auto', padding: '8px 20px' }} onClick={onSave} disabled={saving || saved}>
            {saved ? 'Saved' : saving ? 'Saving...' : 'Save this delegation'}
          </button>
        </div>
      )}
    </div>
  );
}

export default function DelegationPanel({ sb, callClaudeAPI, userName, userRole, coworkers }) {
  const [input, setInput] = useState('');
  const [thread, setThread] = useState([]);
  const [isThinking, setIsThinking] = useState(false);
  const [participants, setParticipants] = useState([]);
  const [savingId, setSavingId] = useState(null);
  const [savedIds, setSavedIds] = useState(new Set());
  const scrollRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    sb.loadParticipantsWithRoles().then(list => {
      if (!cancelled) setParticipants(list);
    });
    return () => { cancelled = true; };
  }, [sb]);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [thread]);

  async function handleSend() {
    const strategy = input.trim();
    if (!strategy || isThinking) return;
    const userMsg = { id: 'u-' + Date.now(), role: 'user', text: strategy };
    setThread(prev => [...prev, userMsg]);
    setInput('');
    setIsThinking(true);

    const systemPrompt = buildDecomposerPrompt({
      strategy,
      participants,
      coworkers,
      authorRole: userRole,
      authorName: userName,
    });
    const result = await callClaudeAPI(systemPrompt, 'Produce the delegation map now.');

    setIsThinking(false);
    if (!result.success) {
      setThread(prev => [...prev, { id: 'e-' + Date.now(), role: 'error', text: result.error || 'Failed to generate a delegation.' }]);
      return;
    }
    const map = tryParseJSON(result.content);
    if (!map || !Array.isArray(map.tasks)) {
      setThread(prev => [...prev, {
        id: 'e-' + Date.now(),
        role: 'error',
        text: 'Could not parse the AI response as a delegation. Try rephrasing your strategy.',
        raw: result.content,
      }]);
      return;
    }
    setThread(prev => [...prev, { id: 'm-' + Date.now(), role: 'map', strategy, map }]);
  }

  async function handleSaveMap(messageId, strategy, map) {
    setSavingId(messageId);
    const authUser = await sb.getUser();
    await sb.saveDelegationMap(authUser?.id, userName, strategy, map);
    setSavingId(null);
    setSavedIds(prev => new Set([...prev, messageId]));
  }

  return (
    <div className="del-panel">
      <div className="del-intro">
        <h2 className="del-title">Strategic Delegation</h2>
        <p className="del-sub">
          Describe a strategic intent or project. I'll decompose it into tasks and show how the work could redistribute across the humans in the room and the AI coworkers you've built — a current state vs. future state view.
        </p>
      </div>

      <div className="del-thread" ref={scrollRef}>
        {thread.length === 0 && (
          <div className="del-empty">
            Try something like: <em>"Reduce customer support response time by 30%"</em> or <em>"Launch a new credit product for small businesses."</em>
          </div>
        )}
        {thread.map(msg => {
          if (msg.role === 'user') {
            return (
              <div key={msg.id} className="del-msg del-msg-user">
                <div className="del-msg-label">{userName || 'You'}</div>
                <div className="del-msg-body">{msg.text}</div>
              </div>
            );
          }
          if (msg.role === 'error') {
            return (
              <div key={msg.id} className="del-msg del-msg-error">
                <div className="del-msg-body">{msg.text}</div>
              </div>
            );
          }
          if (msg.role === 'map') {
            const saved = savedIds.has(msg.id);
            const saving = savingId === msg.id;
            return (
              <div key={msg.id} className="del-msg del-msg-map">
                <div className="del-msg-label">Delegation map for: <em>{msg.strategy}</em></div>
                <DelegationMapCard
                  map={msg.map}
                  onSave={() => handleSaveMap(msg.id, msg.strategy, msg.map)}
                  saving={saving}
                  saved={saved}
                />
              </div>
            );
          }
          return null;
        })}
        {isThinking && (
          <div className="del-msg del-msg-thinking">
            Generating delegation map...
          </div>
        )}
      </div>

      <div className="del-input-row">
        <textarea
          className="del-input"
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
          placeholder="Describe a strategy or project..."
          rows={2}
          disabled={isThinking}
        />
        <button
          className="del-send-btn"
          onClick={handleSend}
          disabled={!input.trim() || isThinking}
        >
          {isThinking ? '...' : 'Generate'}
        </button>
      </div>
    </div>
  );
}
