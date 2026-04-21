import { useState, useRef, useEffect, useMemo } from 'react';
import './App.css';
import AuthGate from './components/AuthGate';
import GraduationScreen from './components/GraduationScreen';
import FileExplorer from './components/FileExplorer';
import FileEditor from './components/FileEditor';
import WorkflowBuilder from './components/WorkflowBuilder';
import CoworkerBuilder from './components/CoworkerBuilder';
import ChatPanel from './components/ChatPanel';
import ActivityDashboard from './components/ActivityDashboard';
import UsageView, { useMyUsageTotal, useWorkshopUsageTotal } from './components/UsageView';
import { formatUsd, formatTokens } from './utils/llmCost';
import RevealAt, { STAGE_META, stageReached, normalizeStage } from './components/RevealAt';
import { computeCost, costToCredits, DEFAULT_CREDIT_ALLOCATION, CREDITS_WARN_THRESHOLD } from './utils/llmCost';
import { buildStageGuidance } from './data/stageGuidance';
import PreferencesEditor from './components/PreferencesEditor';
import {
  createStarterFolders,
  createStarterWorkflow,
  createStarterCoworkers,
  createStarterTools,
  createStarterRun,
  createStarterLogs,
  DEFAULT_TEST_CASE,
  ensurePrebuiltTools,
  BUILTIN_TOOLS,
} from './data/starterContent';
import { executeWorkflowRun } from './utils/runWorkflowAsync';
import { executeTool, toolToClaudeSchema, toolFromClaudeName } from './utils/toolExecutor';
import { PLATFORM_TOOL_SCHEMAS, TOOL_DISPLAY_NAMES, TOOL_ICONS, executePlatformAction } from './utils/platformActions';
import useSupabase from './hooks/useSupabase';
import { buildTree, flattenTree, mapFileRow, mapCoworkerRow, mapToolRow, mapWorkflowRow, preserveToolConfigs, ensureDagShape } from './utils/treeUtils';

const STORAGE_KEY = 'sandbox:state';

function migrateState(saved) {
  if (!saved) return saved;
  // Migrate agents -> coworkers with skills
  if (saved.agents && !saved.coworkers) {
    const idMap = {};
    saved.coworkers = saved.agents.map(agent => {
      const newId = agent.id.replace(/^agent-/, 'cw-');
      const skillId = 'skill-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6);
      idMap[agent.id] = { coworkerId: newId, skillId };
      return {
        id: newId,
        name: agent.name,
        role: agent.role,
        avatar: agent.avatar,
        color: agent.color,
        skills: [{
          id: skillId,
          name: agent.name,
          instructionFileId: agent.instructionFileId,
          knowledgeFileIds: agent.knowledgeFileIds || [],
          toolIds: agent.toolIds || [],
        }],
        createdBy: agent.createdBy,
        createdAt: agent.createdAt,
      };
    });
    delete saved.agents;
    // Migrate workflow step references
    if (saved.workflows) {
      saved.workflows = saved.workflows.map(wf => ({
        ...wf,
        steps: wf.steps.map(step => {
          if (step.agentId && !step.coworkerId) {
            const mapped = idMap[step.agentId];
            const { agentId, ...rest } = step;
            return { ...rest, coworkerId: mapped?.coworkerId || '', skillId: mapped?.skillId || '' };
          }
          return step;
        }),
      }));
    }
    // Migrate run step results
    if (saved.workflowRuns) {
      saved.workflowRuns = saved.workflowRuns.map(run => ({
        ...run,
        stepResults: (run.stepResults || []).map(sr => {
          if (sr.agentName && !sr.coworkerName) {
            const { agentName, agentAvatar, ...rest } = sr;
            return { ...rest, coworkerName: agentName, coworkerAvatar: agentAvatar };
          }
          return sr;
        }),
      }));
    }
  }

  // Migrate old tool IDs to prebuilt IDs and ensure all prebuilt tools exist
  if (saved.tools) {
    saved.tools = ensurePrebuiltTools(saved.tools);
  }

  // Migrate skills-based coworkers to flat model
  if (saved.coworkers) {
    saved.coworkers = saved.coworkers.map(cw => {
      if (cw.skills && !cw.instructionFileIds) {
        const instructionFileIds = [];
        const knowledgeFileIds = new Set();
        for (const skill of cw.skills) {
          if (skill.instructionFileId) instructionFileIds.push(skill.instructionFileId);
          for (const kid of (skill.knowledgeFileIds || [])) knowledgeFileIds.add(kid);
        }
        const { skills, ...rest } = cw;
        return { ...rest, instructionFileIds, knowledgeFileIds: [...knowledgeFileIds], toolIds: [] };
      }
      return cw;
    });
  }

  return saved;
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return migrateState(JSON.parse(raw));
  } catch {}
  return null;
}

function saveState(state) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {}
}

function findNode(tree, id) {
  if (!tree) return null;
  if (tree.id === id) return tree;
  if (tree.children) {
    for (const child of tree.children) {
      const found = findNode(child, id);
      if (found) return found;
    }
  }
  return null;
}

function updateFileContent(tree, fileId, content) {
  const cloned = JSON.parse(JSON.stringify(tree));
  const node = findNode(cloned, fileId);
  if (node && node.type === 'file') {
    node.content = content;
  }
  return cloned;
}

function getKnowledgeForDepartment(tree, deptId) {
  const dept = findNode(tree, deptId);
  if (!dept) return [];
  const knowledgeFolder = dept.children?.find(c => c.name === 'knowledge');
  if (!knowledgeFolder) return [];
  return knowledgeFolder.children?.filter(c => c.type === 'file') || [];
}





let msgId = Date.now();
function genMsgId() { return 'm-' + (msgId++); }

// Header chip showing live running spend. Subscribes to llm_usage inserts
// for this participant and re-renders the dollar total. Mounted only
// post-7b so we don't pay for a realtime channel before the reveal.
function SpendChip({ sb, myParticipantId, onClick }) {
  const { total, tokenTotal } = useMyUsageTotal(sb, myParticipantId);
  return (
    <span
      className="header-spend-chip"
      onClick={onClick}
      title="Your LLM spend so far. Click to see the breakdown."
    >
      <span className="header-spend-chip-amount">{formatUsd(total)}</span>
      <span className="header-spend-chip-tokens">{formatTokens(tokenTotal)} tok</span>
    </span>
  );
}

// Single settings button on the far-right of the header. Opens a dropdown
// that carries everything that used to crowd the header: user name,
// Current Level, live spend total (when Stage 7b is revealed),
// Preferences (Stage 2+), and Exit Workshop. Frees the header to show
// every stage tab without wrapping.
function SettingsMenu({ userName, currentStage, sb, myParticipantId, creditsLeft, creditsTotal, onOpenUsage, onOpenPreferences, onExit }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const showSpend = stageReached(currentStage, '7b');
  // Workshop-wide total — matches the pedagogy of the Usage tab
  // ("look how cheap the whole room is"). We always run the hook (can't
  // call hooks conditionally) but only render its result after 7b.
  const spend = useWorkshopUsageTotal(sb);
  const showPreferences = stageReached(currentStage, '2');
  const initial = (userName || '?').trim().charAt(0).toUpperCase();
  const stageLabel = currentStage ? STAGE_META[currentStage]?.label : null;
  const creditsLow = creditsLeft != null && creditsLeft <= CREDITS_WARN_THRESHOLD;

  useEffect(() => {
    if (!open) return;
    function onDocClick(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [open]);

  return (
    <div className="header-settings" ref={ref}>
      <button
        className={`header-settings-btn${open ? ' open' : ''}`}
        onClick={() => setOpen(o => !o)}
        title="Settings"
      >
        <span className="header-settings-avatar">{initial}</span>
        <span className="header-settings-caret">{open ? '\u25B4' : '\u25BE'}</span>
      </button>
      {open && (
        <div className="header-settings-menu" role="menu">
          <div className="header-settings-identity">
            <div className="header-settings-name">{userName || 'You'}</div>
            {stageLabel && (
              <div className="header-settings-meta">
                <span className="header-settings-meta-label">Current Level</span>
                <span className="header-settings-meta-value">{stageLabel}</span>
              </div>
            )}
            {creditsLeft != null && (
              <div
                className="header-settings-meta"
                title={`${Math.max(0, creditsLeft)} of ${creditsTotal} credits left. ~1 credit = a typical chat. ~5 credits = a workflow run.`}
              >
                <span className="header-settings-meta-label">Credits</span>
                <span
                  className={`header-settings-meta-value header-settings-credits${creditsLow ? ' header-settings-meta-low' : ''}`}
                >
                  <span className="header-settings-credits-star" aria-hidden>✦</span>
                  {Math.max(0, creditsLeft)}
                </span>
              </div>
            )}
            {showSpend && (
              <div
                className="header-settings-meta header-settings-meta-clickable"
                onClick={() => { onOpenUsage?.(); setOpen(false); }}
              >
                <span className="header-settings-meta-label">Spend</span>
                <span className="header-settings-meta-value header-settings-meta-cost">
                  {formatUsd(spend.total)}
                </span>
              </div>
            )}
          </div>
          <div className="header-settings-divider" />
          {showPreferences && (
            <button
              className="header-settings-item"
              onClick={() => { onOpenPreferences?.(); setOpen(false); }}
            >Preferences</button>
          )}
          <button
            className="header-settings-item danger"
            onClick={() => { onExit?.(); setOpen(false); }}
          >Exit Workshop</button>
        </div>
      )}
    </div>
  );
}

// Compact credits pill — mounted in the header post-7b. Before that, the
// credits live only in the settings menu. The pill clicks through to the
// Economics tab so participants can see where the balance went.
function CreditsChip({ creditsLeft, creditsTotal, onClick }) {
  if (creditsLeft == null) return null;
  const low = creditsLeft <= CREDITS_WARN_THRESHOLD;
  const value = Math.max(0, creditsLeft);
  return (
    <span
      className={`header-credits-chip${low ? ' low' : ''}`}
      onClick={onClick}
      title={`${value} of ${creditsTotal} credits left. ~1 credit = a typical chat. ~5 credits = a workflow run.`}
    >
      <span className="header-credits-chip-star" aria-hidden>✦</span>
      <span className="header-credits-chip-value">{value.toLocaleString()}</span>
      <span className="header-credits-chip-label">credits</span>
    </span>
  );
}

function App() {
  const saved = loadState();
  const sb = useSupabase();

  const [userName, setUserName] = useState(saved?.userName || '');
  const [workshopCode, setWorkshopCode] = useState(saved?.workshopCode || '');
  const [orgName] = useState(saved?.orgName || 'My Organization');
  const [apiKey] = useState(saved?.apiKey || import.meta.env.VITE_ANTHROPIC_API_KEY || '');
  const [flatFiles, setFlatFiles] = useState(() => {
    // Initialize from localStorage tree if available
    if (saved?.fileTree) return flattenTree(saved.fileTree, null).map(mapFileRow);
    return [];
  });
  const fileTree = useMemo(() => buildTree(flatFiles), [flatFiles]);
  const [workflows, setWorkflows] = useState(() => {
    const raw = saved?.workflows || (saved?.workflow ? [saved.workflow] : null);
    if (!raw) return raw;
    return raw.map(ensureDagShape);
  });
  const [coworkers, setCoworkers] = useState(saved?.coworkers || null);
  const [tools, setTools] = useState(saved?.tools || null);
  const [selectedFileId, setSelectedFileId] = useState(null);
  const [selectedDeptId, setSelectedDeptId] = useState(saved?.selectedDeptId || null);
  const [conversations, setConversations] = useState(() => {
    try {
      const raw = localStorage.getItem('sandbox:conversations');
      return raw ? JSON.parse(raw) : [];
    } catch { return []; }
  });
  const [activeConvoId, setActiveConvoId] = useState(() => {
    try {
      const raw = localStorage.getItem('sandbox:conversations');
      const convos = raw ? JSON.parse(raw) : [];
      return convos.length > 0 ? convos[convos.length - 1].id : null;
    } catch { return null; }
  });

  const activeConvo = conversations.find(c => c.id === activeConvoId);
  const messages = activeConvo?.messages || [];
  const [logs, setLogs] = useState([]);
  const [workflowRuns, setWorkflowRuns] = useState(saved?.workflowRuns || []);
  // Decision-log cache: { [runId]: [approvalRow, ...] }. Populated lazily
  // when a participant expands a review step in the Observability view and
  // kept fresh by the approvals realtime subscription.
  const [approvalsByRun, setApprovalsByRun] = useState({});
  const [networkError, setNetworkError] = useState(false);
  const [activeTab, setActiveTab] = useState('chat');
  const [showExitConfirm, setShowExitConfirm] = useState(false);
  const [showEducationalCues, setShowEducationalCues] = useState(() => {
    try { const v = localStorage.getItem('sandbox:show-edu-cues'); return v === null ? true : v === 'true'; } catch { return true; }
  });
  const [chatBadge, setChatBadge] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const COLORS = ['#4a7fb5', '#5a9e6f', '#c8956c', '#8b6fb0', '#c45c5c', '#4a9e9e', '#b5784a', '#6f8bb0', '#9e6f8b', '#6fb06f'];

  // Ensure current user is always in participants list on load
  const initParticipants = (() => {
    const list = saved?.participants || [];
    if (saved?.userName && !list.find(p => p.name === saved.userName)) {
      return [...list, { id: 'p-' + Date.now(), name: saved.userName, color: COLORS[list.length % COLORS.length], online: true, joinedAt: Date.now(), lastSeen: Date.now() }];
    }
    return list.map(p => p.name === saved?.userName ? { ...p, online: true, lastSeen: Date.now() } : p);
  })();

  const [participants, setParticipants] = useState(initParticipants);
  const [isJoined, setIsJoined] = useState(!!(saved?.userName && saved?.workshopCode && (saved?.fileTree || saved?.workflows)));
  const [workshopEnded, setWorkshopEnded] = useState(false);
  const [currentStage, setCurrentStage] = useState('6');
  // Credit budget: allocation is per-room (admin-configurable), bonus is
  // per-participant (admin-grantable). Used-credits is derived live from
  // the workshop's llm_usage rows in the settings menu's credits hook.
  const [creditAllocation, setCreditAllocation] = useState(DEFAULT_CREDIT_ALLOCATION);
  const [myCreditBonus, setMyCreditBonus] = useState(0);
  const [userPreferences, setUserPreferences] = useState('');
  const [showPreferences, setShowPreferences] = useState(false);
  const [userRole, setUserRole] = useState('');
  const [userRoleLoaded, setUserRoleLoaded] = useState(false);
  const [justRevealed, setJustRevealed] = useState(null);
  const previousStageRef = useRef(null);
  const [myParticipantId, setMyParticipantId] = useState(null);
  const [activeDm, setActiveDm] = useState(null);
  const [unreadDmCounts, setUnreadDmCounts] = useState({});
  const activeDmRef = useRef(activeDm);
  useEffect(() => { activeDmRef.current = activeDm; }, [activeDm]);

  // Credit budget computation — lives here, after every state dependency
  // (myParticipantId, creditAllocation, myCreditBonus) is declared. Earlier
  // placement triggered a Temporal Dead Zone crash in production builds
  // because the minifier couldn't hoist the hook call above the useState
  // declarations it referenced.
  const { total: myUsdSpend } = useMyUsageTotal(sb, myParticipantId);
  const creditsTotal = creditAllocation + myCreditBonus;
  const creditsUsed = costToCredits(myUsdSpend);
  const creditsLeft = creditsTotal - creditsUsed;
  const creditsExhausted = creditsLeft <= 0;

  // Show a celebratory modal when the admin unlocks a new stage. Skip Stage 1
  // (workshop start is not an "unlock") and skip the initial mount.
  useEffect(() => {
    const prev = previousStageRef.current;
    previousStageRef.current = currentStage;
    if (prev !== null && prev !== currentStage && currentStage !== '1') {
      setJustRevealed(currentStage);
      // Stage 8 (Graduation) — the whole-room moment. Snap every participant
      // to the graduation tab so they see their scorecard together. Later
      // navigation away is fine; this only fires on the transition.
      if (currentStage === '8') setActiveTab('graduation');
    }
  }, [currentStage]);

  const approvalResolversRef = useRef(new Map());
  // Pending recipient-picker resolvers, keyed by picker message id. When the
  // user clicks a human in the picker, the resolver fires with that name.
  const pickRecipientResolversRef = useRef(new Map());
  const activeTabRef = useRef(activeTab);

  useEffect(() => { activeTabRef.current = activeTab; }, [activeTab]);

  // One-time cleanup of stale "New Chat" conversations left behind by the
  // old workflow-run → addMessage bug (which spawned a fresh chat per
  // message). Signals something is garbage: title is still the default
  // "New Chat" (a real user message would have auto-retitled it), and the
  // chat was created more than a minute ago (so a freshly-opened empty
  // chat on this mount won't get swept). Runs once on mount.
  useEffect(() => {
    const cutoff = Date.now() - 60 * 1000;
    setConversations(prev => {
      const kept = prev.filter(c => !(c.title === 'New Chat' && (c.createdAt || 0) < cutoff));
      if (kept.length === prev.length) return prev;
      persistConversations(kept);
      if (activeConvoId && !kept.find(c => c.id === activeConvoId)) {
        setActiveConvoId(kept.length > 0 ? kept[kept.length - 1].id : null);
      }
      return kept;
    });
    // Intentionally empty deps — this is a one-shot sweep on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // On load: reconnect to Supabase, load state from granular tables, start presence + realtime
  useEffect(() => {
    if (isJoined && workshopCode) {
      sb.joinRoom(workshopCode).then(async (result) => {
        if (result?.credit_allocation != null) setCreditAllocation(result.credit_allocation);
        if (result?.error === 'deprecated') { setWorkshopEnded(true); return; }
        if (result?.error || !result?.id || !userName) return;
        const roomId = result.id;
        if (result.current_stage) setCurrentStage(normalizeStage(result.current_stage));

        const myColor = participants.find(p => p.name === userName)?.color || COLORS[0];
        const authUser = await sb.getUser();
        const me = await sb.upsertParticipant(userName, myColor, authUser?.id, authUser?.email);
        if (me?.id) {
          setMyParticipantId(me.id);
          // Fetch participant's credit bonus — admin may have granted extra.
          sb.getParticipantById(me.id).then(p => setMyCreditBonus(p?.credit_bonus || 0));
        }
        if (authUser?.id) {
          const prefs = await sb.loadUserPreferences(authUser.id);
          setUserPreferences(prefs);
          const role = await sb.loadUserRole(authUser.id);
          setUserRole(role);
          setUserRoleLoaded(true);
        }
        // Load state from granular tables
        const [files, cws, tls, wfs, runs, dbParticipants] = await Promise.all([
          sb.loadFiles(), sb.loadCoworkers(), sb.loadTools(), sb.loadWorkflows(), sb.loadWorkflowRuns(), sb.loadParticipants(),
        ]);

        if (files.length > 0) setFlatFiles(files);
        if (cws.length > 0) {
          setCoworkers(prev => {
            const prevById = new Map((prev || []).map(c => [c.id, c]));
            return cws.map(cw => preserveToolConfigs(cw, prevById.get(cw.id)));
          });
        }
        if (tls.length > 0) setTools(tls);
        if (wfs.length > 0) setWorkflows(wfs);
        // Merge cross-user runs into local state so everyone sees everyone's.
        // Local runs (started by this machine, not yet persisted) win by id.
        if (runs.length > 0) {
          setWorkflowRuns(prev => {
            const byId = new Map((prev || []).map(r => [r.id, r]));
            for (const r of runs) if (!byId.has(r.id)) byId.set(r.id, r);
            return [...byId.values()].sort((a, b) => a.startedAt - b.startedAt);
          });
        }
        if (dbParticipants.length > 0) {
          setParticipants(prev => {
            const all = new Map();
            for (const p of prev) all.set(p.name, p);
            for (const p of dbParticipants) { if (!all.has(p.name)) all.set(p.name, p); }
            return [...all.values()];
          });
        }

        // Start presence + realtime
        sb.trackPresence(userName, myColor, handlePresenceSync);
        startRealtimeSync();
      });
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Persist to localStorage (lightweight cache for offline/refresh)
  function persistLocal(updates = {}) {
    const state = {
      userName: updates.userName ?? userName,
      workshopCode: updates.workshopCode ?? workshopCode,
      orgName: updates.orgName ?? orgName,
      apiKey: updates.apiKey ?? apiKey,
      fileTree: updates.fileTree ?? fileTree,
      workflows: updates.workflows ?? workflows,
      coworkers: updates.coworkers ?? coworkers,
      tools: updates.tools ?? tools,
      workflowRuns: updates.workflowRuns ?? workflowRuns,
      participants: updates.participants ?? participants,
      selectedDeptId: updates.selectedDeptId ?? selectedDeptId,
    };
    saveState(state);
  }

  // Presence handler (reused in join and load)
  function handlePresenceSync(onlineUsers) {
    const onlineNames = new Set(onlineUsers.map(u => u.name));
    setParticipants(prev => {
      const all = new Map();
      for (const p of prev) all.set(p.name, { ...p, online: false });
      for (const u of onlineUsers) {
        if (!all.has(u.name)) {
          all.set(u.name, { id: 'p-' + Date.now() + '-' + Math.random().toString(36).slice(2, 4), name: u.name, color: u.color || COLORS[all.size % COLORS.length], online: true, joinedAt: Date.now(), lastSeen: Date.now() });
        }
      }
      for (const [, p] of all) p.online = onlineNames.has(p.name);
      return [...all.values()];
    });
  }

  // Wire up realtime subscriptions
  function startRealtimeSync() {
    sb.subscribeToRoom({
      onFileChange: (eventType, row, old) => {
        if (eventType === 'DELETE') {
          setFlatFiles(prev => prev.filter(f => f.id !== old.id));
        } else {
          const mapped = mapFileRow(row);
          setFlatFiles(prev => {
            const idx = prev.findIndex(f => f.id === mapped.id);
            return idx >= 0 ? prev.map(f => f.id === mapped.id ? mapped : f) : [...prev, mapped];
          });
        }
      },
      onCoworkerChange: (eventType, row, old) => {
        if (eventType === 'DELETE') {
          setCoworkers(prev => (prev || []).filter(c => c.id !== old.id));
        } else {
          const mapped = mapCoworkerRow(row);
          setCoworkers(prev => {
            const list = prev || [];
            const idx = list.findIndex(c => c.id === mapped.id);
            if (idx < 0) return [...list, mapped];
            const merged = preserveToolConfigs(mapped, list[idx]);
            return list.map(c => c.id === mapped.id ? merged : c);
          });
        }
      },
      onToolChange: (eventType, row, old) => {
        if (eventType === 'DELETE') {
          setTools(prev => (prev || []).filter(t => t.id !== old.id));
        } else {
          const mapped = mapToolRow(row);
          setTools(prev => {
            const list = prev || [];
            const idx = list.findIndex(t => t.id === mapped.id);
            return idx >= 0 ? list.map(t => t.id === mapped.id ? mapped : t) : [...list, mapped];
          });
        }
      },
      onWorkflowChange: (eventType, row, old) => {
        if (eventType === 'DELETE') {
          setWorkflows(prev => (prev || []).filter(w => w.id !== old.id));
        } else {
          const mapped = mapWorkflowRow(row);
          setWorkflows(prev => {
            const list = prev || [];
            const idx = list.findIndex(w => w.id === mapped.id);
            return idx >= 0 ? list.map(w => w.id === mapped.id ? mapped : w) : [...list, mapped];
          });
        }
      },
      onWorkflowRunChange: (eventType, row, old) => {
        if (eventType === 'DELETE') {
          setWorkflowRuns(prev => (prev || []).filter(r => r.id !== old.id));
        } else if (row) {
          // Map DB row back to local shape and merge. Stage 7: a run started
          // by another participant appears here via realtime — no reload needed.
          const mapped = {
            id: row.id, workflowId: row.workflow_id, workflowName: row.workflow_name,
            status: row.status, currentStepIndex: row.current_step_index,
            startedBy: row.started_by, caseInput: row.case_input,
            stepResults: row.step_results || [],
            startedAt: row.started_at ? new Date(row.started_at).getTime() : Date.now(),
            completedAt: row.completed_at ? new Date(row.completed_at).getTime() : null,
          };
          setWorkflowRuns(prev => {
            const list = prev || [];
            const idx = list.findIndex(r => r.id === mapped.id);
            if (idx < 0) return [...list, mapped];
            // Don't clobber a locally-owned run with a stale DB echo: if the
            // local copy has more-recent completedAt, keep it.
            const local = list[idx];
            if (local.completedAt && mapped.completedAt && local.completedAt > mapped.completedAt) return list;
            return list.map(r => r.id === mapped.id ? mapped : r);
          });
        }
      },
      onApprovalChange: (row) => {
        // Append to decision-log cache keyed by runId; ActivityDashboard
        // reads from here without re-querying the DB on every expand.
        setApprovalsByRun(prev => {
          const next = { ...(prev || {}) };
          const key = row.run_id;
          const existing = next[key] || [];
          if (existing.find(a => a.id === row.id)) return prev;
          next[key] = [...existing, row].sort((a, b) =>
            new Date(a.resolved_at).getTime() - new Date(b.resolved_at).getTime()
          );
          return next;
        });
      },
      onRoomChange: (row) => {
        if (row?.deprecated_at) setWorkshopEnded(true);
        if (row?.current_stage) setCurrentStage(normalizeStage(row.current_stage));
        if (row?.credit_allocation != null) setCreditAllocation(row.credit_allocation);
      },
    });
  }

  async function handleOpenDm(participant) {
    if (!participant?.name || participant.name === userName) return;
    // AI mirror participants bring their supabase id along; humans may have
    // a client-generated id so we re-resolve by name against kind='human'.
    let supabaseId = (participant.kind === 'ai' || participant.coworkerId) ? participant.id : null;
    if (!supabaseId) {
      supabaseId = await sb.findParticipantIdByName(participant.name);
    }
    if (supabaseId) {
      setActiveDm({ id: supabaseId, name: participant.name, color: participant.color });
      setUnreadDmCounts(prev => {
        if (!prev[participant.name]) return prev;
        const next = { ...prev };
        delete next[participant.name];
        return next;
      });
    }
  }

  function handleCloseDm() {
    setActiveDm(null);
  }

  // Subscribe to incoming DMs at app-level so notifications work outside the DM pane.
  useEffect(() => {
    if (!myParticipantId) return;
    const unsub = sb.subscribeToDms(myParticipantId, async (dm) => {
      if (dm.to_participant_id !== myParticipantId) return;
      if (activeDmRef.current?.id === dm.from_participant_id) return;
      const sender = await sb.getParticipantById(dm.from_participant_id);
      if (!sender?.name) return;
      setUnreadDmCounts(prev => ({
        ...prev,
        [sender.name]: (prev[sender.name] || 0) + 1,
      }));
    });
    return unsub;
  }, [myParticipantId, sb]);

  // Reflect unread count in browser tab title.
  useEffect(() => {
    const total = Object.values(unreadDmCounts).reduce((a, b) => a + b, 0);
    document.title = total > 0 ? `(${total}) Foundry` : 'Foundry';
  }, [unreadDmCounts]);

  async function handleJoin(name, code, authUserId, email) {
    const result = await sb.joinRoom(code);
    if (result?.error) return result;
    const roomId = result.id;
    if (result.current_stage) setCurrentStage(normalizeStage(result.current_stage));
    if (result.credit_allocation != null) setCreditAllocation(result.credit_allocation);

    // Load from Supabase granular tables
    let files, cws, tls, wfs, runs;
    if (roomId) {
      [files, cws, tls, wfs] = await Promise.all([
        sb.loadFiles(), sb.loadCoworkers(), sb.loadTools(), sb.loadWorkflows(),
      ]);
    }

    // No starter content — new workshops start empty. Stages reveal capabilities;
    // content is built by participants (or loaded from a scenario later).
    if (files && files.length > 0) {
      setFlatFiles(files);
      setCoworkers(prev => {
        const prevById = new Map((prev || []).map(c => [c.id, c]));
        return (cws || []).map(cw => preserveToolConfigs(cw, prevById.get(cw.id)));
      });
      setTools(tls && tls.length > 0 ? tls : ensurePrebuiltTools(null));
      setWorkflows(wfs || []);
    } else {
      setFlatFiles([]);
      setCoworkers([]);
      setTools(ensurePrebuiltTools(null));
      setWorkflows([]);
    }

    runs = saved?.workflowRuns || [];
    const starterLogs = [];
    const existingParticipants = saved?.participants || [];
    const color = COLORS[existingParticipants.length % COLORS.length];
    const alreadyIn = existingParticipants.find(p => p.name === name);
    const newParticipants = alreadyIn
      ? existingParticipants.map(p => p.name === name ? { ...p, online: true, lastSeen: Date.now() } : p)
      : [...existingParticipants, { id: 'p-' + Date.now(), name, color, online: true, joinedAt: Date.now(), lastSeen: Date.now() }];

    const me = await sb.upsertParticipant(name, color, authUserId, email);
    if (me?.id) setMyParticipantId(me.id);
    if (authUserId) {
      const prefs = await sb.loadUserPreferences(authUserId);
      setUserPreferences(prefs);
      const role = await sb.loadUserRole(authUserId);
      setUserRole(role);
      setUserRoleLoaded(true);
    }
    sb.trackPresence(name, color, handlePresenceSync);
    startRealtimeSync();

    // Safety net: load all participants from DB so peers appear even if presence lags.
    sb.loadParticipants().then(dbParticipants => {
      if (!dbParticipants || dbParticipants.length === 0) return;
      setParticipants(prev => {
        const byName = new Map();
        for (const p of (prev || [])) byName.set(p.name, p);
        for (const p of dbParticipants) {
          if (!byName.has(p.name)) byName.set(p.name, p);
        }
        return [...byName.values()];
      });
    });

    setUserName(name);
    setWorkshopCode(code);
    setWorkflowRuns(runs);
    if (starterLogs.length > 0) setLogs(starterLogs);
    setParticipants(newParticipants);
    setSelectedDeptId(saved?.selectedDeptId || 'dept-credit');
    setIsJoined(true);
    persistLocal({ userName: name, workshopCode: code, workflows, coworkers, tools, workflowRuns: runs, participants: newParticipants, selectedDeptId: saved?.selectedDeptId || 'dept-credit' });
  }

  function handleReset() {
    if (!confirm('This will clear all your local content (files, coworkers, workflows, chats). Continue?')) return;
    setFlatFiles([]);
    setWorkflows([]);
    setCoworkers([]);
    setSelectedFileId(null);
    setConversations([]);
    setActiveConvoId(null);
    setLogs([]);
    setWorkflowRuns([]);
    setTools(ensurePrebuiltTools(null));
    localStorage.removeItem('sandbox:conversations');
  }

  function handleLeave() {
    sb.leavePresence();
    sb.signOut();
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem('sandbox:conversations');
    setIsJoined(false);
    setUserName('');
    setWorkshopCode('');
    setFlatFiles([]);
    setWorkflows(null);
    setConversations([]);
    setActiveConvoId(null);
    setLogs([]);
  }

  function handleUpdateTree(newTree) {
    // Convert tree to flat files, update state, sync each file to Supabase.
    // Also diff against the previous flat state to propagate removals: any id
    // that existed before but is no longer in the new tree gets deleted from
    // Supabase. This covers explicit deletes (the X button) and implicit ones
    // (migrations that drop a folder shell), so orphaned rows don't reappear
    // on the next page load.
    const newFlat = flattenTree(newTree, sb.getRoomId()).map(mapFileRow);
    const prevIds = new Set((flatFiles || []).map(f => f.id));
    const newIds = new Set(newFlat.map(f => f.id));
    const removedIds = [...prevIds].filter(id => !newIds.has(id));
    setFlatFiles(newFlat);
    sb.saveFilesBatch(flattenTree(newTree, sb.getRoomId()));
    for (const id of removedIds) sb.deleteFile(id);
    persistLocal({ fileTree: newTree });
  }

  function handleUpdateFileContent(fileId, content) {
    // Update the flat file in state
    setFlatFiles(prev => prev.map(f => f.id === fileId ? { ...f, content } : f));
    // Save just this file to Supabase
    const file = flatFiles.find(f => f.id === fileId);
    if (file) sb.saveFile({ ...file, content });
    persistLocal({ fileTree: updateFileContent(fileTree, fileId, content) });
  }

  function handleUpdateWorkflows(newWorkflows) {
    // Always normalize to the DAG shape so nodes[]+edges[] ride alongside
    // steps[] in local state and in the DB. Diff against previous state so
    // removed workflows get hard-deleted from Supabase — otherwise a deleted
    // workflow reappears on the next reload/realtime sync because its row
    // still exists in the DB.
    const normalized = (newWorkflows || []).map(ensureDagShape);
    const prevIds = new Set((workflows || []).map(w => w.id));
    const nextIds = new Set(normalized.map(w => w.id));
    const removedIds = [...prevIds].filter(id => !nextIds.has(id));
    setWorkflows(normalized);
    for (const wf of normalized) sb.saveWorkflow(wf);
    for (const id of removedIds) sb.deleteWorkflow(id);
    persistLocal({ workflows: newWorkflows });
  }

  function handleUpdateTools(newTools) {
    const prevIds = new Set((tools || []).map(t => t.id));
    const nextIds = new Set((newTools || []).map(t => t.id));
    const removedIds = [...prevIds].filter(id => !nextIds.has(id));
    setTools(newTools);
    for (const t of newTools) sb.saveTool(t);
    for (const id of removedIds) sb.deleteTool(id);
    persistLocal({ tools: newTools });
  }

  function handleUpdateCoworkers(newCoworkers) {
    const prevIds = new Set((coworkers || []).map(c => c.id));
    const nextIds = new Set((newCoworkers || []).map(c => c.id));
    const removedIds = [...prevIds].filter(id => !nextIds.has(id));
    setCoworkers(newCoworkers);
    for (const cw of newCoworkers) sb.saveCoworker(cw);
    for (const id of removedIds) sb.deleteCoworker(id);
    persistLocal({ coworkers: newCoworkers });
  }

  // "Save to Coworkers tab" — pushes a fresh snapshot of a canvas-built
  // coworker to the shared pool. The snapshot and the canvas step are fully
  // decoupled after this: editing either one never touches the other.
  function handleSaveCoworkerToLibrary(snapshot) {
    const newCoworker = {
      id: 'cw-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
      createdAt: Date.now(),
      createdBy: userName,
      ...snapshot,
    };
    handleUpdateCoworkers([...(coworkers || []), newCoworker]);
    addMessage({ type: 'status', content: `Saved "${newCoworker.name}" to Coworkers tab` });
  }

  function addMessage(msg, targetConvoId = null) {
    const newMsg = { id: genMsgId(), timestamp: Date.now(), ...msg };
    setConversations(prev => {
      let convos = [...prev];
      // If caller pinned a convo (e.g., a workflow run that pre-created its
      // own dedicated "Run: X" chat), route there; otherwise fall back to the
      // currently open chat or create a new one as a last resort.
      let convoId = targetConvoId || activeConvoId;

      if (!convoId || !convos.find(c => c.id === convoId)) {
        const newConvo = {
          id: targetConvoId || ('convo-' + Date.now()),
          title: 'New Chat',
          createdAt: Date.now(),
          messages: [],
        };
        convos = [...convos, newConvo];
        convoId = newConvo.id;
        // Only promote the new convo to active when the caller wasn't already
        // routing somewhere specific. A workflow run pre-creates its own chat
        // and should not hijack the user's current chat view.
        if (!targetConvoId) setActiveConvoId(convoId);
      }

      convos = convos.map(c => {
        if (c.id !== convoId) return c;
        const msgs = [...c.messages, newMsg].slice(-200);
        // Auto-title from first user message
        const title = c.title === 'New Chat' && msg.type === 'user' && msg.content
          ? msg.content.slice(0, 40) + (msg.content.length > 40 ? '...' : '')
          : c.title;
        return { ...c, messages: msgs, title };
      });

      persistConversations(convos);
      return convos;
    });
    // Also persist to Supabase
    sb.saveMessage(newMsg, targetConvoId || activeConvoId);
    if (activeTabRef.current !== 'chat') {
      setChatBadge(true);
    }
  }

  function handleNewChat() {
    const newConvo = {
      id: 'convo-' + Date.now(),
      title: 'New Chat',
      createdAt: Date.now(),
      messages: [],
    };
    setConversations(prev => {
      const updated = [...prev, newConvo];
      persistConversations(updated);
      return updated;
    });
    setActiveConvoId(newConvo.id);
    setActiveTab('chat');
    setChatBadge(false);
    setActiveDm(null);
  }

  function handleCoworkerChange(cwId) {
    if (!cwId) return;
    setActiveDm(null);
    setConversations(prev => {
      const existing = prev.find(c => c.coworkerId === cwId);
      if (existing) {
        setActiveConvoId(existing.id);
        return prev;
      }
      const coworker = (coworkers || []).find(c => c.id === cwId);
      const newConvo = {
        id: 'convo-' + Date.now() + '-' + Math.random().toString(36).slice(2, 5),
        title: coworker?.name || 'Chat',
        coworkerId: cwId,
        createdAt: Date.now(),
        messages: [],
      };
      setActiveConvoId(newConvo.id);
      const updated = [...prev, newConvo];
      persistConversations(updated);
      return updated;
    });
  }

  function handleSelectConvo(convoId) {
    setActiveConvoId(convoId);
    setActiveTab('chat');
    setChatBadge(false);
    setActiveDm(null);
  }

  function handleDeleteConvo(convoId) {
    setConversations(prev => {
      const updated = prev.filter(c => c.id !== convoId);
      persistConversations(updated);
      // Switch to latest remaining or null
      if (activeConvoId === convoId) {
        setActiveConvoId(updated.length > 0 ? updated[updated.length - 1].id : null);
      }
      return updated;
    });
  }

  function persistConversations(convos) {
    try {
      localStorage.setItem('sandbox:conversations', JSON.stringify(convos));
    } catch {}
  }

  // Update messages in the active conversation (for loading state management)
  function updateActiveMessages(updater) {
    setConversations(prev => {
      const updated = prev.map(c => {
        if (c.id !== activeConvoId) return c;
        return { ...c, messages: updater(c.messages) };
      });
      persistConversations(updated);
      return updated;
    });
  }

  function addLog(entry) {
    setLogs(prev => [...prev, { timestamp: Date.now(), ...entry }]);
  }

  // ===== Intent classifier (platform chat) =====
  // Tiny Haiku call that decides whether a user message needs platform-tool
  // access or is pure Q&A. Used to skip the 12-tool schema on ~70% of turns,
  // which drops those turns from ~$0.002 to ~$0.0007. Classifier itself costs
  // ~$0.0003. Defaults to "action" on any error so tool access isn't silently
  // lost — quality over cost when in doubt.
  async function classifyPlatformIntent(userMessage) {
    if (!apiKey) return 'action';
    const model = 'claude-haiku-4-5-20251001';
    try {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true',
        },
        body: JSON.stringify({
          model,
          max_tokens: 3,
          system: [{
            type: 'text',
            text: `You are a binary intent classifier.

Reply with EXACTLY one word: "action" or "chat".

"action" if the message asks to:
- list / read / create / update / delete any files, coworkers, workflows, tools, or connectors
- retrieve current platform state
- run a workflow or connect an external service

"chat" if the message:
- asks a conceptual question, definition, or how-to
- is greeting, small talk, or general conversation
- asks for an explanation of a platform concept

When unclear, default to "action".

Examples:
"list my coworkers" → action
"how does this platform work?" → chat
"create a coworker named Ravi" → action
"what's a workflow?" → chat
"show me files" → action
"hello" → chat`,
            cache_control: { type: 'ephemeral' },
          }],
          messages: [{ role: 'user', content: userMessage }],
        }),
      });
      if (!response.ok) return 'action';
      const data = await response.json();
      if (data.usage) {
        sb.logLlmUsage({
          participantId: myParticipantId,
          segment: 'chat_classifier',
          model,
          usage: data.usage,
          costUsd: computeCost(data.usage, model),
        });
      }
      const text = (data.content || []).filter(c => c.type === 'text').map(c => c.text).join('').trim().toLowerCase();
      return text.startsWith('chat') ? 'chat' : 'action';
    } catch {
      return 'action';
    }
  }

  // ===== Claude API =====
  // Default segment 'chat' is correct for the free-text chat surface; callers
  // with a different context (refine_description, scorecard, etc.) should
  // pass options.segment explicitly.
  async function callClaudeAPI(systemPrompt, userMessage, options = {}) {
    if (!apiKey) {
      return { success: false, error: 'No API key configured. Add your Anthropic API key in .env file.' };
    }
    // Model is overridable per call — the no-tools platform-chat path and
    // the intent classifier both use Haiku; workflow runs and refine-style
    // callers stay on Sonnet by default.
    const model = options.model || 'claude-sonnet-4-20250514';
    try {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true',
        },
        body: JSON.stringify({
          model,
          // Workflow-run coworker steps do need more runway than chat turns
          // (they produce structured assessments), so keep 1000 — still below
          // the earlier 2000-4096 ceilings and caps the outlier cost per call.
          max_tokens: 1000,
          // Cache the system prompt so repeated turns with the same coworker /
          // skills / knowledge hit the 10x-cheaper cache_read rate. Claude
          // ignores cache_control below its 1024-token minimum gracefully.
          ...(systemPrompt ? { system: [{ type: 'text', text: systemPrompt, cache_control: { type: 'ephemeral' } }] } : {}),
          messages: [{ role: 'user', content: userMessage }],
        }),
      });
      if (!response.ok) {
        const errorText = await response.text().catch(() => '');
        if (response.status === 429) return { success: false, error: 'Too many requests. Wait a few seconds and retry.' };
        return { success: false, error: `API returned ${response.status}. ${errorText}` };
      }
      const data = await response.json();
      if (data.usage) {
        sb.logLlmUsage({
          participantId: myParticipantId,
          segment: options.segment || 'chat',
          segmentRefId: options.segmentRefId,
          model,
          usage: data.usage,
          costUsd: computeCost(data.usage, model),
        });
      }
      const content = data.content.filter(item => item.type === 'text').map(item => item.text).join('\n');
      setNetworkError(false);
      return { success: true, content };
    } catch (error) {
      if (error.name === 'TypeError') setNetworkError(true);
      return { success: false, error: error.message };
    }
  }

  // ===== Claude with Tools (agentic loop) =====
  async function callClaudeWithTools({ systemPrompt, userMessage, agentTools, onToolExecution, onProgressText, coworker, usageSegment, usageRefId }) {
    if (!apiKey) return { success: false, content: [{ type: 'text', text: 'No API key configured.' }] };

    const claudeTools = agentTools.map(t => toolToClaudeSchema(t));
    // Mark the last tool with cache_control so the entire tools array is
    // cached — identical per coworker across turns. Saves re-sending the
    // schemas on every tool-loop iteration.
    const claudeToolsCached = claudeTools.length > 0
      ? claudeTools.map((t, i) => i === claudeTools.length - 1 ? { ...t, cache_control: { type: 'ephemeral' } } : t)
      : claudeTools;
    let messages = [{ role: 'user', content: typeof userMessage === 'string' ? userMessage : userMessage }];
    const allContent = [];
    let turns = 0;
    const model = 'claude-sonnet-4-20250514';
    // 'coworker_chat' for any coworker-backed turn; 'workflow_run' when the
    // workflow runner invokes this function via its own wrapper (sets
    // usageSegment explicitly). Falls back to chat for safety.
    const segment = usageSegment || (coworker ? 'coworker_chat' : 'chat');

    while (turns < 10) {
      turns++;
      try {
        const response = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
            'anthropic-dangerous-direct-browser-access': 'true',
          },
          body: JSON.stringify({
            model,
            max_tokens: 2000,
            // System prompt (role + skills + knowledge + tool guidance) is
            // identical across turns of a coworker chat — cache it. Tools
            // are also marked cacheable via the last-tool trick above.
            ...(systemPrompt ? { system: [{ type: 'text', text: systemPrompt, cache_control: { type: 'ephemeral' } }] } : {}),
            messages,
            tools: claudeToolsCached,
          }),
        });

        if (!response.ok) {
          const errorText = await response.text().catch(() => '');
          return { success: false, content: [{ type: 'text', text: `API error ${response.status}: ${errorText}` }] };
        }

        const data = await response.json();
        if (data.usage) {
          sb.logLlmUsage({
            participantId: myParticipantId,
            segment,
            segmentRefId: usageRefId,
            model,
            usage: data.usage,
            costUsd: computeCost(data.usage, model),
          });
        }
        const textBlocks = [];
        const toolUseBlocks = [];

        for (const block of data.content) {
          if (block.type === 'text') {
            textBlocks.push(block.text);
            allContent.push({ type: 'text', text: block.text });
          } else if (block.type === 'tool_use') {
            toolUseBlocks.push(block);
          }
        }

        // Stream intermediate narration into the chat the moment it arrives,
        // so the user sees the coworker's state transitions ("I'll check the
        // policy first…", "Got Priya's reply, writing the summary now.")
        // instead of silence between tool calls. Final text after the last
        // tool use still arrives through onProgressText so the caller can
        // render it without needing a separate end-of-flow concatenation.
        const combinedText = textBlocks.join('\n').trim();
        if (combinedText && onProgressText) onProgressText(combinedText);

        if (toolUseBlocks.length === 0 || data.stop_reason === 'end_turn') {
          break;
        }

        // Execute tools and build results
        messages.push({ role: 'assistant', content: data.content });
        const toolResults = [];

        for (const toolUse of toolUseBlocks) {
          const tool = toolFromClaudeName(toolUse.name, agentTools);
          if (!tool) {
            toolResults.push({ type: 'tool_result', tool_use_id: toolUse.id, content: 'Tool not found' });
            continue;
          }

          // Shared helper: write a file into the coworker's configured
          // destination (or the sensible fallback) and persist the tree.
          const writeCoworkerFile = (name, content) => {
            const newTree = JSON.parse(JSON.stringify(fileTree));
            newTree.children = newTree.children || [];
            const newFile = {
              id: 'f-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7),
              name,
              type: 'file',
              content,
            };
            const cfg = coworker?.toolConfigs?.['builtin-create-file'];
            const configuredFolder = cfg?.folderId
              ? newTree.children.find(c => c.id === cfg.folderId && c.type === 'folder')
              : null;
            const targetFolder = configuredFolder
              || newTree.children.find(c => c.type === 'folder');
            const subName = cfg?.subfolder === 'skills' ? 'skills' : 'knowledge';
            if (targetFolder) {
              targetFolder.children = targetFolder.children || [];
              const sub = targetFolder.children.find(c => c.type === 'folder' && c.name === subName);
              if (sub) {
                sub.children = sub.children || [];
                sub.children.push(newFile);
              } else {
                targetFolder.children.push(newFile);
              }
            } else {
              newTree.children.push(newFile);
            }
            handleUpdateTree(newTree);
            return newFile;
          };

          const result = await executeTool(tool, toolUse.input, fileTree, callClaudeAPI, {
            onMessage: addMessage,
            onCreateFile: writeCoworkerFile,
            // Send Message tool — coworker drafts a message, the user picks
            // which online human it goes to, and we DM them from the coworker's
            // mirror participant. Fire-and-forget: no reply is awaited.
            onSendDm: async ({ message }) => {
              if (!coworker?.id) return { success: false, output: 'Send Message is only available when a specific AI coworker is running the tool.' };
              const coworkerParticipantId = await sb.getCoworkerParticipantId(coworker.id);
              if (!coworkerParticipantId) return { success: false, output: 'AI coworker is not set up as a DM participant yet. Try again after saving the coworker.' };
              const dmCfg = coworker.toolConfigs?.['builtin-send-message'];
              const allowedIds = dmCfg?.allowedParticipantIds || [];
              if (allowedIds.length === 0) {
                return { success: false, output: 'This coworker has no recipients configured. Open the editor and pick at least one person it can message.' };
              }

              const pickId = 'dm-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7);
              addMessage({
                id: pickId,
                type: 'recipient-picker',
                kind: 'dm',
                question: message,
                coworkerName: coworker.name,
                coworkerAvatar: coworker.avatar,
                allowedParticipantIds: allowedIds,
                status: 'pending',
              });
              const recipientName = await new Promise((resolve) => {
                pickRecipientResolversRef.current.set(pickId, resolve);
              });
              if (!recipientName) return { success: false, output: 'No recipient was picked.' };

              const humanId = await sb.findParticipantIdByName(recipientName);
              if (!humanId) {
                updateActiveMessages(prev => prev.map(m => m.id === pickId ? { ...m, status: 'error', errorOutput: `Could not find "${recipientName}".` } : m));
                return { success: false, output: `Could not find a participant named "${recipientName}".` };
              }

              const sent = await sb.sendDm(coworkerParticipantId, humanId, message);
              if (!sent?.data) {
                updateActiveMessages(prev => prev.map(m => m.id === pickId ? { ...m, status: 'error', errorOutput: sent?.error || 'unknown error' } : m));
                return { success: false, output: `Failed to send the DM: ${sent?.error || 'unknown error'}.` };
              }
              updateActiveMessages(prev => prev.map(m =>
                m.id === pickId ? { ...m, status: 'sent' } : m
              ));
              return { success: true, output: `Message delivered to ${recipientName}.` };
            },
          });

          if (onToolExecution) {
            onToolExecution({
              toolId: tool.id, toolName: tool.name, toolIcon: tool.icon, toolType: tool.type,
              inputs: toolUse.input, outputs: result,
            });
          }
          allContent.push({ type: 'tool_execution', toolName: tool.name, toolIcon: tool.icon, toolType: tool.type, inputs: toolUse.input, outputs: result });
          toolResults.push({ type: 'tool_result', tool_use_id: toolUse.id, content: result.output || 'No output' });
        }

        messages.push({ role: 'user', content: toolResults });
      } catch (error) {
        return { success: false, content: [{ type: 'text', text: `Error: ${error.message}` }] };
      }
    }

    return { success: true, content: allContent };
  }

  // ===== Claude with Platform Actions (agentic loop for platform management) =====
  async function callClaudeWithPlatformActions({ systemPrompt, systemBlocks, userMessage, onToolExecution }) {
    if (!apiKey) return { success: false, content: [{ type: 'text', text: 'No API key configured.' }] };

    // Mutable context so consecutive tool calls in one turn see each other's changes
    const platformCtx = {
      fileTree,
      tools,
      coworkers,
      workflows,
      onUpdateTree: handleUpdateTree,
      onUpdateFileContent: handleUpdateFileContent,
      onUpdateTools: handleUpdateTools,
      onUpdateCoworkers: handleUpdateCoworkers,
      onUpdateWorkflows: handleUpdateWorkflows,
      onRunWorkflow: runWorkflow,
    };

    let msgs = [{ role: 'user', content: typeof userMessage === 'string' ? userMessage : userMessage }];
    const allContent = [];
    let turns = 0;

    while (turns < 10) {
      turns++;
      try {
        const response = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
            'anthropic-dangerous-direct-browser-access': 'true',
          },
          body: JSON.stringify({
            model: 'claude-haiku-4-5-20251001',
            // Platform-chat replies are routing + single-line confirmations.
            // Output is the dominant remaining cost once caching kicks in;
            // capping tight pushes Haiku toward ~100-token replies.
            max_tokens: 256,
            // System prompt: prefer the multi-block array from callers that
            // want stable-vs-variable caching (the platform-chat path); fall
            // back to wrapping a plain string in a single cached block for
            // legacy callers.
            ...(systemBlocks
              ? { system: systemBlocks }
              : systemPrompt
                ? { system: [{ type: 'text', text: systemPrompt, cache_control: { type: 'ephemeral' } }] }
                : {}),
            messages: msgs,
            tools: PLATFORM_TOOL_SCHEMAS.length > 0
              ? PLATFORM_TOOL_SCHEMAS.map((t, i) => i === PLATFORM_TOOL_SCHEMAS.length - 1 ? { ...t, cache_control: { type: 'ephemeral' } } : t)
              : PLATFORM_TOOL_SCHEMAS,
          }),
        });

        if (!response.ok) {
          const errorText = await response.text().catch(() => '');
          return { success: false, content: [{ type: 'text', text: `API error ${response.status}: ${errorText}` }] };
        }

        const data = await response.json();
        if (data.usage) {
          sb.logLlmUsage({
            participantId: myParticipantId,
            segment: 'chat',
            model: 'claude-haiku-4-5-20251001',
            usage: data.usage,
            costUsd: computeCost(data.usage, 'claude-haiku-4-5-20251001'),
          });
        }
        const toolUseBlocks = [];

        for (const block of data.content) {
          if (block.type === 'text') {
            allContent.push({ type: 'text', text: block.text });
          } else if (block.type === 'tool_use') {
            toolUseBlocks.push(block);
          }
        }

        if (toolUseBlocks.length === 0 || data.stop_reason === 'end_turn') break;

        msgs.push({ role: 'assistant', content: data.content });
        const toolResults = [];

        for (const toolUse of toolUseBlocks) {
          const output = executePlatformAction(toolUse.name, toolUse.input, platformCtx);
          const displayName = TOOL_DISPLAY_NAMES[toolUse.name] || toolUse.name;
          const icon = TOOL_ICONS[toolUse.name] || '\u2699\uFE0F';

          if (onToolExecution) {
            onToolExecution({
              toolName: displayName,
              toolIcon: icon,
              toolType: 'platform',
              inputs: toolUse.input,
              outputs: { success: true, output },
            });
          }
          allContent.push({
            type: 'tool_execution',
            toolName: displayName,
            toolIcon: icon,
            toolType: 'platform',
            inputs: toolUse.input,
            outputs: { success: true, output },
          });
          toolResults.push({ type: 'tool_result', tool_use_id: toolUse.id, content: output });
        }

        msgs.push({ role: 'user', content: toolResults });
      } catch (error) {
        return { success: false, content: [{ type: 'text', text: `Error: ${error.message}` }] };
      }
    }

    return { success: true, content: allContent };
  }

  // ===== Workflow Execution =====
  // ===== Workflow Run Helpers =====
  function updateRun(runId, updates) {
    setWorkflowRuns(prev => {
      const updated = prev.map(r => r.id === runId ? { ...r, ...updates } : r);
      persistLocal({ workflowRuns: updated });
      // Sync completed/errored runs to Supabase
      const run = updated.find(r => r.id === runId);
      if (run && (updates.status === 'completed' || updates.status === 'error')) {
        sb.saveWorkflowRun(run);
      }
      return updated;
    });
  }

  function updateRunStep(runId, stepIndex, stepUpdates) {
    setWorkflowRuns(prev => {
      const updated = prev.map(r => {
        if (r.id !== runId) return r;
        const stepResults = [...r.stepResults];
        stepResults[stepIndex] = { ...stepResults[stepIndex], ...stepUpdates };
        return { ...r, stepResults };
      });
      persistLocal({ workflowRuns: updated });
      return updated;
    });
  }

  async function runWorkflow(workflowId, autoInput) {
    const workflow = workflows.find(w => w.id === workflowId);
    if (!workflow) return;

    // Credit budget enforcement — workflow runs are the priciest calls on
    // the platform (multi-step Sonnet coworkers). Block if the starter is
    // already out of credits.
    if (creditsExhausted) {
      addMessage({
        type: 'error',
        content: `You're out of credits (${creditsTotal} allocated). Ask the facilitator to grant more before running a workflow.`,
      });
      return;
    }

    // Case input now lives on the Trigger step. autoInput is kept as a
    // backdoor for programmatic callers (tests, replays) — otherwise the
    // header Run button fires with whatever the user typed into the Trigger.
    let caseInput = autoInput || null;
    if (!caseInput) {
      const triggerStep = (workflow.steps || []).find(s => s.type === 'trigger');
      caseInput = triggerStep?.caseInput?.trim() || null;
    }
    if (!caseInput) {
      addMessage({ type: 'error', content: 'Fill in the Trigger case input before running.' });
      return;
    }

    const runId = 'run-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6);

    // Initialize run with all steps as pending
    const newRun = {
      id: runId,
      workflowId,
      workflowName: workflow.name,
      status: 'running',
      currentStepIndex: 0,
      startedBy: userName,
      startedAt: Date.now(),
      completedAt: null,
      caseInput,
      stepResults: workflow.steps.map(step => {
        const cw = step.coworker || (step.coworkerId ? coworkers?.find(c => c.id === step.coworkerId) : null);
        const person = step.assigneeId ? participants?.find(p => p.id === step.assigneeId) : null;
        return {
          stepId: step.id,
          stepName: step.type === 'agent' ? (cw?.name || step.name) : step.name,
          type: step.type,
          coworkerName: cw?.name || null,
          coworkerAvatar: cw?.avatar || null,
          assigneeName: person?.name || null,
          status: 'pending',
          output: null,
          completedAt: null,
        };
      }),
    };

    setWorkflowRuns(prev => [...prev, newRun]);
    sb.saveWorkflowRun(newRun);

    // Pre-create one dedicated chat per run so every status line / agent
    // reply / approval note lands in a single conversation rather than
    // spawning a new "New Chat" for each message (which it used to, because
    // addMessage falls back to creating a convo when activeConvoId is stale).
    const runConvoId = 'convo-run-' + runId;
    setConversations(prev => [...prev, {
      id: runConvoId,
      title: `Run: ${workflow.name}`,
      createdAt: Date.now(),
      messages: [],
    }]);

    // Fire and forget — runs concurrently
    executeWorkflowRun({
      runId,
      workflow,
      coworkers,
      tools,
      fileTree,
      caseInput,
      userName,
      callClaudeAPI,
      executeToolFn: executeTool,
      onStepUpdate: updateRunStep,
      onRunUpdate: updateRun,
      onMessage: (msg) => addMessage(msg, runConvoId),
      removeLoadingMessages: () => updateActiveMessages(prev => prev.filter(m => m.type !== 'loading')),
      onLog: addLog,
      getApprovalDecision: (rId, stepId, config) => {
        setActiveTab('chat');
        return new Promise(resolve => {
          approvalResolversRef.current.set(rId, resolve);
        });
      },
      onSaveStepOutput: ({ name, content, destination }) => {
        // Per-step save: fires whenever a step with step.save.enabled
        // completes. Writes the content to the folder/subfolder chosen on
        // that step. Falls back to the first top-level folder + 'knowledge'
        // if nothing was explicitly picked.
        const newTree = JSON.parse(JSON.stringify(fileTree));
        newTree.children = newTree.children || [];
        const newFile = {
          id: 'f-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7),
          name,
          type: 'file',
          content,
        };
        const configuredFolder = destination?.folderId
          ? newTree.children.find(c => c.id === destination.folderId && c.type === 'folder')
          : null;
        const targetFolder = configuredFolder || newTree.children.find(c => c.type === 'folder');
        const subName = destination?.subfolder === 'skills' ? 'skills' : 'knowledge';
        if (targetFolder) {
          targetFolder.children = targetFolder.children || [];
          const sub = targetFolder.children.find(c => c.type === 'folder' && c.name === subName);
          if (sub) {
            sub.children = sub.children || [];
            sub.children.push(newFile);
          } else {
            targetFolder.children.push(newFile);
          }
        } else {
          newTree.children.push(newFile);
        }
        handleUpdateTree(newTree);
      },
    }).catch(err => {
      updateRun(runId, { status: 'error', completedAt: Date.now() });
      addMessage({ type: 'error', content: `Workflow error: ${err.message}` });
    });
  }

  function handleApprovalAction(runId, msgId, action, comment) {
    // Try run-specific resolver first
    const resolver = approvalResolversRef.current.get(runId);
    if (resolver) {
      resolver({ action, comment, resolvedBy: userName });
      approvalResolversRef.current.delete(runId);
    }
    // Log to Supabase
    sb.logApproval({ runId, action, comment, resolvedBy: userName });
  }

  function handlePickRecipient(pickId, recipientName) {
    const resolver = pickRecipientResolversRef.current.get(pickId);
    if (!resolver) return;
    pickRecipientResolversRef.current.delete(pickId);
    // Transition the picker card from "choose who" to "waiting for reply".
    // The resolved recipient is stored on the message so subsequent state
    // (sending → waiting → resolved) renders against the same card.
    updateActiveMessages(prev => prev.map(m =>
      m.id === pickId ? { ...m, status: 'waiting', resolvedRecipient: recipientName } : m
    ));
    resolver(recipientName);
  }

  async function handleNudgeRecipient(pickId) {
    // Re-send the same question from the same sender to the same recipient
    // with a "just checking in" prefix. Increments nudgeCount on the message
    // so the UI can show how many times we've nudged.
    const convo = conversations.find(c => c.id === activeConvoId);
    const msg = (convo?.messages || []).find(m => m.id === pickId);
    if (!msg || msg.status !== 'waiting' || !msg.fromParticipantId || !msg.toParticipantId) return;
    const prefix = (msg.nudgeCount || 0) === 0
      ? 'Just checking in — still need your input.'
      : `Nudge ${((msg.nudgeCount || 0) + 1)} — still waiting.`;
    await sb.sendDm(msg.fromParticipantId, msg.toParticipantId, `${prefix} Original question: ${msg.question}`);
    updateActiveMessages(prev => prev.map(m =>
      m.id === pickId ? { ...m, nudgeCount: (m.nudgeCount || 0) + 1 } : m
    ));
  }


  function handleNudge(runId) {
    const run = workflowRuns.find(r => r.id === runId);
    if (!run) return;
    const waitingStep = run.stepResults.find(s => s.status === 'waiting');
    const assignee = waitingStep?.assigneeName || 'the reviewer';
    addMessage({ type: 'status', content: `${userName} nudged ${assignee} to review "${run.workflowName}"` });
    addLog({ type: 'workflow', message: `nudge sent to ${assignee} for ${run.workflowName}` });
  }

  // ===== Direct Chat =====
  async function handleSendMessage(text, contextFileIds, coworkerId, attachments, skillFileIds = []) {
    // Credit budget enforcement — hard block at 0 so a runaway participant
    // can't blow past the facilitator's per-person allocation. The user
    // sees the message in chat; the facilitator can top them up from
    // the admin dashboard and they can retry.
    if (creditsExhausted) {
      addMessage({ type: 'user', content: text, participantName: userName });
      addMessage({
        type: 'error',
        content: `You're out of credits (${creditsTotal} allocated). Ask the facilitator to grant more and try again.`,
      });
      return;
    }
    // Build attachment info for message display
    const attachmentMeta = attachments?.map(a => ({ fileName: a.fileName || a.originalName, category: a.category })) || [];
    addMessage({ type: 'user', content: text, participantName: userName, attachments: attachmentMeta });
    // Direct chat always works, even during workflow runs

    // Resolve coworker (aggregate all skills) or context files
    const targetCoworker = coworkerId ? coworkers?.find(c => c.id === coworkerId) : null;
    const loadingLabel = targetCoworker ? targetCoworker.name : 'Foundry';

    setIsLoading(true);
    const loadingId = genMsgId();
    updateActiveMessages(prev => [...prev, { id: loadingId, type: 'loading', label: loadingLabel }]);

    let systemPrompt = undefined;
    if (targetCoworker) {
      // Build system prompt from role description + instruction files + knowledge files
      const instructions = (targetCoworker.instructionFileIds || []).map(id => findNode(fileTree, id)).filter(Boolean);
      const knowledge = (targetCoworker.knowledgeFileIds || []).map(id => findNode(fileTree, id)).filter(Boolean);

      // Tool guidance — Claude gets the schemas automatically, but without
      // a directive it often drafts artifacts or messages in chat instead
      // of invoking the tool. Tell it when each builtin is the right move,
      // and only list the ones this coworker actually has.
      const toolIds = new Set(targetCoworker.toolIds || []);
      const toolLines = [];
      if (toolIds.has('builtin-create-file')) {
        toolLines.push(`- **Create File** — when the task produces a concrete artifact (memo, summary, report, plan), call Create File with a title and the full markdown content. Do not paste the finished document into chat; put it in a file so the whole room can open it.`);
      }
      if (toolIds.has('builtin-send-message')) {
        const dmCfg = targetCoworker.toolConfigs?.['builtin-send-message'];
        const dmGuidance = dmCfg?.instructions?.trim();
        const dmWhenLine = dmGuidance
          ? `\n  - *When the user has set*: ${dmGuidance}`
          : '';
        toolLines.push(`- **Send Message** — when the task calls for notifying a specific person in the workshop (a heads-up, a hand-off, a request), call Send Message with the drafted text. The user will pick which teammate it goes to. Don't just say "I'll let Priya know" in chat — actually call the tool.${dmWhenLine}`);
      }
      const toolSection = toolLines.length > 0
        ? `\n\n## Tools — use them when the work calls for them\n\nAlways read your Knowledge documents and follow your Instructions first, then decide which tool fits.\n\n${toolLines.join('\n')}`
        : '';

      // Narration habit: short "what I'm doing now" lines between tool calls.
      // The UI streams these to the chat the moment they arrive, so the user
      // sees the coworker's state transitions instead of silence.
      const narrationHint = `\n\n## How you narrate\n\nBefore each tool call, write one short line of plain text saying what you're about to do (e.g., "I'll check with Priya on the 2024 exception first."). After a tool returns, write one short line saying what the result means before deciding the next step. Keep it crisp — this is how the user sees your progress.`;

      systemPrompt = [
        targetCoworker.role ? `## Role\n${targetCoworker.role}\n` : '',
        ...instructions.map(f => f.content),
        knowledge.length > 0 ? '\n\n## Knowledge Documents\n' : '',
        ...knowledge.map(k => `### ${k.name}\n${k.content}\n`),
        toolSection,
        narrationHint,
      ].filter(Boolean).join('\n');
    } else if (contextFileIds && contextFileIds.length > 0) {
      const skillIdSet = new Set(skillFileIds || []);
      const allFiles = contextFileIds.map(id => findNode(fileTree, id)).filter(Boolean);
      const skillFiles = allFiles.filter(f => skillIdSet.has(f.id));
      const contextFiles = allFiles.filter(f => !skillIdSet.has(f.id));
      const parts = [`You are an AI assistant at ${orgName}.`];
      if (skillFiles.length > 0) {
        parts.push(`\n\n## Instructions — how to respond\n${skillFiles.map(f => `### ${f.name}\n${f.content}`).join('\n\n')}`);
      }
      if (contextFiles.length > 0) {
        parts.push(`\n\n## Knowledge — reference material\n${contextFiles.map(f => `### ${f.name}\n${f.content}`).join('\n\n')}`);
      }
      parts.push(`\n\nIf the answer is not covered by the provided material, say so clearly.`);
      systemPrompt = parts.join('');
    }

    // Stage 2 — inject personal preferences (global per user) into every system prompt.
    if (userPreferences && userPreferences.trim()) {
      const prefsSection = `## About the user\n${userPreferences.trim()}\n\n---\n\n`;
      systemPrompt = systemPrompt ? prefsSection + systemPrompt : prefsSection;
    }

    // Build user message content — text + attachments
    const userContentParts = [];

    // Add text attachments as context
    const textAttachments = (attachments || []).filter(a => a.type === 'text');
    if (textAttachments.length > 0) {
      const attachedText = textAttachments.map(a => a.content).join('\n\n');
      userContentParts.push({ type: 'text', text: `${text}\n\n## Uploaded Documents\n${attachedText}` });
    } else {
      userContentParts.push({ type: 'text', text: text });
    }

    // Add image attachments
    const imageAttachments = (attachments || []).filter(a => a.type === 'image');
    for (const img of imageAttachments) {
      userContentParts.push({
        type: 'image',
        source: { type: 'base64', media_type: img.mediaType, data: img.content },
      });
    }

    // Call API — use content array if we have images, else simple text
    const userMessage = imageAttachments.length > 0
      ? userContentParts
      : (textAttachments.length > 0 ? userContentParts[0].text : text);

    // Build coworker tools: built-in capabilities (always) + any assigned connectors
    let coworkerTools = targetCoworker
      ? (targetCoworker.toolIds || []).map(tid => tools?.find(t => t.id === tid)).filter(Boolean)
      : [];

    if (coworkerTools.length > 0) {
      const result = await callClaudeWithTools({
        systemPrompt,
        userMessage,
        agentTools: coworkerTools,
        onToolExecution: (execData) => addMessage({ type: 'tool_execution', ...execData }),
        // Stream narration the moment each model turn produces text, so the
        // user sees the coworker's state transitions live instead of one
        // lumped reply after all tool calls resolve.
        onProgressText: (text) => addMessage({
          type: 'direct-response',
          content: text,
          label: targetCoworker?.name,
          coworkerAvatar: targetCoworker?.avatar,
        }),
        coworker: targetCoworker,
      });
      updateActiveMessages(prev => prev.filter(m => m.id !== loadingId));
      setIsLoading(false);
      if (!result.success) {
        const errorText = result.content?.[0]?.text || 'Unknown error';
        addMessage({ type: 'error', content: errorText });
      }
    } else if (targetCoworker) {
      // Coworker selected but has no tools — simple API call
      const result = await callClaudeAPI(systemPrompt, userMessage);
      updateActiveMessages(prev => prev.filter(m => m.id !== loadingId));
      setIsLoading(false);
      if (result.success) {
        addMessage({ type: 'direct-response', content: result.content, label: targetCoworker.name, coworkerAvatar: targetCoworker.avatar });
      } else {
        addMessage({ type: 'error', content: result.error });
      }
    } else {
      const contextFiles = (contextFileIds || []).map(id => findNode(fileTree, id)).filter(Boolean);
      const knowledgeSection = contextFiles.length > 0
        ? `\n\nThe user has selected these context files — use them to answer questions:\n${contextFiles.map(f => `### ${f.name}\n${f.content}`).join('\n\n')}`
        : '';

      const userPrefsForPlatform = userPreferences && userPreferences.trim()
        ? `## About the user\n${userPreferences.trim()}\n\n---\n\n`
        : '';

      // Stage guidance — only on the first AI reply in this conversation.
      const priorAiMessages = (messages || []).filter(m => m.type === 'direct-response' || m.type === 'agent');
      const isFirstExchange = priorAiMessages.length === 0;
      const stageGuidanceSection = isFirstExchange ? buildStageGuidance(currentStage) + '\n\n---\n\n' : '';

      if (!stageReached(currentStage, '5a')) {
        // Pre-Stage-5a: simple chat mode. No platform features described, no
        // platform-action tools attached. Just conversational AI.
        const chatPrompt = `${userPrefsForPlatform}${stageGuidanceSection}You are a helpful assistant. Have a conversation with the user. Be concise, warm, and helpful. Do not describe platform features, coworkers, files, workflows, or tools unless the user explicitly asks about them.${knowledgeSection}`;
        const result = await callClaudeAPI(chatPrompt, userMessage);
        updateActiveMessages(prev => prev.filter(m => m.id !== loadingId));
        setIsLoading(false);
        if (result.success) {
          addMessage({ type: 'direct-response', content: result.content, label: 'Foundry' });
        } else {
          addMessage({ type: 'error', content: result.error });
        }
      } else {
        // Stage 5a+: intent classifier decides between a cheap no-tools
        // chat and a full platform-tools chat. ~70% of messages are
        // conceptual questions that don't need tool access; routing those
        // away from the 12-schema platform-tools call cuts their cost
        // from ~$0.002 to ~$0.0007. The classifier itself costs ~$0.0003
        // per turn — cheap enough that the weighted average still wins
        // even on tool-needing turns.
        const userMessageString = typeof userMessage === 'string' ? userMessage : text;
        const intent = await classifyPlatformIntent(userMessageString);

        if (intent === 'chat') {
          // No-tools chat path. Short system prompt, no tool schemas,
          // Haiku. Typical cost ~$0.0007/turn.
          const chatOnlySystem = `${userPrefsForPlatform}${stageGuidanceSection}You are the Foundry platform assistant for ${orgName}. Answer conversationally, briefly.

The platform has: Files (knowledge docs + skill files), Coworkers (AI assistants), Workflows (step sequences with AI + human steps), Tools (connectors to external APIs).

## Reply style — strict
Answer in ONE sentence. Two sentences if explaining "how". Never restate the question. Never bullet-list a recap. Never say "Let me know if..." or "Feel free to...". If the user seems to want you to DO something (list, create, change), say: "Let me do that — one second." so they try again and the classifier routes them to the action path.${knowledgeSection}`;
          const result = await callClaudeAPI(chatOnlySystem, userMessageString, { model: 'claude-haiku-4-5-20251001' });
          updateActiveMessages(prev => prev.filter(m => m.id !== loadingId));
          setIsLoading(false);
          if (result.success) {
            addMessage({ type: 'direct-response', content: result.content, label: 'Foundry' });
          } else {
            addMessage({ type: 'error', content: result.error });
          }
        } else {
          // Action path: full platform assistant with all 12 tools.
          //
          // Split the system prompt into a STABLE block (cached) and a
          // VARIABLE block (not cached). Stage guidance fires only on the
          // first exchange and knowledge section changes with attached
          // files — keeping them out of the cached prefix lets the stable
          // part stay hot across turns.
          const platformStableBlock = `${userPrefsForPlatform}You are the Foundry platform assistant for ${orgName}. You help users build and manage their AI coworker platform through natural language.

The platform has these elements:
- **Files**: Knowledge documents (policies, rules, reference) and instruction files (AI coworker behavior). Organized in department folders.
- **Tools**: Every coworker automatically has Knowledge Search and Chat Notification built in. External connectors (Notion, Linear, custom APIs) can be added in the Connectors tab.
- **Coworkers**: AI coworkers with a role description, instruction files (behavior), and knowledge files (context). Built-in tools are automatic.
- **Workflows**: Step sequences — agent tasks, human approval gates, system actions.

When building something, create dependencies first: files before coworkers that need them, coworkers before workflows that reference them. Use assign_tool to wire tools to coworkers.
When answering questions, check current state with list/read tools if needed.

## Reply style — strict
Answer in ONE sentence. If the user asks "how", a second sentence is allowed — never more. After an action, reply with a bare confirmation and nothing else ("Created Ravi." / "Listed 3 coworkers."). Never restate the user's request. Never bullet-list a recap. Never say "Let me know if…" or "Feel free to…". If you can't fit the answer in two sentences, ask the user what specifically they want to know.`;

          const platformVariableTail = `${stageGuidanceSection}${knowledgeSection}`;

          const result = await callClaudeWithPlatformActions({
            systemBlocks: platformVariableTail.trim()
              ? [
                  { type: 'text', text: platformStableBlock, cache_control: { type: 'ephemeral' } },
                  { type: 'text', text: platformVariableTail },
                ]
              : [
                  { type: 'text', text: platformStableBlock, cache_control: { type: 'ephemeral' } },
                ],
            userMessage,
            onToolExecution: (execData) => addMessage({ type: 'tool_execution', ...execData }),
          });
          updateActiveMessages(prev => prev.filter(m => m.id !== loadingId));
          setIsLoading(false);
          if (result.success) {
            const textContent = result.content.filter(c => c.type === 'text').map(c => c.text).join('\n');
            if (textContent) addMessage({ type: 'direct-response', content: textContent, label: 'Foundry' });
          } else {
            const errorText = result.content?.[0]?.text || 'Unknown error';
            addMessage({ type: 'error', content: errorText });
          }
        }
      }
    }
  }

  function handleToggleEducationalCues() {
    const next = !showEducationalCues;
    setShowEducationalCues(next);
    try { localStorage.setItem('sandbox:show-edu-cues', String(next)); } catch {}
  }

  // ===== Render =====
  const selectedFile = selectedFileId ? findNode(fileTree, selectedFileId) : null;
  const activeRuns = workflowRuns.filter(r => r.status === 'running' || r.status === 'waiting_approval');
  const hasActiveRuns = activeRuns.length > 0;

  if (workshopEnded) {
    return (
      <GraduationScreen
        userName={userName}
        conversations={conversations}
        coworkers={coworkers}
        workflows={workflows}
        workflowRuns={workflowRuns}
        flatFiles={flatFiles}
        participants={participants}
        loadAllRoomApprovals={sb.loadAllRoomApprovals}
        onSignOut={() => {
          try { localStorage.removeItem('sandbox:state'); } catch {}
          setIsJoined(false);
          setWorkshopCode('');
          setWorkshopEnded(false);
          sb.signOut();
        }}
      />
    );
  }

  return (
    <AuthGate onJoin={handleJoin} workshopCode={isJoined ? workshopCode : null}>
    <div className="app-shell">
      {justRevealed && (
        <div className="modal-overlay reveal-modal-overlay" onClick={() => setJustRevealed(null)}>
          <div className="reveal-modal" role="status" onClick={e => e.stopPropagation()}>
            <div className="reveal-modal-eyebrow">New Stage Unlocked</div>
            <div className="reveal-modal-title">{STAGE_META[justRevealed]?.label || justRevealed}</div>
            {STAGE_META[justRevealed]?.description && (
              <p className="reveal-modal-desc">
                {STAGE_META[justRevealed].description.replace('{name}', (userName || 'friend').split(' ')[0])}
              </p>
            )}
            <button className="reveal-modal-btn" onClick={() => setJustRevealed(null)}>Got it</button>
          </div>
        </div>
      )}
      <header className="app-header">
        <div className="app-header-left" onClick={() => { setActiveTab('chat'); setChatBadge(false); }} style={{ cursor: 'pointer' }}>
          <span className="app-logo">S</span>
          <div>
            <h1>Foundry</h1>
            <span className="app-header-subtitle">{orgName}</span>
          </div>
        </div>
        <nav className="tab-nav">
          <button className={`tab-nav-item${activeTab === 'chat' ? ' active' : ''}`} onClick={() => { setActiveTab('chat'); setChatBadge(false); }}>
            Chat{chatBadge && activeTab !== 'chat' && <span className="tab-badge" />}
          </button>
          <RevealAt stage="3" currentStage={currentStage}>
            <button className={`tab-nav-item${activeTab === 'files' ? ' active' : ''}`} onClick={() => setActiveTab('files')}>
              Files
            </button>
          </RevealAt>
          <RevealAt stage="5a" currentStage={currentStage}>
            <button className={`tab-nav-item${activeTab === 'coworkers' ? ' active' : ''}`} onClick={() => setActiveTab('coworkers')}>
              Coworkers{coworkers && coworkers.length > 0 && <span className="tab-count">{coworkers.length}</span>}
            </button>
          </RevealAt>
          <RevealAt stage="6" currentStage={currentStage}>
            <button className={`tab-nav-item${activeTab === 'workflow' ? ' active' : ''}`} onClick={() => setActiveTab('workflow')}>
              Orchestration{hasActiveRuns && <span className="tab-running-dot" />}
            </button>
          </RevealAt>
          <RevealAt stage="7" currentStage={currentStage}>
            <button className={`tab-nav-item${activeTab === 'activity' ? ' active' : ''}`} onClick={() => setActiveTab('activity')}>
              Observability{activeRuns.length > 0 && activeTab !== 'activity' && <span className="tab-count">{activeRuns.length}</span>}
            </button>
          </RevealAt>
          <RevealAt stage="7b" currentStage={currentStage}>
            <button className={`tab-nav-item${activeTab === 'usage' ? ' active' : ''}`} onClick={() => setActiveTab('usage')}>
              Economics
            </button>
          </RevealAt>
          <RevealAt stage="8" currentStage={currentStage}>
            <button className={`tab-nav-item${activeTab === 'graduation' ? ' active' : ''}`} onClick={() => setActiveTab('graduation')}>
              Graduation
            </button>
          </RevealAt>
        </nav>
        <div className="app-header-right">
          <RevealAt stage="7b" currentStage={currentStage}>
            <CreditsChip
              creditsLeft={creditsLeft}
              creditsTotal={creditsTotal}
              onClick={() => setActiveTab('usage')}
            />
          </RevealAt>
          <SettingsMenu
            userName={userName}
            currentStage={currentStage}
            sb={sb}
            myParticipantId={myParticipantId}
            creditsLeft={creditsLeft}
            creditsTotal={creditsTotal}
            onOpenUsage={() => setActiveTab('usage')}
            onOpenPreferences={() => setShowPreferences(true)}
            onExit={() => setShowExitConfirm(true)}
          />
        </div>
      </header>

      {networkError && (
        <div className="network-banner">
          <span>Network error detected.</span>
          <button onClick={() => setNetworkError(false)}>Dismiss</button>
        </div>
      )}

      {showPreferences && (
        <PreferencesEditor
          initialContent={userPreferences}
          onSave={async (content) => {
            const user = await sb.getUser();
            if (user?.id) await sb.saveUserPreferences(user.id, content);
            setUserPreferences(content);
          }}
          onClose={() => setShowPreferences(false)}
        />
      )}

      {showExitConfirm && (
        <div className="modal-overlay" onClick={() => setShowExitConfirm(false)}>
          <div className="modal-box" onClick={e => e.stopPropagation()}>
            <h3>Are you sure you want to exit the workshop?</h3>
            <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 8 }}>
              You can come back using the same email that you logged in with.
            </div>

            <div className="modal-actions" style={{ marginTop: 24 }}>
              <button className="modal-btn cancel" onClick={() => setShowExitConfirm(false)}>Cancel</button>
              <button className="modal-btn danger" onClick={handleLeave}>Exit Workshop</button>
            </div>
          </div>
        </div>
      )}

      <div className="tab-content">
        {activeTab === 'chat' && (
          <div className="tab-pane tab-pane-chat">
            <ChatPanel
              messages={messages}
              onSendMessage={handleSendMessage}
              onApprovalAction={handleApprovalAction}
              onPickRecipient={handlePickRecipient}
              onNudgeRecipient={handleNudgeRecipient}
              onGoToFiles={() => setActiveTab('files')}
              isLoading={isLoading}
              participants={participants}
              currentUserName={userName}
              fileTree={fileTree}
              onUpdateFileContent={handleUpdateFileContent}
              coworkers={coworkers || []}
              showEducationalCues={showEducationalCues}
              conversations={conversations}
              activeConvoId={activeConvoId}
              onNewChat={handleNewChat}
              onSelectConvo={handleSelectConvo}
              onDeleteConvo={handleDeleteConvo}
              onCoworkerChange={handleCoworkerChange}
              currentStage={currentStage}
              activeDm={activeDm}
              onOpenDm={handleOpenDm}
              onCloseDm={handleCloseDm}
              myParticipantId={myParticipantId}
              sb={sb}
              unreadDmCounts={unreadDmCounts}
            />
          </div>
        )}
{activeTab === 'coworkers' && (
          <div className="tab-pane tab-pane-coworkers">
            <CoworkerBuilder coworkers={coworkers || []} onUpdateCoworkers={handleUpdateCoworkers} fileTree={fileTree} tools={tools || []} userName={userName} callClaudeAPI={callClaudeAPI} showEducationalCues={showEducationalCues} currentStage={currentStage} onStartChat={cwId => { handleCoworkerChange(cwId); setActiveTab('chat'); }} participants={participants} onUpdateFileContent={handleUpdateFileContent} />
          </div>
        )}
        {activeTab === 'workflow' && (
          <div className="tab-pane tab-pane-workflow">
            <WorkflowBuilder workflows={workflows} onUpdateWorkflows={handleUpdateWorkflows} fileTree={fileTree} onRun={runWorkflow} workflowRuns={workflowRuns} participants={participants} currentUserName={userName} coworkers={coworkers || []} tools={tools || []} showEducationalCues={showEducationalCues} callClaudeAPI={callClaudeAPI} onSaveCoworkerToLibrary={handleSaveCoworkerToLibrary} onUpdateFileContent={handleUpdateFileContent} apiKey={apiKey} onCopilotUsage={({ usage, model }) => sb.logLlmUsage({ participantId: myParticipantId, segment: 'workflow_copilot', model, usage, costUsd: computeCost(usage, model) })} />
          </div>
        )}
        {activeTab === 'files' && (
          <div className="tab-pane tab-pane-files">
            {selectedFile ? (
              <div className="files-editor-fullview">
                <div className="files-editor-topbar">
                  <button className="files-back-btn" onClick={() => setSelectedFileId(null)}>{'\u2190'} Back to files</button>
                  <span className="files-editor-filename">{selectedFile.name}</span>
                </div>
                <FileEditor file={selectedFile} onUpdateContent={handleUpdateFileContent} />
              </div>
            ) : (
              <FileExplorer fileTree={fileTree} selectedFileId={selectedFileId} onSelectFile={setSelectedFileId} onUpdateTree={handleUpdateTree} onSelectDepartment={setSelectedDeptId} showEducationalCues={showEducationalCues} currentStage={currentStage} />
            )}
          </div>
        )}
        {activeTab === 'activity' && (
          <div className="tab-pane tab-pane-activity">
            <ActivityDashboard
              workflowRuns={workflowRuns}
              onApprovalAction={handleApprovalAction}
              onNudge={handleNudge}
              participants={participants}
              currentUserName={userName}
              coworkers={coworkers}
              workflows={workflows}
              showEducationalCues={showEducationalCues}
              approvalsByRun={approvalsByRun}
              onLoadApprovals={async (runId) => {
                const rows = await sb.loadApprovals(runId);
                setApprovalsByRun(prev => ({ ...prev, [runId]: rows || [] }));
              }}
              currentStage={currentStage}
              sb={sb}
            />
          </div>
        )}
        {activeTab === 'usage' && stageReached(currentStage, '7b') && (
          <div className="tab-pane tab-pane-usage">
            <UsageView
              sb={sb}
              participants={participants}
              myParticipantId={myParticipantId}
              showEducationalCues={showEducationalCues}
              creditAllocation={creditAllocation}
              myCreditBonus={myCreditBonus}
            />
          </div>
        )}
        {activeTab === 'graduation' && (
          <div className="tab-pane tab-pane-graduation">
            <GraduationScreen
              embedded
              userName={userName}
              conversations={conversations}
              coworkers={coworkers}
              workflows={workflows}
              workflowRuns={workflowRuns}
              flatFiles={flatFiles}
              participants={participants}
              loadAllRoomApprovals={sb.loadAllRoomApprovals}
            />
          </div>
        )}
      </div>
    </div>
    </AuthGate>
  );
}

export default App;
