import { useState, useRef, useEffect, useMemo } from 'react';
import './App.css';
import AuthGate from './components/AuthGate';
import FileExplorer from './components/FileExplorer';
import FileEditor from './components/FileEditor';
import WorkflowBuilder from './components/WorkflowBuilder';
import CoworkerBuilder from './components/CoworkerBuilder';
import ChatPanel from './components/ChatPanel';
import ActivityDashboard from './components/ActivityDashboard';
import RevealAt, { STAGE_META, stageReached } from './components/RevealAt';
import { buildStageGuidance } from './data/stageGuidance';
import PreferencesEditor from './components/PreferencesEditor';
import DelegationPanel from './components/DelegationPanel';
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
import { buildTree, flattenTree, mapFileRow, mapCoworkerRow, mapToolRow, mapWorkflowRow } from './utils/treeUtils';

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
  const [workflows, setWorkflows] = useState(saved?.workflows || (saved?.workflow ? [saved.workflow] : null));
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
  // Pending ask_human resolvers, keyed by `${coworkerParticipantId}:${humanParticipantId}`.
  // When a matching DM reply arrives, the resolver fires with the reply content
  // and is removed. First-reply-wins.
  const askHumanResolversRef = useRef(new Map());
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
        if (result.current_stage) {
          if (stageReached(result.current_stage, '3')) await sb.ensureStageFolder(roomId, '3');
          if (stageReached(result.current_stage, '4')) await sb.ensureStageFolder(roomId, '4');
        }

        // Load state from granular tables
        const [files, cws, tls, wfs, dbParticipants] = await Promise.all([
          sb.loadFiles(), sb.loadCoworkers(), sb.loadTools(), sb.loadWorkflows(), sb.loadParticipants(),
        ]);

        if (files.length > 0) setFlatFiles(files);
        if (cws.length > 0) setCoworkers(cws);
        if (tls.length > 0) setTools(tls);
        if (wfs.length > 0) setWorkflows(wfs);
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
            return idx >= 0 ? list.map(c => c.id === mapped.id ? mapped : c) : [...list, mapped];
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
      const key = `${dm.to_participant_id}:${dm.from_participant_id}`;
      const resolver = askHumanResolversRef.current.get(key);
      if (resolver) {
        askHumanResolversRef.current.delete(key);
        resolver(dm.content);
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
    // Backfill stage-specific folders for legacy workshops (default stage '6').
    if (result.current_stage) {
      if (stageReached(result.current_stage, '3')) await sb.ensureStageFolder(roomId, '3');
      if (stageReached(result.current_stage, '4')) await sb.ensureStageFolder(roomId, '4');
    }

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
      setCoworkers(cws || []);
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
    // Convert tree to flat files, update state, sync each file to Supabase
    const newFlat = flattenTree(newTree, sb.getRoomId()).map(mapFileRow);
    setFlatFiles(newFlat);
    // Batch save all files
    sb.saveFilesBatch(flattenTree(newTree, sb.getRoomId()));
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
    setWorkflows(newWorkflows);
    // Save each changed workflow
    for (const wf of newWorkflows) sb.saveWorkflow(wf);
    persistLocal({ workflows: newWorkflows });
  }

  function handleUpdateTools(newTools) {
    setTools(newTools);
    for (const t of newTools) sb.saveTool(t);
    persistLocal({ tools: newTools });
  }

  function handleUpdateCoworkers(newCoworkers) {
    setCoworkers(newCoworkers);
    for (const cw of newCoworkers) sb.saveCoworker(cw);
    persistLocal({ coworkers: newCoworkers });
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
  async function callClaudeWithTools({ systemPrompt, userMessage, agentTools, onToolExecution, coworker }) {
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

          const result = await executeTool(tool, toolUse.input, fileTree, callClaudeAPI, {
            onMessage: addMessage,
            onCreateFile: (name, content) => {
              const newTree = JSON.parse(JSON.stringify(fileTree));
              const root = newTree.children?.[0];
              if (root?.children) {
                const knowledge = root.children.find(c => c.name === 'knowledge');
                if (knowledge) knowledge.children.push({ id: 'f-' + Date.now(), name, type: 'file', content });
              }
              handleUpdateTree(newTree);
            },
            onSendDm: async (recipientName, message) => {
              if (!myParticipantId) return { success: false, output: 'Your participant record is not ready — try again in a moment.' };
              const toId = await sb.findParticipantIdByName(recipientName);
              if (!toId) return { success: false, output: `Could not find a workshop participant named "${recipientName}".` };
              const sent = await sb.sendDm(myParticipantId, toId, message);
              if (sent?.data) return { success: true, output: `Message sent to ${recipientName}.` };
              return { success: false, output: `Failed to send message: ${sent?.error || 'unknown error'}` };
            },
            onAskHuman: async (recipientName, question) => {
              if (!coworker?.id) {
                return { success: false, output: 'Ask Human is only available when a specific AI coworker is running the tool.' };
              }
              const coworkerParticipantId = await sb.getCoworkerParticipantId(coworker.id);
              if (!coworkerParticipantId) {
                return { success: false, output: 'AI coworker is not set up as a DM participant yet. Try again after saving the coworker.' };
              }
              const humanId = await sb.findParticipantIdByName(recipientName);
              if (!humanId) {
                return { success: false, output: `Could not find a workshop participant named "${recipientName}". Make sure the name matches exactly and they are in the workshop.` };
              }
              const online = participants.find(p => p.name === recipientName && p.online);
              if (!online) {
                return { success: false, output: `${recipientName} is not currently online. Ask someone who is live in the workshop right now.` };
              }
              const sent = await sb.sendDm(coworkerParticipantId, humanId, question);
              if (!sent?.data) {
                return { success: false, output: `Failed to send the question: ${sent?.error || 'unknown error'}.` };
              }
              const key = `${coworkerParticipantId}:${humanId}`;
              const reply = await new Promise((resolve) => {
                askHumanResolversRef.current.set(key, resolve);
              });
              return { success: true, output: `${recipientName} replied: ${reply}` };
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

    let caseInput = autoInput || null;
    if (!caseInput) {
      caseInput = prompt('Enter case input for the workflow:', DEFAULT_TEST_CASE);
      if (!caseInput) return;
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
        const cw = step.coworkerId ? coworkers?.find(c => c.id === step.coworkerId) : null;
        const person = step.assigneeId ? participants?.find(p => p.id === step.assigneeId) : null;
        return {
          stepId: step.id,
          stepName: step.name,
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
    }).catch(err => {
      updateRun(runId, { status: 'error', completedAt: Date.now() });
      addMessage({ type: 'error', content: `Workflow error: ${err.message}` });
    });
  }

  function handleApprovalAction(runId, msgId, action, comment) {
    // Try run-specific resolver first
    const resolver = approvalResolversRef.current.get(runId);
    if (resolver) {
      resolver({ action, comment });
      approvalResolversRef.current.delete(runId);
    }
    // Log to Supabase
    sb.logApproval({ runId, action, comment, resolvedBy: userName });
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
      if (stageReached(currentStage, '5c')) {
        const liveHumans = (participants || []).filter(p => p.online && (p.kind || 'human') === 'human' && p.name !== targetCoworker.name);
        const list = liveHumans.length > 0
          ? liveHumans.map(p => `- ${p.name}`).join('\n')
          : '- (nobody is online right now — the ask_human tool will fail until someone joins)';
        collabSection = `\n\n## Live humans you can ask\n${list}\n\nWhen you genuinely need a human's judgment, confirmation, or a missing piece of information, call the Ask Human tool with their exact name and a clear question. Wait for the reply; incorporate it before concluding. Use this sparingly — only when the task actually needs a human.`;
      }
      systemPrompt = [
        targetCoworker.role ? `## Role\n${targetCoworker.role}\n` : '',
        ...instructions.map(f => f.content),
        knowledge.length > 0 ? '\n\n## Knowledge Documents\n' : '',
        ...knowledge.map(k => `### ${k.name}\n${k.content}\n`),
        collabSection,
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

    // Stage 5c Collaboration — every coworker gets the Ask Human tool so it
    // can reach a live human mid-task and resume with the reply.
    if (targetCoworker && stageReached(currentStage, '5c')) {
      const askHumanTool = (tools || []).find(t => t.id === 'builtin-ask-human');
      if (askHumanTool && !coworkerTools.some(t => t.id === 'builtin-ask-human')) {
        coworkerTools = [...coworkerTools, askHumanTool];
      }
    }

    if (coworkerTools.length > 0) {
      const result = await callClaudeWithTools({
        systemPrompt,
        userMessage,
        agentTools: coworkerTools,
        onToolExecution: (execData) => addMessage({ type: 'tool_execution', ...execData }),
        coworker: targetCoworker,
      });
      updateActiveMessages(prev => prev.filter(m => m.id !== loadingId));
      setIsLoading(false);
      if (result.success) {
        const textContent = result.content.filter(c => c.type === 'text').map(c => c.text).join('\n');
        if (textContent) addMessage({ type: 'direct-response', content: textContent, label: targetCoworker?.name, coworkerAvatar: targetCoworker?.avatar });
      } else {
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
    const totalMessages = (conversations || []).reduce((sum, c) => sum + (c.messages?.length || 0), 0);
    const filesCount = (flatFiles || []).filter(f => f.type === 'file').length;
    const coworkersCount = (coworkers || []).length;
    const runsCount = (workflowRuns || []).length;
    return (
      <div className="landing">
        <div className="landing-content" style={{ flexDirection: 'column', alignItems: 'center', gap: 24, textAlign: 'center', paddingTop: 80 }}>
          <h1 className="landing-title">Thanks for participating</h1>
          <p className="landing-subtitle" style={{ maxWidth: 480 }}>
            Your journey in this workshop:
          </p>
          <div className="journey-stats">
            <div className="journey-stat">
              <div className="journey-stat-num">{totalMessages}</div>
              <div className="journey-stat-label">messages</div>
            </div>
            <div className="journey-stat">
              <div className="journey-stat-num">{filesCount}</div>
              <div className="journey-stat-label">files</div>
            </div>
            <div className="journey-stat">
              <div className="journey-stat-num">{coworkersCount}</div>
              <div className="journey-stat-label">coworkers</div>
            </div>
            <div className="journey-stat">
              <div className="journey-stat-num">{runsCount}</div>
              <div className="journey-stat-label">workflow runs</div>
            </div>
          </div>
          <p className="landing-subtitle" style={{ maxWidth: 480, opacity: 0.8, fontSize: 14 }}>
            All your work is preserved in the workshop archive.
          </p>
          <button className="landing-join-btn" style={{ width: 'auto', padding: '12px 32px' }} onClick={() => {
            try { localStorage.removeItem('sandbox:state'); } catch {}
            setIsJoined(false);
            setWorkshopCode('');
            setWorkshopEnded(false);
            sb.signOut();
          }}>
            Sign Out
          </button>
        </div>
      </div>
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
            <button className={`tab-nav-item${activeTab === 'delegation' ? ' active' : ''}`} onClick={() => setActiveTab('delegation')}>
              Delegation
            </button>
          </RevealAt>
          <RevealAt stage="7" currentStage={currentStage}>
            <button className={`tab-nav-item${activeTab === 'workflow' ? ' active' : ''}`} onClick={() => setActiveTab('workflow')}>
              Orchestration{hasActiveRuns && <span className="tab-running-dot" />}
            </button>
          </RevealAt>
          <RevealAt stage="8" currentStage={currentStage}>
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
            <CoworkerBuilder coworkers={coworkers || []} onUpdateCoworkers={handleUpdateCoworkers} fileTree={fileTree} tools={tools || []} userName={userName} callClaudeAPI={callClaudeAPI} showEducationalCues={showEducationalCues} currentStage={currentStage} />
          </div>
        )}
        {activeTab === 'delegation' && (
          <div className="tab-pane tab-pane-delegation">
            <DelegationPanel
              sb={sb}
              callClaudeAPI={callClaudeAPI}
              userName={userName}
              userRole={userRole}
              coworkers={coworkers || []}
            />
          </div>
        )}
        {activeTab === 'workflow' && (
          <div className="tab-pane tab-pane-workflow">
            <WorkflowBuilder workflows={workflows} onUpdateWorkflows={handleUpdateWorkflows} fileTree={fileTree} onRun={runWorkflow} workflowRuns={workflowRuns} participants={participants} currentUserName={userName} coworkers={coworkers || []} tools={tools || []} showEducationalCues={showEducationalCues} />
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
              <FileExplorer fileTree={fileTree} selectedFileId={selectedFileId} onSelectFile={setSelectedFileId} onUpdateTree={handleUpdateTree} onSelectDepartment={setSelectedDeptId} showEducationalCues={showEducationalCues} />
            )}
          </div>
        )}
        {activeTab === 'activity' && (
          <div className="tab-pane tab-pane-activity">
            <ActivityDashboard
              workflowRuns={workflowRuns}
              logs={logs}
              onApprovalAction={handleApprovalAction}
              onNudge={handleNudge}
              participants={participants}
              currentUserName={userName}
              coworkers={coworkers}
              workflows={workflows}
              showEducationalCues={showEducationalCues}
            />
          </div>
        )}
      </div>
    </div>
    </AuthGate>
  );
}

export default App;
