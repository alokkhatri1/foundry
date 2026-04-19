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
import RevealAt, { STAGE_META, stageReached } from './components/RevealAt';
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

  // Show a celebratory modal when the admin unlocks a new stage. Skip Stage 1
  // (workshop start is not an "unlock") and skip the initial mount.
  useEffect(() => {
    const prev = previousStageRef.current;
    previousStageRef.current = currentStage;
    if (prev !== null && prev !== currentStage && currentStage !== '1') {
      setJustRevealed(currentStage);
    }
  }, [currentStage]);

  const approvalResolversRef = useRef(new Map());
  // Pending request_review resolvers, keyed by `${coworkerParticipantId}:${humanParticipantId}`.
  // When a matching review_response DM lands, the resolver fires with the
  // metadata ({ action, feedback }) and is removed. First-reply-wins.
  const reviewResolversRef = useRef(new Map());
  // Stage-5c second gate: after the reviewer approves, the sender still has
  // to sign off in their own chat. Keyed by the picker message id.
  const senderApprovalResolversRef = useRef(new Map());
  // Pending recipient-picker resolvers, keyed by picker message id. When the
  // user clicks a human in the picker, the resolver fires with that name.
  const pickRecipientResolversRef = useRef(new Map());
  const activeTabRef = useRef(activeTab);

  useEffect(() => { activeTabRef.current = activeTab; }, [activeTab]);

  // On load: reconnect to Supabase, load state from granular tables, start presence + realtime
  useEffect(() => {
    if (isJoined && workshopCode) {
      sb.joinRoom(workshopCode).then(async (result) => {
        if (result?.error === 'deprecated') { setWorkshopEnded(true); return; }
        if (result?.error || !result?.id || !userName) return;
        const roomId = result.id;
        if (result.current_stage) setCurrentStage(result.current_stage);

        const myColor = participants.find(p => p.name === userName)?.color || COLORS[0];
        const authUser = await sb.getUser();
        const me = await sb.upsertParticipant(userName, myColor, authUser?.id, authUser?.email);
        if (me?.id) setMyParticipantId(me.id);
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
        if (row?.current_stage) setCurrentStage(row.current_stage);
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

  // Route ask_human replies back to their waiting AI turn. We listen to every
  // DM in the room because the reply comes FROM a human TO the AI coworker's
  // mirror — neither side is the current participant, so the regular DM
  // subscription filtered by myParticipantId would miss it. The resolver map
  // is held on this client (the one that initiated the AI chat).
  useEffect(() => {
    if (!isJoined) return;
    const unsub = sb.subscribeToAllRoomDms((dm) => {
      if (dm.kind !== 'review_response') return;
      const key = `${dm.to_participant_id}:${dm.from_participant_id}`;
      const resolver = reviewResolversRef.current.get(key);
      if (resolver) {
        reviewResolversRef.current.delete(key);
        resolver(dm.metadata || { action: 'approved' });
      }
    });
    return unsub;
  }, [isJoined, sb]);

  // Reflect unread count in browser tab title.
  useEffect(() => {
    const total = Object.values(unreadDmCounts).reduce((a, b) => a + b, 0);
    document.title = total > 0 ? `(${total}) Foundry` : 'Foundry';
  }, [unreadDmCounts]);

  async function handleJoin(name, code, authUserId, email) {
    const result = await sb.joinRoom(code);
    if (result?.error) return result;
    const roomId = result.id;
    if (result.current_stage) setCurrentStage(result.current_stage);

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

  function addMessage(msg) {
    const newMsg = { id: genMsgId(), timestamp: Date.now(), ...msg };
    setConversations(prev => {
      let convos = [...prev];
      let convoId = activeConvoId;

      // Create a new conversation if none exists
      if (!convoId || !convos.find(c => c.id === convoId)) {
        const newConvo = {
          id: 'convo-' + Date.now(),
          title: 'New Chat',
          createdAt: Date.now(),
          messages: [],
        };
        convos = [...convos, newConvo];
        convoId = newConvo.id;
        setActiveConvoId(convoId);
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
    sb.saveMessage(newMsg, activeConvoId);
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

  // ===== Claude API =====
  async function callClaudeAPI(systemPrompt, userMessage) {
    if (!apiKey) {
      return { success: false, error: 'No API key configured. Add your Anthropic API key in .env file.' };
    }
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
          model: 'claude-sonnet-4-20250514',
          max_tokens: 1000,
          ...(systemPrompt ? { system: systemPrompt } : {}),
          messages: [{ role: 'user', content: userMessage }],
        }),
      });
      if (!response.ok) {
        const errorText = await response.text().catch(() => '');
        if (response.status === 429) return { success: false, error: 'Too many requests. Wait a few seconds and retry.' };
        return { success: false, error: `API returned ${response.status}. ${errorText}` };
      }
      const data = await response.json();
      const content = data.content.filter(item => item.type === 'text').map(item => item.text).join('\n');
      setNetworkError(false);
      return { success: true, content };
    } catch (error) {
      if (error.name === 'TypeError') setNetworkError(true);
      return { success: false, error: error.message };
    }
  }

  // ===== Claude with Tools (agentic loop) =====
  async function callClaudeWithTools({ systemPrompt, userMessage, agentTools, onToolExecution, onProgressText, coworker }) {
    if (!apiKey) return { success: false, content: [{ type: 'text', text: 'No API key configured.' }] };

    const claudeTools = agentTools.map(t => toolToClaudeSchema(t));
    let messages = [{ role: 'user', content: typeof userMessage === 'string' ? userMessage : userMessage }];
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
            model: 'claude-sonnet-4-20250514',
            max_tokens: 2000,
            ...(systemPrompt ? { system: systemPrompt } : {}),
            messages,
            tools: claudeTools,
          }),
        });

        if (!response.ok) {
          const errorText = await response.text().catch(() => '');
          return { success: false, content: [{ type: 'text', text: `API error ${response.status}: ${errorText}` }] };
        }

        const data = await response.json();
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
            // Stage 5c — the draft-and-review primitive. Coworker drafts the
            // full file, picks a reviewer, sends the draft as a review_request
            // DM carrying title/content/reasoning as metadata. On approve, the
            // file is written to the coworker's configured destination and
            // success flows back to Claude. On reject, the feedback flows back
            // so the coworker can revise and try again.
            onRequestReview: async ({ title, content }) => {
              if (!coworker?.id) return { success: false, output: 'Request Review is only available when a specific AI coworker is running the tool.' };
              const coworkerParticipantId = await sb.getCoworkerParticipantId(coworker.id);
              if (!coworkerParticipantId) return { success: false, output: 'AI coworker is not set up as a DM participant yet. Try again after saving the coworker.' };
              const cfg = coworker.toolConfigs?.['builtin-request-review'];
              const allowedIds = cfg?.allowedParticipantIds || [];
              if (allowedIds.length === 0) {
                return { success: false, output: 'This coworker has no reviewers configured. Open the editor and pick at least one reviewer.' };
              }
              // Reasoning = the narration text this coworker has emitted in
              // the current turn so far. Reviewer can open it in a viewer.
              const reasoning = allContent.filter(c => c.type === 'text').map(c => c.text).join('\n\n');

              const pickId = 'review-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7);
              addMessage({
                id: pickId,
                type: 'recipient-picker',
                kind: 'review',
                question: title,
                draftTitle: title,
                draftContent: content,
                reasoning,
                coworkerName: coworker.name,
                coworkerAvatar: coworker.avatar,
                allowedParticipantIds: allowedIds,
                status: 'pending',
              });
              const recipientName = await new Promise((resolve) => {
                pickRecipientResolversRef.current.set(pickId, resolve);
              });
              if (!recipientName) return { success: false, output: 'No reviewer was picked.' };

              const humanId = await sb.findParticipantIdByName(recipientName);
              if (!humanId) return { success: false, output: `Could not find a reviewer named "${recipientName}".` };

              // Register the review response resolver BEFORE sending — same
              // race as Ask Human if the reviewer clicks Approve instantly.
              const key = `${coworkerParticipantId}:${humanId}`;
              const responsePromise = new Promise((resolve) => {
                reviewResolversRef.current.set(key, resolve);
              });
              const sent = await sb.sendDm(coworkerParticipantId, humanId, `Review request: ${title}`, {
                kind: 'review_request',
                metadata: {
                  title,
                  content,
                  reasoning,
                  coworkerName: coworker.name,
                  coworkerId: coworker.id,
                },
              });
              if (!sent?.data) {
                reviewResolversRef.current.delete(key);
                updateActiveMessages(prev => prev.map(m => m.id === pickId ? { ...m, status: 'error', errorOutput: sent?.error || 'unknown error' } : m));
                return { success: false, output: `Failed to send the review: ${sent?.error || 'unknown error'}.` };
              }
              updateActiveMessages(prev => prev.map(m =>
                m.id === pickId ? { ...m, status: 'waiting_reviewer', fromParticipantId: coworkerParticipantId, toParticipantId: humanId } : m
              ));
              const response = await responsePromise;
              const reviewerAction = response?.action || 'approved';
              const reviewerFeedback = response?.feedback || '';

              if (reviewerAction !== 'approved') {
                updateActiveMessages(prev => prev.map(m =>
                  m.id === pickId ? { ...m, status: 'reviewer_rejected', reviewerAction, reviewerFeedback } : m
                ));
                return { success: false, output: `${recipientName} rejected the draft.${reviewerFeedback ? ' Feedback: ' + reviewerFeedback : ''} Revise the draft and call Request Review again.` };
              }

              // Reviewer approved — hand off to the sender for final sign-off.
              updateActiveMessages(prev => prev.map(m =>
                m.id === pickId ? { ...m, status: 'sender_gate', reviewerAction, reviewerFeedback } : m
              ));
              const senderDecision = await new Promise((resolve) => {
                senderApprovalResolversRef.current.set(pickId, resolve);
              });
              const senderAction = senderDecision?.action || 'approved';
              const senderFeedback = senderDecision?.feedback || '';

              if (senderAction !== 'approved') {
                updateActiveMessages(prev => prev.map(m =>
                  m.id === pickId ? { ...m, status: 'sender_rejected', senderAction, senderFeedback } : m
                ));
                return { success: false, output: `The user (the original sender) rejected the draft after ${recipientName} approved it.${senderFeedback ? ' Feedback: ' + senderFeedback : ''} Revise and call Request Review again — the reviewer will see it fresh.` };
              }

              const fileName = (title || 'draft').toLowerCase().replace(/[^a-z0-9]+/g, '-') + '.md';
              const md = `# ${title}\n\n${content}`;
              const written = writeCoworkerFile(fileName, md);
              updateActiveMessages(prev => prev.map(m =>
                m.id === pickId ? { ...m, status: 'done', senderAction, savedFileName: written?.name || fileName } : m
              ));
              return { success: true, output: `${recipientName} approved and the user confirmed. File saved as ${written?.name || fileName}.` };
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
  async function callClaudeWithPlatformActions({ systemPrompt, userMessage, onToolExecution }) {
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
            model: 'claude-sonnet-4-20250514',
            max_tokens: 4096,
            ...(systemPrompt ? { system: systemPrompt } : {}),
            messages: msgs,
            tools: PLATFORM_TOOL_SCHEMAS,
          }),
        });

        if (!response.ok) {
          const errorText = await response.text().catch(() => '');
          return { success: false, content: [{ type: 'text', text: `API error ${response.status}: ${errorText}` }] };
        }

        const data = await response.json();
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
      onMessage: addMessage,
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

  function handleSenderApproval(pickId, action, feedback) {
    const resolver = senderApprovalResolversRef.current.get(pickId);
    if (!resolver) return;
    senderApprovalResolversRef.current.delete(pickId);
    resolver({ action, feedback: feedback || '' });
  }

  async function handleReviewRespond(reviewDm, action, feedback) {
    if (!myParticipantId || !reviewDm?.from_participant_id) return false;
    const humanReplySummary = action === 'approved'
      ? 'Approved'
      : `Rejected${feedback ? `: ${feedback}` : ''}`;
    const sent = await sb.sendDm(
      myParticipantId,
      reviewDm.from_participant_id,
      humanReplySummary,
      {
        kind: 'review_response',
        metadata: { action, feedback: feedback || '', reviewRequestDmId: reviewDm.id },
      }
    );
    return !!sent?.data;
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
      // Stage 5c — give the coworker a list of who is currently live and a
      // hint about when to reach out. The names must match exactly for
      // ask_human to route correctly.
      let collabSection = '';
      const hasRequestReview = (targetCoworker.toolIds || []).includes('builtin-request-review');
      if (stageReached(currentStage, '5c') && hasRequestReview) {
        const reviewCfg = targetCoworker.toolConfigs?.['builtin-request-review'];
        const customGuidance = reviewCfg?.instructions?.trim();
        const whoSignsOffLine = customGuidance
          ? `\n\n### Who signs off (set by the user)\n${customGuidance}`
          : '';
        collabSection = `\n\n## Finishing your work — review is mandatory\n\nYou DO NOT have access to Create File directly. Every artifact you produce must go through two gates: the reviewer AND the original sender.\n\nWorkflow:\n1. Process the task — read your knowledge, think it through, narrate your steps in short lines.\n2. Draft the full file in your head — title + full markdown content.\n3. Call Request Review with that title and content. The sender picks a reviewer for you.\n4. The reviewer sees your draft and your reasoning, then approves or rejects.\n   - On reviewer reject: the tool returns their feedback. Revise and call Request Review again.\n5. If the reviewer approves, the sender gets a final sign-off gate in their own chat.\n   - On sender approve: the file is saved to the workspace. The tool returns success — you're done, don't call anything else.\n   - On sender reject: the tool returns their feedback. Revise and call Request Review again — the reviewer will see it fresh on the next round.\n\nRepeat until both the reviewer and the sender have approved the same draft. Never finalise without both gates saying yes. Never substitute a chat summary for a reviewed file.${whoSignsOffLine}`;
      }

      // Narration habit: short "what I'm doing now" lines between tool calls.
      // The UI streams these to the chat the moment they arrive, so the user
      // sees the coworker's state transitions instead of silence.
      const narrationHint = `\n\n## How you narrate\n\nBefore each tool call, write one short line of plain text saying what you're about to do (e.g., "I'll check with Priya on the 2024 exception first."). After a tool returns, write one short line saying what the result means before deciding the next step. Keep it crisp — this is how the user sees your progress.`;

      systemPrompt = [
        targetCoworker.role ? `## Role\n${targetCoworker.role}\n` : '',
        ...instructions.map(f => f.content),
        knowledge.length > 0 ? '\n\n## Knowledge Documents\n' : '',
        ...knowledge.map(k => `### ${k.name}\n${k.content}\n`),
        collabSection,
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

    // When Request Review is ticked, it takes precedence over direct Create
    // File — the coworker must go through human approval to produce any
    // artifact. Strip Create File from the exposed toolset so Claude can't
    // short-circuit the review gate. The underlying writeCoworkerFile helper
    // stays in scope so Request Review can still write the file on approval.
    if (coworkerTools.some(t => t.id === 'builtin-request-review')) {
      coworkerTools = coworkerTools.filter(t => t.id !== 'builtin-create-file');
    }

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
        // Stage 5a+: platform assistant with full tool access
        const platformSystemPrompt = `${userPrefsForPlatform}${stageGuidanceSection}You are the Foundry platform assistant for ${orgName}. You help users build and manage their AI coworker platform through natural language.

The platform has these elements:
- **Files**: Knowledge documents (policies, rules, reference) and instruction files (AI coworker behavior). Organized in department folders.
- **Tools**: Every coworker automatically has Knowledge Search and Chat Notification built in. External connectors (Notion, Linear, custom APIs) can be added in the Connectors tab.
- **Coworkers**: AI coworkers with a role description, instruction files (behavior), and knowledge files (context). Built-in tools are automatic.
- **Workflows**: Step sequences — agent tasks, human approval gates, system actions.

When building something, create dependencies first: files before coworkers that need them, coworkers before workflows that reference them. Use assign_tool to wire tools to coworkers.
When answering questions, check current state with list/read tools if needed.
Be concise. Confirm actions after completing them.${knowledgeSection}`;

        const result = await callClaudeWithPlatformActions({
          systemPrompt: platformSystemPrompt,
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
        </nav>
        <div className="app-header-right">
          <span className="header-user-name">{userName}</span>
          <RevealAt stage="2" currentStage={currentStage}>
            <button className="header-btn" onClick={() => setShowPreferences(true)}>Preferences</button>
          </RevealAt>
          <button className="header-btn" onClick={() => setShowExitConfirm(true)}>Exit Workshop</button>
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
              onReviewRespond={handleReviewRespond}
              onSenderApproval={handleSenderApproval}
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
            <CoworkerBuilder coworkers={coworkers || []} onUpdateCoworkers={handleUpdateCoworkers} fileTree={fileTree} tools={tools || []} userName={userName} callClaudeAPI={callClaudeAPI} showEducationalCues={showEducationalCues} currentStage={currentStage} onStartChat={cwId => { handleCoworkerChange(cwId); setActiveTab('chat'); }} participants={participants} />
          </div>
        )}
        {activeTab === 'workflow' && (
          <div className="tab-pane tab-pane-workflow">
            <WorkflowBuilder workflows={workflows} onUpdateWorkflows={handleUpdateWorkflows} fileTree={fileTree} onRun={runWorkflow} workflowRuns={workflowRuns} participants={participants} currentUserName={userName} coworkers={coworkers || []} tools={tools || []} showEducationalCues={showEducationalCues} callClaudeAPI={callClaudeAPI} onSaveCoworkerToLibrary={handleSaveCoworkerToLibrary} />
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
            />
          </div>
        )}
      </div>
    </div>
    </AuthGate>
  );
}

export default App;
