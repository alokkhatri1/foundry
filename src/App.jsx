import { useState, useRef, useEffect, useMemo } from 'react';
import './App.css';
import AuthGate, { useAuth } from './components/AuthGate';
import GraduationScreen from './components/GraduationScreen';
import DemographicsForm from './components/DemographicsForm';
import StageReflection from './components/StageReflection';
import { REFLECTION_STAGES } from './data/reflectionPrompts';
import { COWORKER_ICONS } from './components/Icon';
import FileExplorer from './components/FileExplorer';
import FileEditor from './components/FileEditor';
import ScenarioBuilder from './components/ScenarioBuilder';

// Was imported from the now-retired Capstone component; small enough to
// inline and self-contained — used only when materialising case-driven
// rows into runnable workflows in handleRunCaseWorkflow.
function deriveCoworkerName(step) {
  const cleaned = (step || '').trim().replace(/\s+/g, ' ');
  if (!cleaned) return '';
  const words = cleaned.split(' ').slice(0, 5);
  const titled = words.map(w => w ? w[0].toUpperCase() + w.slice(1).toLowerCase() : w).join(' ');
  return titled.replace(/[.,;:!?]+$/, '').slice(0, 60);
}
import CoworkerBuilder from './components/CoworkerBuilder';
import ChatPanel from './components/ChatPanel';
import ActivityDashboard from './components/ActivityDashboard';
import UsageView, { useMyUsageTotal, useWorkshopUsageTotal } from './components/UsageView';
import { formatUsd, formatTokens } from './utils/llmCost';
import RevealAt, { STAGE_META, STAGE_ORDER, stageReached, normalizeStage } from './components/RevealAt';
import { computeCost, costToCredits, DEFAULT_CREDIT_ALLOCATION, CREDITS_WARN_THRESHOLD } from './utils/llmCost';
import { buildStageGuidance } from './data/stageGuidance';
import PreferencesEditor from './components/PreferencesEditor';
import StageExamplePanel from './components/StageExamplePanel';
import { useConfirm } from './components/ConfirmDialog';
import {
  createStarterFolders,
  createStarterTools,
  createStarterRun,
  createStarterLogs,
  DEFAULT_TEST_CASE,
  ensurePrebuiltTools,
  BUILTIN_TOOLS,
} from './data/starterContent';
import {
  EXAMPLE_BLUEPRINT_FILE_ID,
  EXAMPLE_BLUEPRINTS_FOLDER_ID,
  CAPSTONE_BLUEPRINT,
  RETAIL_LENDING_POLICY,
  COMPLIANCE_EXCEPTIONS,
  CREDIT_REVIEW_SKILL,
  COMPLIANCE_CHECK_SKILL,
  IDEAL_CUSTOMER_PROFILE,
  PITCH_RUBRIC,
  CUSTOMER_INTERVIEW_SYNTH_SKILL,
  PITCH_REVIEWER_SKILL,
} from './data/exampleArtifacts';

// Canonical content for the System-seeded example files. Used as a fallback
// when handleEnsureFileContent loads a row whose `content` column is empty
// in the DB (rooms that passed Stage 8 before content seeding was reliable,
// or had an old migration clear the body). Lookup by file id; user-created
// files are not in this map and follow the normal load path unchanged.
const EXAMPLE_FILE_CONTENT = {
  'example-file-retail-policy':         RETAIL_LENDING_POLICY,
  'example-file-compliance-exceptions': COMPLIANCE_EXCEPTIONS,
  'example-file-credit-review':         CREDIT_REVIEW_SKILL,
  'example-file-compliance-check':      COMPLIANCE_CHECK_SKILL,
  'example-file-icp':                   IDEAL_CUSTOMER_PROFILE,
  'example-file-pitch-rubric':          PITCH_RUBRIC,
  'example-file-interview-synth':       CUSTOMER_INTERVIEW_SYNTH_SKILL,
  'example-file-pitch-review':          PITCH_REVIEWER_SKILL,
  [EXAMPLE_BLUEPRINT_FILE_ID]:          CAPSTONE_BLUEPRINT,
};
import { executeWorkflowRun } from './utils/runWorkflowAsync';
import { submitDm, flushOutbox as flushDmOutbox, outboxSnapshot } from './utils/dmOutbox';
import { executeTool, toolToClaudeSchema, toolFromClaudeName } from './utils/toolExecutor';
import { PLATFORM_TOOL_SCHEMAS, TOOL_DISPLAY_NAMES, TOOL_ICONS, executePlatformAction } from './utils/platformActions';
import useSupabase from './hooks/useSupabase';
import { buildTree, flattenTree, mapFileRow, mapCoworkerRow, mapToolRow, mapWorkflowRow, preserveToolConfigs, ensureDagShape, updateNodeInTree, addChildToTree } from './utils/treeUtils';
import { callClaudeProxy } from './utils/claudeFetch';
import { supabase as supabaseClient } from './supabase';

const STORAGE_KEY = 'sandbox:state';

// Avatar colors for Capstone-materialized coworkers. Mirrors the palette
// CoworkerBuilder uses for hand-built coworkers so the library stays
// visually coherent regardless of how a coworker was created.
const CAPSTONE_COWORKER_COLORS = ['#4a7fb5', '#5a9e6f', '#c8956c', '#8b6fb0', '#c45c5c', '#4a9e9e', '#b5784a', '#6f8bb0'];

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

// Coalesced writer: rapid persistLocal calls (tool chain, workflow step
// updates, bursts of realtime inserts) would each JSON.stringify the full
// state and hit localStorage. At cohort scale that visibly jams input.
// Hold the latest state, flush once per animation frame / 200ms idle, and
// drain on pagehide so we don't lose the last write.
let pendingState = null;
let flushTimer = null;
function flushState() {
  if (pendingState == null) return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(pendingState));
  } catch {}
  pendingState = null;
  flushTimer = null;
}
if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', flushState);
  window.addEventListener('beforeunload', flushState);
}
function saveState(state) {
  pendingState = state;
  if (flushTimer != null) return;
  flushTimer = setTimeout(flushState, 200);
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
  // Path-clone via updateNodeInTree: only the spine from root to the
  // edited file gets new objects. Sibling subtrees are shared, so React's
  // reference-equality bailout skips re-rendering the rest of the tree.
  return updateNodeInTree(tree, fileId, node =>
    node.type === 'file' ? { ...node, content } : node
  );
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

// Header chip showing live running spend. Takes total + tokens from a
// single App-level useMyUsageTotal subscription — previously had its own,
// which doubled the realtime channel count and let the two subscriptions'
// accumulators drift. Mounted only post-7b.
function SpendChip({ total, tokenTotal, onClick }) {
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
// Current Level, live spend total (when Stage 8 / Economics is revealed),
// Preferences (Stage 2+), and Exit Workshop. Frees the header to show
// every stage tab without wrapping.
function SettingsMenu({ userName, orgName, currentStage, sb, myParticipantId, creditsLeft, creditsTotal, onOpenUsage, onOpenPreferences, onExit }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const { isAdmin, openAdmin } = useAuth();
  const showSpend = stageReached(currentStage, '8');
  // Workshop-wide total — matches the pedagogy of the Usage tab
  // ("look how cheap the whole room is"). We always run the hook (can't
  // call hooks conditionally) but only render its result after Economics
  // (Stage 8 in the 9-stage arc).
  const spend = useWorkshopUsageTotal(sb);
  const showPreferences = stageReached(currentStage, '2');
  const initial = (userName || '?').trim().charAt(0).toUpperCase();
  const firstName = (userName || 'You').trim().split(/\s+/)[0];
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
        <span className="header-settings-name">{firstName}</span>
        <span className="header-settings-caret">{'\u25BE'}</span>
      </button>
      {open && (
        <div className="header-settings-menu" role="menu">
          <div className="header-settings-identity">
            <div className="header-settings-menu-name">{userName || 'You'}</div>
            {orgName && <div className="header-settings-menu-org">{orgName}</div>}
          </div>

          <div className="header-settings-meta-grid">
            {stageLabel && (
              <div className="header-settings-meta">
                <span className="header-settings-meta-label">Current Level</span>
                <span className="header-settings-meta-value is-stage">{stageLabel}</span>
              </div>
            )}
            {creditsLeft != null && (
              <div
                className="header-settings-meta"
                title={`${Math.max(0, creditsLeft).toLocaleString()} of ${creditsTotal.toLocaleString()} credits left. ~10 credits = a typical chat. ~50 credits = a workflow run.`}
              >
                <span className="header-settings-meta-label">Credits</span>
                <span className={`header-settings-meta-value${creditsLow ? ' header-settings-meta-low' : ''}`}>
                  <span aria-hidden>{'✦'}</span> {Math.max(0, creditsLeft).toLocaleString()}
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
          <div className="header-settings-section">
            {isAdmin && (
              <button
                className="header-settings-item"
                onClick={() => { openAdmin?.(); setOpen(false); }}
              >Admin Panel<span className="header-settings-item-arrow">{'↗'}</span></button>
            )}
            {showPreferences && (
              <button
                className="header-settings-item"
                onClick={() => { onOpenPreferences?.(); setOpen(false); }}
              >Preferences<span className="header-settings-item-arrow">{'↗'}</span></button>
            )}
            <button
              className="header-settings-item danger"
              onClick={() => { onExit?.(); setOpen(false); }}
            >Exit Workshop<span className="header-settings-item-arrow">{'→'}</span></button>
          </div>
        </div>
      )}
    </div>
  );
}

function App() {
  const saved = loadState();
  const sb = useSupabase();
  const confirm = useConfirm();

  const [userName, setUserName] = useState(saved?.userName || '');
  const [workshopCode, setWorkshopCode] = useState(saved?.workshopCode || '');
  const [orgName, setOrgName] = useState(saved?.orgName || 'My Organization');
  // The Anthropic API key used to live here, sourced from VITE_ANTHROPIC_API_KEY.
  // It now lives in the claude-proxy Edge Function's secrets and never enters
  // the browser. callClaudeProxy reads the supabase session token instead.
  const [flatFiles, setFlatFiles] = useState(() => {
    // Initialize from localStorage tree if available
    if (saved?.fileTree) return flattenTree(saved.fileTree, null).map(mapFileRow);
    return [];
  });
  const fileTree = useMemo(() => buildTree(flatFiles), [flatFiles]);
  const [workflows, setWorkflows] = useState(() => {
    const raw = saved?.workflows || (saved?.workflow ? [saved.workflow] : null);
    if (!raw) return [];
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
  // When an admin enters a deprecated workshop via the admin dashboard, we
  // suppress the workshopEnded → GraduationScreen routing so they get the
  // full participant UI for browsing. Cleared on leave.
  const [bypassDeprecation, setBypassDeprecation] = useState(false);
  const [currentStage, setCurrentStage] = useState('6');
  // Per-stage reflection state. Tracks which stages this participant has
  // already submitted a reflection for; the pending stage is *derived*
  // from currentStage minus the submitted set. That way: live transitions,
  // refreshes, late joiners, and any prompts missed during the schema-
  // cache outage all surface the same way — the modal shows the lowest
  // unsubmitted reflection stage that the participant has advanced past.
  // null sentinel = "still loading from DB", which prevents a flash of
  // the modal before we know what's already submitted.
  const [submittedReflections, setSubmittedReflections] = useState(null);
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

  // Demographics gate. 'unknown' until we've checked the table; 'pending'
  // means the participant hasn't submitted the baseline questionnaire and
  // can't reach Chat; 'submitted' unlocks the rest of the app.
  const [demographicsStatus, setDemographicsStatus] = useState('unknown');
  const [savingDemographics, setSavingDemographics] = useState(false);
  const [demographicsError, setDemographicsError] = useState(null);

  const [activeDm, setActiveDm] = useState(null);
  const [unreadDmCounts, setUnreadDmCounts] = useState({});
  const activeDmRef = useRef(activeDm);
  useEffect(() => { activeDmRef.current = activeDm; }, [activeDm]);
  // Single DM event channel: App.jsx owns the subscribeToDms call; this state
  // fans the latest incoming DM out to ChatPanel (active-thread live updates)
  // via prop, instead of ChatPanel opening a second redundant subscription.
  // Saves one realtime channel per user — material near the free-tier 200 cap.
  const [latestIncomingDm, setLatestIncomingDm] = useState(null);
  // Outbox pending count — drives a small UI indicator so users see when
  // messages are queued locally waiting for network recovery.
  const [dmOutboxCount, setDmOutboxCount] = useState(() => outboxSnapshot().length);

  // Credit budget computation — lives here, after every state dependency
  // (myParticipantId, creditAllocation, myCreditBonus) is declared. Earlier
  // placement triggered a Temporal Dead Zone crash in production builds
  // because the minifier couldn't hoist the hook call above the useState
  // declarations it referenced.
  // Single source of truth for this user's usage — dedup-by-id inside the
  // hook means the credits budget gate can't get double-counted rows.
  const { total: myUsdSpend, tokenTotal: myTokenTotal } = useMyUsageTotal(sb, myParticipantId);
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
      // Per-stage reflection prompts are now driven by the
      // submittedReflections memo below, not by transition events —
      // so a refresh, late join, or schema-cache hiccup all still
      // surface any unanswered prompt the next render.
      // Graduation — the whole-room moment. Snap every participant
      // to the graduation tab so they see their scorecard together. Later
      // navigation away is fine; this only fires on the transition.
      // Stage 9 in the 9-stage arc.
      if (currentStage === '9') setActiveTab('graduation');
    }
    // Facilitator un-reveal safety net: if the active tab requires a stage
    // that's no longer reached (admin rolled the dial back), bounce to
    // Chat. Without this the participant would sit on a tab whose UI
    // depends on data the platform has now hidden, getting empty / broken
    // states. Chat is always available so it's the safe fallback.
    const TAB_STAGE_REQ = {
      files: '3', coworkers: '5', workflow: '6', activity: '7',
      usage: '8', graduation: '9',
    };
    const required = TAB_STAGE_REQ[activeTab];
    if (required && !stageReached(currentStage, required)) {
      setActiveTab('chat');
    }
  }, [currentStage, activeTab]);

  // Load the participant's existing reflections once we know who they
  // are. The set seeds the modal-driver memo below so a refresh, late
  // join, or post-outage retry all see any unanswered prompts they
  // would have got via a live transition.
  useEffect(() => {
    if (!myParticipantId || !sb) return;
    let cancelled = false;
    sb.loadMyStageReflections(myParticipantId).then(rows => {
      if (cancelled) return;
      setSubmittedReflections(new Set((rows || []).map(r => String(r.stage))));
    }).catch(() => {
      if (!cancelled) setSubmittedReflections(new Set());
    });
    return () => { cancelled = true; };
  }, [myParticipantId, sb]);

  // Demographics gate: as soon as we know the participant, peek at
  // participant_demographics. Null row = pending; any row = submitted.
  // Render branch below blocks the app shell until status === 'submitted'.
  useEffect(() => {
    if (!myParticipantId || !sb) return;
    let cancelled = false;
    setDemographicsStatus('unknown');
    sb.loadMyDemographics(myParticipantId).then(row => {
      if (cancelled) return;
      setDemographicsStatus(row ? 'submitted' : 'pending');
    }).catch(() => {
      if (!cancelled) setDemographicsStatus('pending');
    });
    return () => { cancelled = true; };
  }, [myParticipantId, sb]);

  async function handleSaveDemographics(payload) {
    setDemographicsError(null);
    setSavingDemographics(true);
    // Demographics only. Research consent is collected at workshop close
    // (FeedbackForm Section E) so participants give informed consent
    // having seen what their workshop activity actually contains.
    const res = await sb.saveDemographics({
      ...payload,
      participant_id: myParticipantId,
      participant_name: userName,
    });
    setSavingDemographics(false);
    if (res.ok) {
      setDemographicsStatus('submitted');
    } else {
      setDemographicsError(res.error || 'Could not save. Try again.');
    }
  }

  // Reflection stages, ordered. Memoised once because both inputs are
  // stable module-level constants.
  const reflectionStageList = useMemo(
    () => STAGE_ORDER.filter(s => REFLECTION_STAGES.has(s)),
    [],
  );

  // The lowest unsubmitted reflection stage the participant has already
  // advanced past. Drives the modal in JSX. Returns null while loading
  // (sentinel) or when nothing's pending.
  const pendingReflectionStage = useMemo(() => {
    if (!submittedReflections) return null;
    const currentIdx = STAGE_ORDER.indexOf(currentStage);
    if (currentIdx < 0) return null;
    for (const stage of reflectionStageList) {
      const stageIdx = STAGE_ORDER.indexOf(stage);
      if (stageIdx < currentIdx && !submittedReflections.has(stage)) {
        return stage;
      }
    }
    return null;
  }, [submittedReflections, currentStage, reflectionStageList]);

  const approvalResolversRef = useRef(new Map());
  // runId → true while an in-memory executor is alive for that run. Used by
  // orphan detection to tell "running, executor still here" apart from
  // "running, executor died on a refresh". Populated when runWorkflow fires
  // and cleared in its .finally().
  const liveExecutorsRef = useRef(new Set());
  // Per-run throttle of intermediate Supabase syncs. Keys: runId → timestamp
  // of last save. Used by updateRun/updateRunStep so participants in the
  // room see step transitions stream into the workflow_runs row instead of
  // only seeing the final terminal status.
  const lastRunSyncRef = useRef(new Map());
  const RUN_SYNC_THROTTLE_MS = 1000;
  // Optimistic set of runIds this user has just resolved as a remote reviewer.
  // Prevents the "Reviews waiting for you" card from flashing back until the
  // workflowRuns state catches up with the waiting_approval → running transition.
  const [resolvedRemoteRunIds, setResolvedRemoteRunIds] = useState(() => new Set());
  // Pending recipient-picker resolvers, keyed by picker message id. When the
  // user clicks a human in the picker, the resolver fires with that name.
  const pickRecipientResolversRef = useRef(new Map());
  const activeTabRef = useRef(activeTab);

  useEffect(() => { activeTabRef.current = activeTab; }, [activeTab]);

  // Mirror workflowRuns + sb.saveWorkflowRun into refs so the beforeunload
  // handler can read the latest values without re-registering on every change.
  const workflowRunsRef = useRef(workflowRuns);
  useEffect(() => { workflowRunsRef.current = workflowRuns; }, [workflowRuns]);
  const saveWorkflowRunRef = useRef(sb.saveWorkflowRun);
  useEffect(() => { saveWorkflowRunRef.current = sb.saveWorkflowRun; }, [sb.saveWorkflowRun]);

  // Mark in-flight runs 'interrupted' on tab close. Without this, runs whose
  // executor is killed mid-flight stay 'running' in Supabase forever and
  // appear orphaned in the room's Observability for everyone except the
  // owner. localStorage already gets flushed by the existing pagehide
  // handler — this is the Supabase-side belt to that suspenders.
  useEffect(() => {
    function markInterrupted() {
      const live = liveExecutorsRef.current;
      if (live.size === 0) return;
      const runs = workflowRunsRef.current || [];
      for (const r of runs) {
        if (!live.has(r.id)) continue;
        if (r.status !== 'running' && r.status !== 'waiting_approval') continue;
        // Best-effort fire-and-forget. Browser may not flush this fetch
        // depending on close timing — the orphan-detection banner is the
        // safety net for cases where the write doesn't land.
        saveWorkflowRunRef.current({ ...r, status: 'interrupted', completedAt: Date.now() });
      }
    }
    window.addEventListener('beforeunload', markInterrupted);
    window.addEventListener('pagehide', markInterrupted);
    return () => {
      window.removeEventListener('beforeunload', markInterrupted);
      window.removeEventListener('pagehide', markInterrupted);
    };
  }, []);

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
      // joinRoom and getUser are independent — joinRoom sets the room context
      // (roomIdRef, used by all the load functions below), getUser only reads
      // auth state. Running them in parallel saves one RTT over the old
      // sequential chain. Nepal → Tokyo ~120ms, so every RTT counts.
      Promise.all([sb.joinRoom(workshopCode, { allowDeprecated: bypassDeprecation }), sb.getUser()]).then(async ([result, authUser]) => {
        if (result?.credit_allocation != null) setCreditAllocation(result.credit_allocation);
        if (result?.error === 'deprecated') { setWorkshopEnded(true); return; }
        if (result?.error || !result?.id || !userName) return;
        if (result.current_stage) setCurrentStage(normalizeStage(result.current_stage));
        if (result.org_name) setOrgName(result.org_name);

        const myColor = participants.find(p => p.name === userName)?.color || COLORS[0];

        // Kick everything that depends on (roomId + authUser) in parallel.
        // Previously upsertParticipant → prefs → role ran sequentially and
        // gated the granular loads. Now all eight happen at once — RTT-bound
        // to the slowest, not the sum.
        const prefsPromise = authUser?.id ? sb.loadUserPreferences(authUser.id) : Promise.resolve(null);
        const rolePromise = authUser?.id ? sb.loadUserRole(authUser.id) : Promise.resolve(null);
        const mePromise = sb.upsertParticipant(userName, myColor, authUser?.id, authUser?.email);
        const [me, prefs, role, files, cws, tls, wfs, runs, dbParticipants] = await Promise.all([
          mePromise, prefsPromise, rolePromise,
          sb.loadFiles(), sb.loadCoworkers(), sb.loadTools(), sb.loadWorkflows(), sb.loadWorkflowRuns(), sb.loadParticipants(),
        ]);
        if (me?.id) {
          setMyParticipantId(me.id);
          // Fire-and-forget — admin-granted credit bonus is cosmetic on the
          // initial paint; no need to block the granular loads on it.
          sb.getParticipantById(me.id).then(p => setMyCreditBonus(p?.credit_bonus || 0));
        }
        if (authUser?.id) {
          setUserPreferences(prefs);
          setUserRole(role);
          setUserRoleLoaded(true);
        }

        // Merge DB rows into the localStorage-seeded list rather than
        // overwriting wholesale. Two failure modes the overwrite caused:
        //   1. Local content blown away — loadFiles returns metadata only,
        //      so the merge replaces flatFiles with bodies = undefined and
        //      the user sees every file as empty until they click it.
        //   2. Files that exist locally but haven't reached the DB yet
        //      (save in flight, save failed silently, realtime lag)
        //      disappear from the sidebar on refresh.
        // Same body-preservation rule as the realtime onFileChange handler.
        if (files.length > 0) {
          setFlatFiles(prev => {
            const byId = new Map((prev || []).map(f => [f.id, f]));
            for (const dbFile of files) {
              const local = byId.get(dbFile.id);
              const dbHasBody    = typeof dbFile.content === 'string' && dbFile.content.length > 0;
              const localHasBody = local && typeof local.content === 'string' && local.content.length > 0;
              if (!dbHasBody && localHasBody) {
                byId.set(dbFile.id, { ...dbFile, content: local.content });
              } else {
                byId.set(dbFile.id, dbFile);
              }
            }
            return [...byId.values()];
          });
        }
        if (cws.length > 0) {
          setCoworkers(prev => {
            const prevById = new Map((prev || []).map(c => [c.id, c]));
            return cws.map(cw => preserveToolConfigs(cw, prevById.get(cw.id)));
          });
        }
        setTools(ensurePrebuiltTools(tls));
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
            if (idx < 0) return [...prev, mapped];
            return prev.map(f => {
              if (f.id !== mapped.id) return f;
              // Realtime can deliver content as null / undefined / empty
              // for larger rows (parsed PDFs, AI-drafted knowledge files)
              // when the payload exceeds Supabase's per-message cap, or
              // when an UPDATE event omits the body. Replacing the local
              // row wholesale would erase the body until a refetch and —
              // worse — the next tree-wide save would write the empty
              // payload back to the DB, cementing the loss. Keep the
              // local body whenever the incoming payload doesn't bring a
              // real one. Mirrors flattenTree / saveFile's typeof check.
              const incomingHasBody = typeof mapped.content === 'string' && mapped.content.length > 0;
              const localHasBody = typeof f.content === 'string' && f.content.length > 0;
              if (!incomingHasBody && localHasBody) {
                return { ...mapped, content: f.content };
              }
              return mapped;
            });
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
            // Or if local has terminated and the DB echo says still-running
            // (legacy rows from before the rejected-sync fix), keep local.
            const TERMINAL = new Set(['completed', 'rejected', 'error', 'cancelled']);
            if (TERMINAL.has(local.status) && !TERMINAL.has(mapped.status)) return list;
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

        // Cross-user round-trip: when a reviewer on another client writes
        // their decision, the initiator's client picks it up here and fires
        // the pending resolver so the workflow continues. Same-user clicks
        // already fire and delete the resolver in handleApprovalAction before
        // the DB write round-trips, so this branch no-ops in that case.
        const resolver = approvalResolversRef.current.get(row.run_id);
        if (resolver) {
          approvalResolversRef.current.delete(row.run_id);
          resolver({
            action: row.action,
            comment: row.comment || '',
            resolvedBy: row.resolved_by || 'reviewer',
          });
          // Also flip any unresolved approval card in this run's conversation
          // so the initiator sees the reviewer's decision instead of stale
          // Approve/Reject buttons.
          setConversations(prev => prev.map(c => ({
            ...c,
            messages: (c.messages || []).map(m =>
              m.type === 'approval' && m.runId === row.run_id && !m.resolved
                ? { ...m, resolved: true, resolvedAction: row.action, resolvedComment: row.comment || '', resolvedBy: row.resolved_by || 'reviewer' }
                : m
            ),
          })));
        }
      },
      onRoomChange: (row) => {
        // Admins entering a deprecated workshop via the dashboard set the
        // bypass flag so they can browse the room normally; skip the
        // workshop-ended routing for them.
        if (row?.deprecated_at && !bypassDeprecation) setWorkshopEnded(true);
        if (row?.current_stage) setCurrentStage(normalizeStage(row.current_stage));
        if (row?.credit_allocation != null) setCreditAllocation(row.credit_allocation);
      },
      onReconnect: async () => {
        // Realtime reattached after a disconnect — refetch what matters
        // for workflow continuity AND cross-participant visibility. Any
        // INSERT/UPDATE events that fired during the offline window are
        // gone from the realtime stream; we catch up via snapshot.
        // Files used to be skipped on the assumption participants would
        // "naturally refetch when interacting", but they only do so for
        // the file's content (lazy-load on click). Metadata for files
        // created during the outage was never refetched, so other
        // participants' files vanished after stage transitions when
        // realtime saturation caused brief drops.
        try {
          const [runs, approvals, files] = await Promise.all([
            sb.loadWorkflowRuns(),
            sb.loadAllRoomApprovals(),
            sb.loadFiles(),
          ]);
          // Merge file metadata back in without clobbering any locally-
          // loaded content. DB rows give us the canonical metadata
          // (name, parent_id, created_by, sort_order); local rows that
          // already have a content string keep that body. Any local
          // rows not yet committed to the DB (in-flight saves) are
          // preserved as-is so we don't drop them.
          if (Array.isArray(files)) {
            setFlatFiles(prev => {
              const localById = new Map((prev || []).map(f => [f.id, f]));
              const dbIds = new Set(files.map(f => f.id));
              const merged = files.map(dbF => {
                const local = localById.get(dbF.id);
                if (local && typeof local.content === 'string' && local.content.length > 0) {
                  return { ...dbF, content: local.content };
                }
                return dbF;
              });
              for (const local of (prev || [])) {
                if (!dbIds.has(local.id)) merged.push(local);
              }
              return merged;
            });
          }
          if (runs?.length) {
            setWorkflowRuns(prev => {
              const TERMINAL = new Set(['completed', 'rejected', 'error', 'cancelled']);
              const byId = new Map((prev || []).map(r => [r.id, r]));
              for (const r of runs) {
                const local = byId.get(r.id);
                // Don't let a stale DB 'running' clobber a local terminal
                // state — that's how rejected runs flip back to "running"
                // after a reconnect when their terminal status hasn't synced
                // upstream yet (e.g. legacy rows from before the rejected
                // sync fix). Local terminal wins; otherwise DB is fresher.
                if (local && TERMINAL.has(local.status) && !TERMINAL.has(r.status)) continue;
                byId.set(r.id, r);
              }
              return [...byId.values()].sort((a, b) => a.startedAt - b.startedAt);
            });
          }
          if (approvals?.length) {
            setApprovalsByRun(prev => {
              const next = { ...(prev || {}) };
              for (const a of approvals) {
                const key = a.run_id;
                const existing = next[key] || [];
                if (!existing.find(x => x.id === a.id)) {
                  next[key] = [...existing, a].sort((x, y) =>
                    new Date(x.resolved_at).getTime() - new Date(y.resolved_at).getTime()
                  );
                }
              }
              return next;
            });
          }
        } catch (err) {
          console.warn('[app] reconnect refetch failed:', err?.message || err);
        }
        // Also flush any outbound DMs queued while offline.
        flushDmOutbox(sb)
          .then(({ remaining }) => setDmOutboxCount(remaining))
          .catch(err => console.warn('[outbox] reconnect flush:', err?.message || err));
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

  // Single room-wide DM subscription — handles three concerns:
  //   1. Fan the event to ChatPanel (active-thread live updates) via
  //      setLatestIncomingDm, so ChatPanel doesn't need its own subscription.
  //   2. Bump the unread badge for messages to me that aren't currently open.
  //   3. Resolve the sender's name from local `participants` state first so
  //      we don't issue a getParticipantById DB call for every incoming DM.
  useEffect(() => {
    if (!myParticipantId) return;
    const unsub = sb.subscribeToDms(myParticipantId, async (dm) => {
      // Fan out to ChatPanel regardless of involvement — ChatPanel filters
      // again for the active thread. The subscription filter on the hook
      // side already drops DMs not involving me, so this is bounded.
      setLatestIncomingDm(dm);

      // Unread badge updates only for messages TO me where the thread isn't open.
      if (dm.to_participant_id !== myParticipantId) return;
      if (activeDmRef.current?.id === dm.from_participant_id) return;

      // Prefer the in-memory participants list. DB fallback only if the
      // sender isn't cached locally (rare — mostly AI coworker mirrors or
      // brand-new joiners whose presence hasn't synced yet).
      const cached = (participants || []).find(p => p.id === dm.from_participant_id);
      let senderName = cached?.name;
      if (!senderName) {
        const sender = await sb.getParticipantById(dm.from_participant_id);
        senderName = sender?.name;
      }
      if (!senderName) return;
      setUnreadDmCounts(prev => ({
        ...prev,
        [senderName]: (prev[senderName] || 0) + 1,
      }));
    });
    return unsub;
  }, [myParticipantId, sb, participants]);

  // On mount and periodically thereafter, drain any DMs that were queued
  // locally (network dropped mid-session, tab closed with unsent messages,
  // previous session left a partial send). The interval keeps trying
  // slowly until the queue is empty — successful sends remove themselves.
  useEffect(() => {
    if (!myParticipantId) return;
    let cancelled = false;
    const tryFlush = async () => {
      if (cancelled) return;
      try {
        const { remaining } = await flushDmOutbox(sb);
        if (!cancelled) setDmOutboxCount(remaining);
      } catch (err) {
        // Don't let a transient flush failure throw an unhandled rejection
        // and silently break the interval. We'll retry on the next tick.
        console.warn('[outbox] flush threw:', err?.message || err);
      }
    };
    tryFlush();
    const interval = setInterval(tryFlush, 15_000);
    // Flush on tab regaining focus — most common recovery trigger.
    const onFocus = () => tryFlush();
    window.addEventListener('focus', onFocus);
    window.addEventListener('online', onFocus);
    return () => {
      cancelled = true;
      clearInterval(interval);
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('online', onFocus);
    };
  }, [myParticipantId, sb]);

  // Reflect unread count in browser tab title.
  useEffect(() => {
    const total = Object.values(unreadDmCounts).reduce((a, b) => a + b, 0);
    document.title = total > 0 ? `(${total}) Foundry` : 'Foundry';
  }, [unreadDmCounts]);

  async function handleJoin(name, code, authUserId, email, options = {}) {
    try {
      return await runHandleJoin(name, code, authUserId, email, options);
    } catch (err) {
      console.error('[join] handleJoin threw:', err);
      return { error: 'join_failed', message: err?.message || 'Unknown error joining workshop' };
    }
  }

  async function runHandleJoin(name, code, authUserId, email, options = {}) {
    // `bypassDeprecation` lets admins entering from the dashboard browse
    // delivered workshops without being trapped on the GraduationScreen.
    setBypassDeprecation(!!options.bypassDeprecation);
    const result = await sb.joinRoom(code, { allowDeprecated: !!options.bypassDeprecation });
    if (result?.error) return result;
    const roomId = result.id;
    if (result.current_stage) setCurrentStage(normalizeStage(result.current_stage));
    if (result.credit_allocation != null) setCreditAllocation(result.credit_allocation);
    if (result.org_name) setOrgName(result.org_name);

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
      setTools(ensurePrebuiltTools(tls || []));
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
    }).catch(err => console.error('[join] loadParticipants:', err?.message || err));

    setUserName(name);
    setWorkshopCode(code);
    setWorkflowRuns(runs);
    if (starterLogs.length > 0) setLogs(starterLogs);
    setParticipants(newParticipants);
    setSelectedDeptId(saved?.selectedDeptId || 'dept-credit');
    setIsJoined(true);
    persistLocal({ userName: name, workshopCode: code, workflows, coworkers, tools, workflowRuns: runs, participants: newParticipants, selectedDeptId: saved?.selectedDeptId || 'dept-credit' });
  }

  async function handleReset() {
    const ok = await confirm({
      title: 'Clear local content',
      message: 'This will clear all your local content (files, coworkers, workflows, chats). Continue?',
      confirmLabel: 'Clear',
      danger: true,
    });
    if (!ok) return;
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
    // Files added in this update — newly-created with a content body.
    // We've seen real production rows where saveFilesBatch landed the
    // metadata but lost the content (NULL in the DB), most likely
    // because concurrent migration-driven batch writes from other
    // clients during a stage transition raced this one. Fire an
    // explicit single-row saveFile for each new file so the body has
    // a guaranteed dedicated upsert that doesn't share a payload with
    // anyone else's tree.
    const addedFilesWithContent = newFlat.filter(f =>
      f.type === 'file'
      && !prevIds.has(f.id)
      && typeof f.content === 'string'
      && f.content.length > 0
    );
    setFlatFiles(newFlat);
    for (const f of addedFilesWithContent) {
      sb.saveFile(f);
    }
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

  // Lazy content loader: loadFiles now returns metadata only (no `content`).
  // Callers that want to display or edit a file's body call this on open.
  // Cheap: a single-row SELECT by id.
  //
  // Skip only when we already have a real string body cached. `undefined` is
  // "never loaded"; `null` slips in when a realtime postgres_changes payload
  // for a large file is truncated above Supabase's row-size cap (a parsed
  // PDF body easily blows past it) — without this guard, the user clicks
  // the file, the bail-out fires, and they see "This file is empty" forever
  // because the truncated null was cached as if it were the real value.
  async function handleEnsureFileContent(fileId) {
    if (!fileId) return;
    const existing = flatFiles.find(f => f.id === fileId);
    if (!existing) return;
    if (typeof existing.content === 'string' && existing.content.trim().length > 0) return;
    let content = await sb.loadFileContent(fileId);
    // Fallback: any System-seeded example file whose DB body lands empty
    // gets restored from the canonical content shipped in exampleArtifacts.
    // Some rooms passed through Stage 3-4-8 before content seeding was
    // reliable, leaving the row with metadata only. No DB write here —
    // RLS may not allow participants to write System-owned rows, and the
    // local fallback is enough to display.
    if ((!content || content.trim().length === 0) && EXAMPLE_FILE_CONTENT[fileId]) {
      content = EXAMPLE_FILE_CONTENT[fileId];
    }
    // Only cache a non-empty string. If the DB returned null / empty and
    // there's no example fallback, leave the row's content as null — that
    // way flattenTree (which only carries content when typeof === 'string')
    // won't propagate an empty string forward on the next tree-wide save
    // and overwrite a real DB body that may arrive shortly after via a
    // realtime echo. The earlier `content ?? ''` was cementing empty into
    // the DB the moment any other tree-touching action ran (e.g. a stage
    // transition firing the FileExplorer migration effect).
    const next = (typeof content === 'string' && content.length > 0) ? content : null;
    setFlatFiles(prev => prev.map(f => f.id === fileId ? { ...f, content: next } : f));
  }

  // Self-heal: the seeded "reference.md" example file (formerly blueprint.md)
  // lands in some existing rooms with empty content — either because the
  // room transitioned through Stage 8 before the file got a body, or
  // because an older migration cleared it. Once per mount, when we see the
  // file in flatFiles, unconditionally upsert the canonical body. Safe to
  // overwrite because the file is System-owned and read-only in the live UI.
  const referenceRestoreAttempted = useRef(false);
  useEffect(() => {
    if (!sb || referenceRestoreAttempted.current) return;
    const exampleFile = (flatFiles || []).find(f => f.id === EXAMPLE_BLUEPRINT_FILE_ID);
    if (!exampleFile) return;
    referenceRestoreAttempted.current = true;
    sb.saveFile({
      id: EXAMPLE_BLUEPRINT_FILE_ID,
      room_id: sb.getRoomId(),
      parent_id: EXAMPLE_BLUEPRINTS_FOLDER_ID,
      name: 'reference.md',
      type: 'file',
      sort_order: 0,
      created_by: 'System',
      content: CAPSTONE_BLUEPRINT,
    });
    // Reflect locally so the next click on the file shows content without
    // waiting for a refetch.
    setFlatFiles(prev => prev.map(f => f.id === EXAMPLE_BLUEPRINT_FILE_ID
      ? { ...f, content: CAPSTONE_BLUEPRINT, name: 'reference.md' }
      : f));
  }, [sb, flatFiles]);

  // Batch version for AI-consumption paths (chat send, workflow run). Any
  // context / skill / instruction file referenced in a prompt MUST have its
  // body loaded or the model sees empty context. One roundtrip covers N
  // files; files already hydrated are filtered out.
  //
  // Returns the fresh flatFiles array so callers can build a hydrated
  // fileTree *in this tick* without waiting for React to re-render — the
  // setFlatFiles update below only takes effect on the next render, but
  // handleSendMessage / runWorkflow need to read content synchronously
  // right after the await.
  async function handleEnsureFilesContent(fileIds) {
    if (!fileIds || fileIds.length === 0) return flatFiles;
    const missing = [];
    const seen = new Set();
    for (const id of fileIds) {
      if (!id || seen.has(id)) continue;
      seen.add(id);
      const f = flatFiles.find(x => x.id === id);
      // Same realtime-truncation defence as handleEnsureFileContent — treat
      // null cache as "not loaded" so chat/workflow context isn't built from
      // an empty body that came from a dropped realtime payload.
      if (f && typeof f.content !== 'string') missing.push(id);
    }
    if (missing.length === 0) return flatFiles;
    const byId = await sb.loadFilesContent(missing);
    const next = flatFiles.map(f =>
      byId[f.id] !== undefined ? { ...f, content: byId[f.id] } : f
    );
    setFlatFiles(next);
    return next;
  }

  function handleUpdateWorkflows(newWorkflows) {
    // Always normalize to the DAG shape so nodes[]+edges[] ride alongside
    // steps[] in local state and in the DB. Diff against previous state so:
    //   - removed workflows get hard-deleted from Supabase (otherwise a
    //     deleted workflow reappears on the next reload/realtime sync
    //     because its row still exists)
    //   - only *changed* workflows get re-upserted (a single rename used to
    //     trigger a write of every workflow in the room — the copilot, which
    //     fires onWorkflowUpdate per tool call, was the worst case)
    const normalized = (newWorkflows || []).map(ensureDagShape);
    const prevById = new Map((workflows || []).map(w => [w.id, w]));
    const nextIds = new Set(normalized.map(w => w.id));
    const removedIds = [...prevById.keys()].filter(id => !nextIds.has(id));
    setWorkflows(normalized);
    for (const wf of normalized) {
      const prev = prevById.get(wf.id);
      // Cheap structural compare: stringify both. Workflows are small JSON
      // (steps + nodes + edges), so this is fast enough to run inline. A
      // shallow ref-equal check would miss in-place edits the existing
      // codepath does; a deep equal pulls in lodash. JSON.stringify is the
      // pragmatic middle.
      if (!prev || JSON.stringify(prev) !== JSON.stringify(wf)) {
        sb.saveWorkflow(wf);
      }
    }
    for (const id of removedIds) sb.deleteWorkflow(id);
    persistLocal({ workflows: newWorkflows });
  }

  // Materialise ScenarioBuilder rows + caseInput into a runnable workflow,
  // persist it, run it, and flip to Observability. The workflow object is
  // passed straight to runWorkflow (the runWorkflow signature accepts a
  // workflow object) so we don't have to wait for setWorkflows to commit
  // before we can run it.
  async function handleRunCaseWorkflow(rows, caseInput, workflowName) {
    console.log('[handleRunCaseWorkflow] entered', {
      rowCount: (rows || []).length,
      caseInputLen: (caseInput || '').length,
      workflowName,
      hasUserName: !!userName,
      hasMyParticipantId: !!myParticipantId,
      creditsExhausted,
      creditsLeft,
    });
    if (!Array.isArray(rows) || rows.length === 0) {
      console.warn('[handleRunCaseWorkflow] aborted — no rows');
      return;
    }

    // Build an INLINE coworker per Coworker row — used by the executor for
    // this run only. We deliberately don't save these into the Coworkers
    // table: that would pollute the participant's library with a new row
    // every Run click, and it would collapse the Stage 5 vs Stage 6
    // distinction (Stage 5 is where you build coworkers; Stage 6 should
    // use them, not silently mint more).
    //
    // The executor's agent path falls back through `step.coworker` first
    // (embedded), then `step.coworkerId` lookup — so an inline-only
    // coworker runs identically to a saved one for this step's purposes.
    // Saved-mode rows point at an existing coworker (built in Stage 5).
    // We pass the saved row through verbatim — same shape the executor
    // expects — so the participant's library is the single source of
    // truth for that coworker's role, files, and tools. Inline-mode rows
    // continue to mint a one-off inline coworker for this run.
    const coworkerByRowId = new Map();
    for (const r of rows) {
      if (r.type !== 'coworker') continue;
      if (r.source === 'saved' && r.coworkerId) {
        const saved = (coworkers || []).find(c => c.id === r.coworkerId);
        if (saved) {
          coworkerByRowId.set(r.id, saved);
          continue;
        }
        // Saved id no longer resolves (deleted in Stage 5 between save +
        // run). Fall through to the inline path so the run doesn't crash;
        // it'll execute as a blank coworker and the user will see why.
      }
      const name = (r.name || '').trim() || deriveCoworkerName(r.step) || 'Coworker';
      const cw = {
        id: 'cw-inline-' + Math.random().toString(36).slice(2, 8),
        name,
        role: (r.step || '').trim(),
        avatar: 'icon:' + COWORKER_ICONS[Math.floor(Math.random() * COWORKER_ICONS.length)],
        color: CAPSTONE_COWORKER_COLORS[Math.floor(Math.random() * CAPSTONE_COWORKER_COLORS.length)],
        instructionFileIds: r.skillsFileIds || [],
        knowledgeFileIds: r.knowledgeFileIds || [],
        toolIds: [],
        createdBy: userName,
        createdAt: Date.now(),
      };
      coworkerByRowId.set(r.id, cw);
    }

    // Build the workflow: trigger → step1 → step2 → ... — strictly linear,
    // edges chain forward only. The trigger holds the case input so the
    // executor pulls it via its standard caseInput resolution.
    const wfId = 'wf-' + (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
    const triggerId = 'trigger-' + wfId;
    const triggerStep = { id: triggerId, type: 'trigger', name: 'Case', caseInput };
    const builtSteps = [triggerStep];
    for (const r of rows) {
      const id = 'step-' + Math.random().toString(36).slice(2, 10);
      if (r.type === 'human') {
        const reviewer = (participants || []).find(p => p.id === r.reviewerId)
          || { id: r.reviewerId, name: r.reviewerName };
        builtSteps.push({
          id,
          type: 'approval',
          name: (r.step || 'Review').trim().slice(0, 60) || 'Review',
          prompt: (r.step || '').trim(),
          assigneeId: reviewer.id,
          assigneeName: reviewer.name || r.reviewerName,
        });
      } else {
        const cw = coworkerByRowId.get(r.id);
        builtSteps.push({
          id,
          type: 'agent',
          name: cw?.name || 'Coworker',
          coworkerId: cw?.id,
          coworker: cw,
        });
      }
    }
    // Linear edges: trigger → step1 → step2 → ... → stepN
    const edges = [];
    for (let i = 0; i < builtSteps.length - 1; i++) {
      edges.push({
        id: `e-${builtSteps[i].id}-${builtSteps[i + 1].id}`,
        source: builtSteps[i].id,
        target: builtSteps[i + 1].id,
      });
    }
    // Nodes mirror steps (positions don't matter — we don't render a
    // canvas — but the executor reads from steps[]+edges[], not nodes[],
    // so this is just for shape parity with legacy workflows).
    const nodes = builtSteps.map((s, i) => ({
      id: s.id, type: s.type, position: { x: 240, y: i * 120 }, data: { ...s },
    }));
    const newWf = {
      id: wfId,
      name: (workflowName || '').trim() || (caseInput || '').trim().slice(0, 60) || 'Case run',
      steps: builtSteps,
      nodes,
      edges,
      createdBy: userName,
      createdAt: Date.now(),
    };

    // Persist to local + DB so the run shows up in the workflows list and
    // future revisits restore it.
    handleUpdateWorkflows([...(workflows || []), newWf]);
    // Flip to Observability and kick off the run with the workflow object
    // directly — no need to wait for setWorkflows to commit.
    console.log('[handleRunCaseWorkflow] workflow built, kicking off run', {
      workflowId: newWf.id,
      stepCount: newWf.steps.length,
      edgeCount: newWf.edges.length,
    });
    setActiveTab('activity');
    runWorkflow(newWf, caseInput);
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
    // Two-state setters here used to live inside the setConversations
    // updater. React 18 strict mode runs updaters twice, which made the
    // nested setActiveConvoId fire with stale data and the click "do
    // nothing." Run the lookup outside the updater so each setState
    // call is idempotent.
    const existing = (conversations || []).find(c => c.coworkerId === cwId);
    if (existing) {
      setActiveConvoId(existing.id);
      return;
    }
    const coworker = (coworkers || []).find(c => c.id === cwId);
    const newConvo = {
      id: 'convo-' + Date.now() + '-' + Math.random().toString(36).slice(2, 5),
      title: coworker?.name || 'Chat',
      coworkerId: cwId,
      createdAt: Date.now(),
      messages: [],
    };
    const updated = [...(conversations || []), newConvo];
    setConversations(updated);
    setActiveConvoId(newConvo.id);
    persistConversations(updated);
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
      // When activeConvoId is null (first send in a fresh chat before the
      // state flush has propagated), target the most recent convo instead
      // of no-op'ing — addMessage has just created it and is about to set
      // it active on the next tick. Otherwise the loading bubble, status
      // updates, etc. silently vanish.
      const targetId = activeConvoId || prev[prev.length - 1]?.id;
      if (!targetId) return prev;
      const updated = prev.map(c => {
        if (c.id !== targetId) return c;
        return { ...c, messages: updater(c.messages) };
      });
      persistConversations(updated);
      return updated;
    });
  }

  function addLog(entry) {
    // Cap at 500 most-recent. A 6-hour workshop accumulates many entries
    // (every workflow step, every approval, every nudge); without a cap the
    // logs array grows unbounded and every render walks the whole list.
    setLogs(prev => [...prev, { timestamp: Date.now(), ...entry }].slice(-500));
  }

  // ===== Intent classifier (platform chat) =====
  // Tiny Haiku call that decides whether a user message needs platform-tool
  // access or is pure Q&A. Used to skip the 12-tool schema on ~70% of turns,
  // which drops those turns from ~$0.002 to ~$0.0007. Classifier itself costs
  // ~$0.0003. Defaults to "action" on any error so tool access isn't silently
  // lost — quality over cost when in doubt.
  // Heuristic intent classifier — replaces a per-message Haiku roundtrip
  // (~200-400ms + cost) with local regex. At 35-person scale the previous
  // LLM classifier added latency to every message and non-trivial spend.
  // Defaults to 'action' on uncertainty — matches the prior model's bias
  // so we never silently drop a platform-affecting request.
  function classifyPlatformIntent(userMessage) {
    const text = String(userMessage || '').trim().toLowerCase();
    if (!text) return 'action';

    // "chat" cues: conceptual questions, small talk, thanks. Tight so we
    // don't swallow an action phrased as a question ("how do I create…" is
    // still an action because the verb is 'create').
    const chatPatterns = [
      /^(hi|hey|hello|yo|hola|namaste|thanks|thank you|cheers|ok|okay|cool|nice|great)[\s.!?]*$/,
      /^(what|how|why|when|where|who)\s+(is|are|does|do|can|should|would|might)\b/,
      /\b(explain|describe|tell me about|help me understand)\b/,
      /\b(concept|definition|difference between|pros and cons|best practice)\b/,
    ];
    for (const re of chatPatterns) if (re.test(text)) return 'chat';

    // Everything else → action. Matches the LLM's "default to action" rule.
    return 'action';
  }

  // ===== Claude API =====
  // Default segment 'chat' is correct for the free-text chat surface; callers
  // with a different context (refine_description, scorecard, etc.) should
  // pass options.segment explicitly.
  async function callClaudeAPI(systemPrompt, userMessage, options = {}) {
    // Default model is Haiku 4.5. Sonnet's RPM tier limits were the
    // bottleneck during cohort-scale load — every participant's coworker
    // chat and workflow-run step landed on the same bucket. Haiku 4.5 has
    // far higher ceilings and handles the shapes of output these paths
    // produce (policy checks, short assessments, structured summaries)
    // with minimal quality loss. Callers that genuinely need deeper
    // reasoning can pass `options.model` explicitly.
    const model = options.model || 'claude-haiku-4-5-20251001';
    try {
      const response = await callClaudeProxy(supabaseClient, {
        model,
        // 600 tokens covers the vast majority of coworker chat + workflow
        // step outputs (most finish under 500). Tighter cap directly
        // reduces TPM pressure during cohort-scale load, where the single
        // shared Anthropic org is the bottleneck. Structured assessments
        // truncate gracefully at this ceiling. Callers that need more
        // headroom (the AI auditor at Stage 8 needs ~4000 to write
        // structured findings across many artefacts) can override.
        max_tokens: options.max_tokens || 600,
        // Cache the system prompt so repeated turns with the same coworker /
        // skills / knowledge hit the 10x-cheaper cache_read rate. Claude
        // ignores cache_control below its 1024-token minimum gracefully.
        ...(systemPrompt ? { system: [{ type: 'text', text: systemPrompt, cache_control: { type: 'ephemeral' } }] } : {}),
        messages: [{ role: 'user', content: userMessage }],
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
    // Haiku 4.5 for the agentic coworker loop — same reasoning as the
    // default above. Multi-participant coworker chats were the other big
    // Sonnet consumer during load. Haiku handles tool_use reliably.
    const model = 'claude-haiku-4-5-20251001';
    // 'coworker_chat' for any coworker-backed turn; 'workflow_run' when the
    // workflow runner invokes this function via its own wrapper (sets
    // usageSegment explicitly). Falls back to chat for safety.
    const segment = usageSegment || (coworker ? 'coworker_chat' : 'chat');

    while (turns < 10) {
      turns++;
      try {
        const response = await callClaudeProxy(supabaseClient, {
          model,
          // Tool-calling turns rarely need more than ~1000 tokens — the
          // assistant's narration around tool calls is usually short.
          // 1200 leaves headroom for the occasional longer synthesis
          // turn without blowing up TPM across a cohort.
          max_tokens: 1200,
          // System prompt (role + skills + knowledge + tool guidance) is
          // identical across turns of a coworker chat — cache it. Tools
          // are also marked cacheable via the last-tool trick above.
          ...(systemPrompt ? { system: [{ type: 'text', text: systemPrompt, cache_control: { type: 'ephemeral' } }] } : {}),
          messages,
          tools: claudeToolsCached,
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
          // Uses path-clone updates instead of full deep-clone so the
          // tool-call burst during a workflow run doesn't re-serialize
          // the whole tree on every file write.
          const writeCoworkerFile = (name, content) => {
            const newFile = {
              id: 'f-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7),
              name,
              type: 'file',
              content,
              createdBy: userName,
            };
            const cfg = coworker?.toolConfigs?.['builtin-create-file'];
            // Pick the target folder by id (configured) or fall back to the
            // first top-level folder. We read from the live fileTree, not
            // a clone, since findInTree is read-only.
            const topChildren = fileTree.children || [];
            const configuredFolder = cfg?.folderId
              ? topChildren.find(c => c.id === cfg.folderId && c.type === 'folder')
              : null;
            const targetFolder = configuredFolder || topChildren.find(c => c.type === 'folder');
            const subName = cfg?.subfolder === 'skills' ? 'skills' : 'knowledge';
            const sub = targetFolder
              ? (targetFolder.children || []).find(c => c.type === 'folder' && c.name === subName)
              : null;
            const parentId = sub ? sub.id : (targetFolder ? targetFolder.id : fileTree.id);
            const newTree = addChildToTree(fileTree, parentId, newFile);
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

              const sent = await submitDm(sb, coworkerParticipantId, humanId, message);
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
    // Mutable context so consecutive tool calls in one turn see each other's changes
    const platformCtx = {
      fileTree,
      tools,
      coworkers,
      workflows,
      userName,
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
        const response = await callClaudeProxy(supabaseClient, {
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
  // Statuses that bypass the throttle and sync immediately. Terminal
  // statuses must sync so the room sees the run finish; 'waiting_approval'
  // must sync so the assigned reviewer's browser sees the run reach the
  // pause point and renders the inline approval card / pending-reviews
  // banner. Without 'waiting_approval' here, the throttle silently drops
  // the status transition because step.status='waiting' and
  // run.status='waiting_approval' both fire in the same React batch and
  // only the first sync gets through.
  const FORCE_SYNC_STATUSES = new Set(['completed', 'error', 'cancelled', 'rejected', 'interrupted', 'waiting_approval']);

  function syncRunToSupabase(run, forceSync) {
    if (!run) return;
    if (forceSync) {
      lastRunSyncRef.current.delete(run.id);
      sb.saveWorkflowRun(run);
      return;
    }
    const now = Date.now();
    const last = lastRunSyncRef.current.get(run.id) || 0;
    if (now - last < RUN_SYNC_THROTTLE_MS) return;
    lastRunSyncRef.current.set(run.id, now);
    sb.saveWorkflowRun(run);
  }

  function updateRun(runId, updates) {
    setWorkflowRuns(prev => {
      const updated = prev.map(r => r.id === runId ? { ...r, ...updates } : r);
      persistLocal({ workflowRuns: updated });
      const run = updated.find(r => r.id === runId);
      // Sync to Supabase: force-sync statuses (terminal + waiting_approval)
      // fire immediately so the room sees the state change without delay;
      // other updates throttle so participants get progress without a
      // write per step transition.
      const forceSync = FORCE_SYNC_STATUSES.has(updates.status);
      syncRunToSupabase(run, forceSync);
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
      // Step-level updates are always intermediate (a step's status moving
      // to 'completed' doesn't end the run — only the run-level status
      // does). Throttle the sync so participants still see progress stream
      // in but we don't write per keystroke-equivalent transition.
      const run = updated.find(r => r.id === runId);
      syncRunToSupabase(run, false);
      return updated;
    });
  }

  async function runWorkflow(workflowOrId, autoInput) {
    // Accept either a workflow id (the existing canvas/run-button path) or
    // a full workflow object (the new ScenarioBuilder path, where the
    // workflow was just materialised from rows and isn't in `workflows`
    // state yet for this render). Object form skips the lookup so we
    // don't have to wait a tick for setWorkflows to commit.
    const workflow = typeof workflowOrId === 'string'
      ? workflows.find(w => w.id === workflowOrId)
      : workflowOrId;
    if (!workflow) return;
    // Re-bind workflowId so the rest of the function — which was written
    // around the old signature where workflowId was the parameter — keeps
    // working. Without this rebinding, line ~2188's `workflowId,` is an
    // undefined reference and the run dies with a ReferenceError after the
    // dangling-leaf warning fires but before executeWorkflowRun starts.
    const workflowId = workflow.id;

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

    // Capture-terminal heads-up. The Capture step is the workflow's
    // compounding affordance — without an edge into it, the run produces
    // nothing that future participants can read. Workshop posture is to
    // warn, not block: the executor already soft-lands missing Capture,
    // and a hard block at run start prevents participants from iterating
    // on partial workflows. Walk forward from the trigger and surface
    // unwired leaves as a status note.
    {
      const steps = workflow.steps || [];
      const stepById = new Map(steps.map(s => [s.id, s]));
      const forwardOut = new Map();
      for (const e of (workflow.edges || [])) {
        if (e.sourceHandle === 'rejected') continue;
        if (!forwardOut.has(e.source)) forwardOut.set(e.source, []);
        forwardOut.get(e.source).push(e);
      }
      const trigger = steps.find(s => s.type === 'trigger');
      const danglingLeaves = [];
      if (trigger) {
        const visited = new Set();
        const walk = (id) => {
          if (visited.has(id)) return;
          visited.add(id);
          const out = forwardOut.get(id) || [];
          if (out.length === 0) {
            const step = stepById.get(id);
            if (step && step.type !== 'capture') {
              danglingLeaves.push(step.name || step.type || id);
            }
            return;
          }
          for (const e of out) walk(e.target);
        };
        walk(trigger.id);
      }
      if (danglingLeaves.length > 0) {
        addMessage({
          type: 'status',
          content: `Heads up — these steps don't reach Capture: ${danglingLeaves.join(', ')}. The run will still execute; wire them into Capture if you want their output to compound into a knowledge file.`,
        });
      }
    }

    // Hydrate all file content the workflow will actually touch: the Trigger's
    // attached documents plus every step coworker's instruction/knowledge
    // files. loadFiles returns metadata-only now, so without this the
    // executor silently sends empty bodies to the model.
    const allWorkflowFileIds = new Set();
    for (const step of (workflow.steps || [])) {
      for (const id of (step.fileIds || [])) allWorkflowFileIds.add(id);
      const stepCw = step.coworker || (step.coworkerId ? coworkers?.find(c => c.id === step.coworkerId) : null);
      if (stepCw) {
        for (const id of (stepCw.instructionFileIds || [])) allWorkflowFileIds.add(id);
        for (const id of (stepCw.knowledgeFileIds || [])) allWorkflowFileIds.add(id);
      }
    }
    const hydratedWorkflowFlat = await handleEnsureFilesContent([...allWorkflowFileIds]);
    const hydratedWorkflowTree = hydratedWorkflowFlat === flatFiles ? fileTree : buildTree(hydratedWorkflowFlat);

    // Case input is assembled from the Trigger step's two fields:
    // Instructions (free text) + Documents (file picks from the workspace).
    // autoInput remains a backdoor for programmatic callers (tests, replays).
    let caseInput = autoInput || null;
    if (!caseInput) {
      const triggerStep = (workflow.steps || []).find(s => s.type === 'trigger');
      const instructions = triggerStep?.caseInput?.trim() || '';
      const fileIds = triggerStep?.fileIds || [];
      const docs = fileIds
        .map(id => hydratedWorkflowFlat.find(f => f.id === id))
        .filter(f => f && (f.content || '').trim())
        .map(f => `### ${f.name}\n${f.content.trim()}`);
      const parts = [];
      if (instructions) parts.push(`## Instructions\n${instructions}`);
      if (docs.length > 0) parts.push(`## Documents\n${docs.join('\n\n')}`);
      caseInput = parts.length > 0 ? parts.join('\n\n') : null;
    }
    if (!caseInput) {
      addMessage({ type: 'error', content: 'Add instructions or pick at least one document in the Trigger before running.' });
      return;
    }

    const runId = 'run-' + crypto.randomUUID();

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
        // Resolve the assignee participant. Prefer id match (fast path),
        // fall back to name match if the stored id has drifted (e.g. a
        // synthetic 'p-…' from a pre-sync session). Without the fallback,
        // existing workflows built before the WorkflowBuilder started
        // storing assigneeName lose their assignee on every run.
        let person = step.assigneeId ? participants?.find(p => p.id === step.assigneeId) : null;
        if (!person && step.assigneeName) {
          person = participants?.find(p => p.name === step.assigneeName) || null;
        }
        return {
          stepId: step.id,
          stepName: step.type === 'agent' ? (cw?.name || step.name) : step.name,
          type: step.type,
          coworkerName: cw?.name || null,
          coworkerAvatar: cw?.avatar || null,
          // Both id and name. The "Reviews waiting for you" banner now
          // matches on assigneeId vs. myParticipantId (rock-solid) and
          // falls back to assigneeName for legacy run records that pre-
          // date this field. Name-only matching was breaking when the
          // assignee's userName state diverged even slightly from their
          // participant.name (case, trailing space, post-rejoin renames).
          // Use the resolved participant's id where possible so synthetic
          // 'p-…' fallbacks don't propagate into the run record.
          assigneeId: person?.id || step.assigneeId || null,
          assigneeName: person?.name || step.assigneeName || null,
          status: 'pending',
          output: null,
          completedAt: null,
        };
      }),
    };

    setWorkflowRuns(prev => [...prev, newRun]);
    sb.saveWorkflowRun(newRun);
    liveExecutorsRef.current.add(runId);

    // Pre-create one dedicated chat per run so every status line / agent
    // reply / approval note lands in a single conversation rather than
    // spawning a new "New Chat" for each message (which it used to, because
    // addMessage falls back to creating a convo when activeConvoId is stale).
    // Title pulls a clean snippet off the Trigger's Instructions so ten runs
    // of the same workflow read as ten distinct pieces of work instead of a
    // stack of "Run: New Workflow" — the workflow name tails the snippet as
    // a subtle suffix.
    const runConvoId = 'convo-run-' + runId;
    const snippet = (() => {
      const trigger = (workflow.steps || []).find(s => s.type === 'trigger');
      const raw = (trigger?.caseInput || '').replace(/^#+\s*/gm, '').replace(/\s+/g, ' ').trim();
      if (!raw) return null;
      return raw.length > 45 ? raw.slice(0, 45).replace(/\s+\S*$/, '') + '\u2026' : raw;
    })();
    const runTitle = snippet ? `${snippet} \u2014 ${workflow.name}` : `Run: ${workflow.name}`;
    setConversations(prev => [...prev, {
      id: runConvoId,
      title: runTitle,
      createdAt: Date.now(),
      messages: [],
    }]);
    // Focus the new run's chat so the user sees its status lines and agent
    // replies stream in. Without this, a second run's output lands in a
    // conversation the user isn't looking at and the run feels broken.
    setActiveConvoId(runConvoId);

    // Enrich workflow steps with assigneeName looked up from participants.
    // The workflow stores assigneeId only; the executor needs the name on
    // each step so the approval card it emits carries the assignee's name.
    // Without this, the chat-side check that hides the Approve/Reject
    // buttons on non-assignees can't tell who to gate against and falls
    // back to "anyone can review" — leaving buttons visible on the run
    // starter's view even when the review belongs to someone else.
    const enrichedWorkflow = {
      ...workflow,
      steps: (workflow.steps || []).map(s => {
        if (s.type !== 'approval' || !s.assigneeId) return s;
        const person = (participants || []).find(p => p.id === s.assigneeId);
        return person ? { ...s, assigneeName: person.name } : s;
      }),
    };

    // Fire and forget — runs concurrently. Wrapped so resolver leaks and
    // crashes both clear the resolver entry instead of leaving a dead handle
    // in the Map for the lifetime of the session.
    executeWorkflowRun({
      runId,
      workflow: enrichedWorkflow,
      coworkers,
      tools,
      fileTree: hydratedWorkflowTree,
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
      onApprovalRequested: async ({ runId: rId, stepId, stepName, workflowName: wfName, assigneeId, prompt, previousOutput }) => {
        // DM the assignee so they see the review request — the approval card
        // itself only renders in the initiator's run conversation. Surface
        // each branch as a status line in the run chat so the run starter
        // can SEE what happened (vs. silently no-op'ing or lying in logs).
        const sender = (participants || []).find(p => p.name === userName);
        // Try id first, then fall back to looking up by name from the
        // workflow step's stored assigneeName (passed via the step's
        // stepResults entry — the run record knows the name too).
        let assignee = (participants || []).find(p => p.id === assigneeId);
        if (!assignee) {
          const runRow = (workflowRuns || []).find(r => r.id === rId);
          const stepRow = runRow?.stepResults?.find(s => s.stepId === stepId);
          if (stepRow?.assigneeName) {
            assignee = (participants || []).find(p => p.name === stepRow.assigneeName);
          }
        }
        // direct_messages.{from,to}_participant_id are uuid-typed. Local
        // synthetic ids (p-…) generated as a fallback when a participant
        // existed before sync hit the DB will fail the insert with code
        // 22P02 (invalid_text_representation). Resolve to a real UUID by
        // name. Sender first, then assignee.
        const isUuid = (s) => typeof s === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
        let realSenderId = sender?.id || null;
        if (realSenderId && !isUuid(realSenderId) && sender?.name) {
          const looked = await sb.findParticipantIdByName(sender.name);
          if (looked) realSenderId = looked;
        }
        let realAssigneeId = assigneeId || null;
        if (realAssigneeId && !isUuid(realAssigneeId) && assignee?.name) {
          const looked = await sb.findParticipantIdByName(assignee.name);
          if (looked) realAssigneeId = looked;
        }
        if (!sender) {
          addMessage({
            type: 'status',
            content: `Could not notify reviewer — your participant row wasn't found. Try refreshing.`,
          }, runConvoId);
          addLog({ type: 'error', message: `review DM skipped: sender not in participants for "${userName}"` });
          return;
        }
        if (!assigneeId) {
          addMessage({
            type: 'status',
            content: `Step "${stepName}" has no reviewer assigned — anyone can approve or reject from the run chat.`,
          }, runConvoId);
          return;
        }
        if (sender.id === assigneeId) {
          addMessage({
            type: 'status',
            content: `You're the reviewer for "${stepName}" — approval card is right here, no DM needed.`,
          }, runConvoId);
          return;
        }
        if (!assignee) {
          addMessage({
            type: 'status',
            content: `Could not notify reviewer — the assigned participant (id ${assigneeId}) is no longer in this room. Re-assign the reviewer in the workflow builder.`,
          }, runConvoId);
          addLog({ type: 'error', message: `review DM skipped: assignee ${assigneeId} not in participants` });
          return;
        }
        const promptLine = prompt ? ` — "${prompt}"` : '';
        const text = `Review requested: "${wfName}" · step "${stepName}"${promptLine}`;
        if (!isUuid(realSenderId) || !isUuid(realAssigneeId)) {
          addMessage({
            type: 'error',
            content: `Couldn't notify ${assignee.name}: their participant row isn't fully synced yet (id: ${realAssigneeId}). Have them refresh their browser, or pick them again in the workflow builder.`,
          }, runConvoId);
          addLog({ type: 'error', message: `review DM aborted: non-uuid participant id (assignee=${realAssigneeId}, sender=${realSenderId})` });
          return;
        }
        // Send as kind='review_request' with metadata so the assignee's DM
        // thread can render the message as an inline approval card with
        // Approve/Reject buttons (instead of a plain text notification
        // pointing them to a separate banner).
        const result = await submitDm(sb, realSenderId, realAssigneeId, text, {
          kind: 'review_request',
          metadata: {
            runId: rId,
            stepId,
            stepName,
            workflowName: wfName,
            prompt: prompt || '',
            previousOutput: previousOutput || '',
          },
        });
        // Surface the actual sendDm error verbatim so we can diagnose
        // instead of guessing. "queued (network slow)" used to be the
        // catch-all status for any non-fatal write failure, which hid
        // real problems (RLS quirks, FK mismatches, auth lapses).
        const rawErr = result?.error;
        const errMsg = typeof rawErr === 'string' ? rawErr : (rawErr?.message || (rawErr ? JSON.stringify(rawErr) : ''));
        if (rawErr && !result?.pending) {
          addMessage({
            type: 'error',
            content: `Failed to notify ${assignee.name}: ${errMsg || 'unknown error'}. They won't see the request unless they refresh and look at the run.`,
          }, runConvoId);
          addLog({ type: 'error', message: `review DM failed: ${errMsg}` });
          return;
        }
        if (result?.pending) {
          addMessage({
            type: 'error',
            content: `Could not deliver notification to ${assignee.name} — Supabase write failed (${errMsg || 'no error message'}). DM is queued in your local outbox; will retry on next reload or realtime reconnect. Check DevTools console for the [sb] sendDm log.`,
          }, runConvoId);
          addLog({ type: 'error', message: `review DM queued (transient): ${errMsg}` });
          return;
        }
        addMessage({
          type: 'status',
          content: `${assignee.name}${assignee.online ? '' : ' (offline)'} has been notified — they'll see the review request in their Chat tab.`,
        }, runConvoId);
        addLog({ type: 'workflow', message: `review DM sent to ${assignee.name} for ${wfName} (${stepName})${assignee.online ? '' : ' [offline]'}` });
      },
      onSaveStepOutput: ({ name, content, destination }) => {
        // Per-step save: fires whenever a step with step.save.enabled
        // completes. Writes the content to the folder/subfolder chosen on
        // that step. Two fallback rules:
        //   - destination.folderId set but missing → surface error (don't
        //     silently land the file somewhere unrelated).
        //   - destination.folderId not set → land in the first top-level
        //     folder, which is the documented default for legacy steps.
        const newFile = {
          id: 'f-' + crypto.randomUUID(),
          name,
          type: 'file',
          content,
          createdBy: userName,
        };
        const topChildren = fileTree.children || [];
        let targetFolder = null;
        if (destination?.folderId) {
          targetFolder = topChildren.find(c => c.id === destination.folderId && c.type === 'folder');
          if (!targetFolder) {
            addMessage({
              type: 'error',
              content: `Could not save "${name}": configured destination folder no longer exists. Re-pick the folder on this step and run again.`,
            });
            addLog({ type: 'error', message: `save failed: missing folder ${destination.folderId}` });
            return;
          }
        } else {
          targetFolder = topChildren.find(c => c.type === 'folder');
        }
        const subName = destination?.subfolder === 'skills' ? 'skills' : 'knowledge';
        const sub = targetFolder
          ? (targetFolder.children || []).find(c => c.type === 'folder' && c.name === subName)
          : null;
        const parentId = sub ? sub.id : (targetFolder ? targetFolder.id : fileTree.id);
        handleUpdateTree(addChildToTree(fileTree, parentId, newFile));
      },
      onCapture: async ({ fileId, mode, content, runId: capRunId, runName }) => {
        // Two modes. Knowledge (default): append the upstream output to a
        // file with a timestamp so the accumulation is visible run-over-run.
        // Skills: ask an LLM to read the current file + the latest run and
        // propose a minimal edit, then overwrite. Facts accumulate, skills
        // distill — different compounding shapes.
        const file = flatFiles.find(f => f.id === fileId);
        if (!file) throw new Error('Target file not found');

        if (mode === 'skills') {
          const systemPrompt = [
            'You are refining the instructions of an AI coworker based on a recent run.',
            'Output ONLY the new full instructions text. No preamble, no explanation, no code fences.',
            'If no edit is warranted, output exactly the string: NO_CHANGE',
            'Preserve what works. Sharpen decision rules. Add guidance for edge cases that came up. Stay concise — do not bloat.',
          ].join('\n');
          const userMessage = [
            '## Current Instructions',
            (file.content || '').trim() || '(empty)',
            '',
            '## Latest Run Output',
            content,
            '',
            '## Task',
            'Propose a minimal edit to the instructions that captures any new pattern, rule, or correction revealed by this run.',
          ].join('\n');
          const result = await callClaudeAPI(systemPrompt, userMessage, {
            segment: 'workflow_capture',
            segmentRefId: `${capRunId}:skills-refine`,
          });
          if (!result.success) throw new Error(result.error || 'Skills refinement failed');
          const proposed = (result.content || '').trim();
          if (!proposed || proposed === 'NO_CHANGE') return;
          handleUpdateFileContent(fileId, proposed);
          return;
        }

        // Knowledge mode (default): append to the picked file.
        const header = `\n\n---\n**Captured ${new Date().toLocaleString()}** — ${runName || 'workflow run'}\n\n`;
        const nextContent = (file.content || '') + header + content;
        handleUpdateFileContent(fileId, nextContent);
      },
    }).catch(err => {
      updateRun(runId, { status: 'error', completedAt: Date.now() });
      addMessage({ type: 'error', content: `Workflow error: ${err.message}` });
    }).finally(() => {
      // Drop any approval resolver still tied to this run — handles both the
      // happy path (resolver already fired and deleted itself in cancel) and
      // the crash path (executor threw before resolving).
      approvalResolversRef.current.delete(runId);
      liveExecutorsRef.current.delete(runId);
      lastRunSyncRef.current.delete(runId);
    });
  }

  function cancelSingleRun(runId) {
    // Fire any pending approval resolver with a cancel signal so an awaiting
    // executor bails out cleanly. If the run is already orphaned (resolver
    // gone after a refresh) we still mark it cancelled in state + Supabase
    // so it stops showing up as "running".
    const resolver = approvalResolversRef.current.get(runId);
    if (resolver) {
      resolver({ action: 'Cancel', comment: '', resolvedBy: userName, cancelled: true });
      approvalResolversRef.current.delete(runId);
    }
    updateRun(runId, { status: 'cancelled', completedAt: Date.now() });
    // Also retire any unresolved approval cards tied to this run so the
    // Approve/Reject buttons don't sit there waiting for a resolver that's
    // already been fired and deleted.
    setConversations(prev => prev.map(c => ({
      ...c,
      messages: (c.messages || []).map(m =>
        m.type === 'approval' && m.runId === runId && !m.resolved
          ? { ...m, resolved: true, resolvedAction: 'Cancelled', resolvedBy: userName }
          : m
      ),
    })));
  }

  function handleCancelRun(runId) {
    cancelSingleRun(runId);
    addMessage({ type: 'status', content: 'Run cancelled.' });
  }

  function handleCancelAllRuns() {
    const active = (workflowRuns || []).filter(r => r.status === 'running' || r.status === 'waiting_approval');
    if (active.length === 0) return;
    for (const r of active) cancelSingleRun(r.id);
    addMessage({ type: 'status', content: `Cancelled ${active.length} active run${active.length === 1 ? '' : 's'}.` });
  }

  function handleApprovalAction(runId, msgId, action, comment, stepInfo = {}) {
    // Pull focus back to the run conversation no matter which surface
    // the click came from. Without this, the participant who clicks
    // Approve from the top-of-chat banner stays on whatever convo they
    // had open (often the default Foundry one) and never sees the run
    // continue with the next coworker step. The conversation id is
    // deterministic from runId so this works even if the run conversation
    // hasn't been added to `conversations` yet (rare, e.g., race after
    // a fresh reload — the run output would still land in the right
    // convo because addMessage creates it on-demand).
    setActiveConvoId('convo-run-' + runId);
    setActiveTab('chat');

    // The in-memory resolver only exists in the browser tab that started
    // the run. If the page has been refreshed since then, the runtime is
    // gone and there's nothing to resolve. Retire the card inline with a
    // friendly 'Stale' state instead of spamming a red error in chat.
    const resolver = approvalResolversRef.current.get(runId);
    if (!resolver) {
      if (msgId) {
        setConversations(prev => prev.map(c => ({
          ...c,
          messages: (c.messages || []).map(m =>
            m.id === msgId
              ? { ...m, resolved: true, resolvedAction: 'Stale' }
              : m
          ),
        })));
      }
      return;
    }
    // Flip the approval card to its resolved state across every conversation
    // so the buttons disappear and a confirmation shows in their place.
    if (msgId) {
      setConversations(prev => prev.map(c => ({
        ...c,
        messages: (c.messages || []).map(m =>
          m.id === msgId
            ? { ...m, resolved: true, resolvedAction: action, resolvedComment: comment, resolvedBy: userName }
            : m
        ),
      })));
    }
    resolver({ action, comment, resolvedBy: userName });
    approvalResolversRef.current.delete(runId);
    // Pass stepId/stepName/assigneeName so the decisions panel can tie the
    // approval row back to the step. Without these, the row's step_id is
    // null and the panel renders "No decision recorded" even after a Reject.
    sb.logApproval({
      runId,
      stepId: stepInfo.stepId,
      stepName: stepInfo.stepName,
      assigneeName: stepInfo.assigneeName,
      action,
      comment,
      resolvedBy: userName,
    });
  }

  // Cross-user approvals: the reviewer clicks Approve/Reject from the
  // "Reviews waiting for you" list. They don't hold the Promise resolver
  // (that lives on the initiator's tab), so this path just writes the
  // decision to `approvals`. The initiator's `onApprovalChange` handler
  // picks up the realtime insert and fires the resolver there.
  async function handleRemoteApprove(run, stepResult, action, comment) {
    if (!run || !stepResult) return;
    // Same focus-restore as handleApprovalAction. The cross-user reviewer
    // may have been clicking from the top-of-chat banner; pull them into
    // the run conversation so the rest of the run plays out in their view.
    setActiveConvoId('convo-run-' + run.id);
    setActiveTab('chat');
    // Optimistically hide the card so the reviewer doesn't see it flash back
    // during the DB round-trip. Cleared after a timeout as a safety net in
    // case the workflowRuns update never arrives.
    setResolvedRemoteRunIds(prev => { const next = new Set(prev); next.add(run.id); return next; });
    setTimeout(() => {
      setResolvedRemoteRunIds(prev => { const next = new Set(prev); next.delete(run.id); return next; });
    }, 10_000);
    await sb.logApproval({
      runId: run.id,
      stepId: stepResult.stepId,
      stepName: stepResult.stepName,
      assigneeName: stepResult.assigneeName,
      action,
      comment: comment || '',
      resolvedBy: userName,
    });
    addLog({ type: 'approval', message: `${userName}: ${action}${comment ? ' | "' + comment + '"' : ''}` });
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
    await submitDm(sb, msg.fromParticipantId, msg.toParticipantId, `${prefix} Original question: ${msg.question}`);
    updateActiveMessages(prev => prev.map(m =>
      m.id === pickId ? { ...m, nudgeCount: (m.nudgeCount || 0) + 1 } : m
    ));
  }


  async function handleNudge(runId) {
    const run = workflowRuns.find(r => r.id === runId);
    if (!run) return;
    const waitingStep = run.stepResults?.find(s => s.status === 'waiting');
    const assigneeName = waitingStep?.assigneeName || null;
    // Resolve assignee's participant so the nudge lands as an actual DM in
    // their inbox, not just a chat log message the sender can see.
    const sender = (participants || []).find(p => p.name === userName);
    const assignee = assigneeName ? (participants || []).find(p => p.name === assigneeName) : null;
    const label = assigneeName || 'the reviewer';
    let delivered = false;
    if (sender && assignee) {
      const text = `Nudge — please review "${run.workflowName}" when you get a moment.`;
      const result = await submitDm(sb, sender.id, assignee.id, text);
      delivered = !result?.error;
    }
    addMessage({
      type: 'nudge',
      fromName: userName,
      toName: label,
      workflowName: run.workflowName,
      delivered,
    });
    addLog({ type: 'workflow', message: `nudge sent to ${label} for ${run.workflowName}` });
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

    // Hydrate any file bodies we're about to splice into the system prompt.
    // loadFiles returns metadata only now; reading f.content on a fresh
    // session without this step would ship empty context to the model.
    const idsToHydrate = [
      ...(contextFileIds || []),
      ...(skillFileIds || []),
      ...(targetCoworker?.instructionFileIds || []),
      ...(targetCoworker?.knowledgeFileIds || []),
    ];
    const hydratedFlat = await handleEnsureFilesContent(idsToHydrate);
    const hydratedTree = hydratedFlat === flatFiles ? fileTree : buildTree(hydratedFlat);
    const loadingLabel = targetCoworker ? targetCoworker.name : 'Foundry';

    setIsLoading(true);
    const loadingId = genMsgId();
    updateActiveMessages(prev => [...prev, { id: loadingId, type: 'loading', label: loadingLabel }]);

    let systemPrompt = undefined;
    if (targetCoworker) {
      // Build system prompt from role description + instruction files + knowledge files
      const instructions = (targetCoworker.instructionFileIds || []).map(id => findNode(hydratedTree, id)).filter(Boolean);
      const knowledge = (targetCoworker.knowledgeFileIds || []).map(id => findNode(hydratedTree, id)).filter(Boolean);

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
      const allFiles = contextFileIds.map(id => findNode(hydratedTree, id)).filter(Boolean);
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
      const contextFiles = (contextFileIds || []).map(id => findNode(hydratedTree, id)).filter(Boolean);
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

      if (!stageReached(currentStage, '5')) {
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
        // Stage 5+: intent classifier decides between a cheap no-tools
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
          //
          // userPrefs is ALSO in the variable tail, deliberately: it varies
          // per user, and including it in the cached prefix meant 35 users
          // in a workshop each wrote their own cache and never shared. The
          // 04-26 llm_usage audit showed `chat` segment at 3% hit rate
          // (681K writes, 24K reads) because of this. Pulling userPrefs out
          // makes the cached prefix byte-identical for every user in the
          // workshop, so the first call writes and the other 34 read.
          const platformStableBlock = `You are the Foundry platform assistant for ${orgName}. You help users build and manage their AI coworker platform through natural language.

The platform has these elements:
- **Files**: Knowledge documents (policies, rules, reference) and instruction files (AI coworker behavior). Organized in department folders.
- **Tools**: Every coworker automatically has Knowledge Search and Chat Notification built in. External connectors (Notion, Linear, custom APIs) can be added in the Connectors tab.
- **Coworkers**: AI coworkers with a role description, instruction files (behavior), and knowledge files (context). Built-in tools are automatic.
- **Workflows**: Step sequences — agent tasks, human approval gates, system actions.

When building something, create dependencies first: files before coworkers that need them, coworkers before workflows that reference them. Use assign_tool to wire tools to coworkers.
When answering questions, check current state with list/read tools if needed.

## Reply style — strict
Answer in ONE sentence. If the user asks "how", a second sentence is allowed — never more. After an action, reply with a bare confirmation and nothing else ("Created Ravi." / "Listed 3 coworkers."). Never restate the user's request. Never bullet-list a recap. Never say "Let me know if…" or "Feel free to…". If you can't fit the answer in two sentences, ask the user what specifically they want to know.`;

          const platformVariableTail = `${userPrefsForPlatform}${stageGuidanceSection}${knowledgeSection}`;

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

  // Cross-user pending reviews: runs where the current user is the waiting
  // assignee. Filter out any runs the local resolver already owns (same-user
  // case) and any the user has already clicked but whose DB echo hasn't come
  // back yet — tracked in resolvedRemoteRunIdsRef to prevent a card reappearing
  // for a split second after Approve is clicked.
  const myPendingReviews = (workflowRuns || [])
    .filter(r => r.status === 'waiting_approval')
    .map(r => {
      // ID match first (rock-solid against name drift); fall back to name
      // match for runs created before assigneeId was stored on the
      // stepResult.
      const step = (r.stepResults || []).find(s => {
        if (s.status !== 'waiting') return false;
        if (s.assigneeId && myParticipantId) return s.assigneeId === myParticipantId;
        return s.assigneeName === userName;
      });
      return step ? { run: r, step } : null;
    })
    .filter(Boolean)
    .filter(x => !approvalResolversRef.current.has(x.run.id))
    .filter(x => !resolvedRemoteRunIds.has(x.run.id));

  // Orphaned runs: a run I started that thinks it's still in-flight
  // ('running' or 'waiting_approval'), but the in-memory executor that owns
  // it is gone (tab refreshed mid-flight). Nothing will ever push it to a
  // terminal state. Surface these so the user can cancel them cleanly.
  // Catching 'running' (not just 'waiting_approval') matters because runs
  // that crashed between two coworker steps never reached an approval and
  // the old detector missed them.
  const myOrphanedRuns = (workflowRuns || []).filter(r =>
    r.startedBy === userName
    && (r.status === 'running' || r.status === 'waiting_approval')
    && !liveExecutorsRef.current.has(r.id)
  );

  async function handleCancelOrphanedRun(runId) {
    // Mark the run cancelled both locally and in the DB. Don't await the
    // DB write — the realtime UPDATE will sync everyone else; local state
    // is what matters for the user right now.
    setWorkflowRuns(prev => prev.map(r =>
      r.id === runId ? { ...r, status: 'cancelled', completedAt: Date.now() } : r
    ));
    const run = workflowRuns.find(r => r.id === runId);
    if (run) sb.saveWorkflowRun({ ...run, status: 'cancelled', completedAt: Date.now() });
  }

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
        tools={tools}
        fileTree={fileTree}
        userPreferences={userPreferences}
        loadAllRoomApprovals={sb.loadAllRoomApprovals}
        sb={sb}
        myParticipantId={myParticipantId}
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

  // Demographics gate. Only blocks when we've *confirmed* the participant
  // hasn't submitted yet (status === 'pending'). While the load is still
  // in flight (status === 'unknown'), let the app shell render — the
  // gate will appear the moment the load resolves. Earlier we showed a
  // 'Loading…' screen on 'unknown', but that hung forever whenever the
  // bootstrap effect bailed (stale localStorage room, auth flake, etc.).
  if (isJoined && demographicsStatus === 'pending') {
    return (
      <AuthGate onJoin={handleJoin} workshopCode={workshopCode}>
        <DemographicsForm
          userName={userName}
          onSubmit={handleSaveDemographics}
          // Admin-only escape hatch. Skipping demographics also bypasses
          // the per-stage reflection cascade — without this the admin
          // would get hit with 6 reflection modals in succession the
          // instant the app shell renders (one for each stage they've
          // technically "advanced past" without submitting). Feedback
          // still has its own Skip on the FeedbackForm; we don't touch
          // it here because GraduationScreen owns that state.
          onSkip={() => {
            setDemographicsStatus('submitted');
            setSubmittedReflections(prev => {
              const next = new Set(prev || []);
              for (const stage of reflectionStageList) next.add(stage);
              return next;
            });
          }}
          submitting={savingDemographics}
          errorMessage={demographicsError}
        />
      </AuthGate>
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
      {pendingReflectionStage && (
        <StageReflection
          key={pendingReflectionStage}
          stage={pendingReflectionStage}
          onSubmit={async (payload) => {
            // Payload shape (from research instrument):
            //   { confidence, agreement, transfer_text, structured, questions_text_version }
            // `confidence` keeps the old column name for back-compat with
            // the takeaway PDF rendering; the new fields ride on the
            // 043 migration's added columns.
            if (!myParticipantId) {
              // Edge case: not yet bound to a participant row. Optimistically
              // mark this stage submitted locally so the participant isn't
              // trapped behind a gate they can't satisfy.
              setSubmittedReflections(prev => {
                const next = new Set(prev || []);
                next.add(pendingReflectionStage);
                return next;
              });
              return;
            }
            const res = await sb.saveStageReflection(myParticipantId, pendingReflectionStage, payload);
            if (!res?.ok) {
              throw new Error(res?.error || 'Could not save your reflection. Please try again.');
            }
            setSubmittedReflections(prev => {
              const next = new Set(prev || []);
              next.add(pendingReflectionStage);
              return next;
            });
          }}
          // Admin-only escape hatch — local-state only, no row written.
          // Marks the stage as submitted so the modal closes and the
          // participant flow continues; doesn't pollute stage_reflections
          // with a row that has no answers.
          onSkip={() => {
            setSubmittedReflections(prev => {
              const next = new Set(prev || []);
              next.add(pendingReflectionStage);
              return next;
            });
          }}
        />
      )}
      <header className="app-header">
        <div className="app-header-left" onClick={() => { setActiveTab('chat'); setChatBadge(false); }}>
          <span className="app-logo">F</span>
          <div className="app-masthead">
            <h1>Foundry</h1>
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
          <RevealAt stage="5" currentStage={currentStage}>
            <button className={`tab-nav-item${activeTab === 'coworkers' ? ' active' : ''}`} onClick={() => setActiveTab('coworkers')}>
              Coworkers{coworkers && coworkers.length > 0 && <span className="tab-count">{coworkers.length}</span>}
            </button>
          </RevealAt>
          <RevealAt stage="6" currentStage={currentStage}>
            <button className={`tab-nav-item${activeTab === 'workflow' ? ' active' : ''}`} onClick={() => setActiveTab('workflow')}>
              Workflow{hasActiveRuns && <span className="tab-running-dot" />}
            </button>
          </RevealAt>
          <RevealAt stage="7" currentStage={currentStage}>
            <button className={`tab-nav-item${activeTab === 'activity' ? ' active' : ''}`} onClick={() => setActiveTab('activity')}>
              Audit{activeRuns.length > 0 && activeTab !== 'activity' && <span className="tab-count">{activeRuns.length}</span>}
            </button>
          </RevealAt>
          <RevealAt stage="8" currentStage={currentStage}>
            <button className={`tab-nav-item${activeTab === 'usage' ? ' active' : ''}`} onClick={() => setActiveTab('usage')}>
              Economics
            </button>
          </RevealAt>
          <RevealAt stage="9" currentStage={currentStage}>
            <button className={`tab-nav-item${activeTab === 'graduation' ? ' active' : ''}`} onClick={() => setActiveTab('graduation')}>
              Graduation
            </button>
          </RevealAt>
        </nav>
        <div className="app-header-right">
          <SettingsMenu
            userName={userName}
            orgName={orgName}
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
          workshopCode={workshopCode}
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
              onEnsureFileContent={handleEnsureFileContent}
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
              latestIncomingDm={latestIncomingDm}
              onOpenDm={handleOpenDm}
              onCloseDm={handleCloseDm}
              myParticipantId={myParticipantId}
              sb={sb}
              unreadDmCounts={unreadDmCounts}
              workflowRuns={workflowRuns}
              myPendingReviews={myPendingReviews}
              onRemoteApprove={handleRemoteApprove}
              myOrphanedRuns={myOrphanedRuns}
              onCancelOrphanedRun={handleCancelOrphanedRun}
              dmOutboxCount={dmOutboxCount}
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
            <ScenarioBuilder
              sb={sb}
              myParticipantId={myParticipantId}
              currentUserName={userName}
              fileTree={fileTree}
              participants={participants || []}
              coworkers={coworkers || []}
              onRunWorkflow={handleRunCaseWorkflow}
            />
          </div>
        )}
        {activeTab === 'files' && (
          <div className="tab-pane tab-pane-files">
            <div className="fl-page">
              <header className="fl-page-head">
                <div className="fl-page-head-left">
                  <div className="fl-page-eyebrow">Stage 3-4 · Files</div>
                  <h1 className="fl-page-title">A workspace your coworkers <em>read from</em>.</h1>
                  <p className="fl-page-sub">
                    Knowledge for what the AI reads, skills for how it works.
                  </p>
                </div>
                <div className="fl-page-legend">
                  <span className="fl-legend-item"><span className="fl-legend-swatch" style={{ background: '#d97757' }} /> Folder</span>
                  {/* Post-2026-05-09 swap: skills appear at Stage 3, knowledge at Stage 4. */}
                  {stageReached(currentStage, '3') && (
                    <span className="fl-legend-item"><span className="fl-legend-swatch" style={{ background: '#4a7fb5' }} /> Skills</span>
                  )}
                  {stageReached(currentStage, '4') && (
                    <span className="fl-legend-item"><span className="fl-legend-swatch" style={{ background: '#5a9e6f' }} /> Knowledge</span>
                  )}
                </div>
              </header>
              <div className="fl-shell">
                <FileExplorer fileTree={fileTree} selectedFileId={selectedFileId} onSelectFile={(id) => { if (id) handleEnsureFileContent(id); setSelectedFileId(id); }} onUpdateTree={handleUpdateTree} onSelectDepartment={setSelectedDeptId} showEducationalCues={showEducationalCues} currentStage={currentStage} userName={userName} callClaudeAPI={callClaudeAPI} />
                <FileEditor file={selectedFile} fileTree={fileTree} onUpdateContent={handleUpdateFileContent} onClose={() => setSelectedFileId(null)} />
              </div>
            </div>
          </div>
        )}
        {activeTab === 'activity' && (
          <div className="tab-pane tab-pane-activity">
            <ActivityDashboard
              workflowRuns={workflowRuns}
              onApprovalAction={handleApprovalAction}
              onCancelRun={handleCancelRun}
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
              myParticipantId={myParticipantId}
            />
          </div>
        )}
        {activeTab === 'usage' && stageReached(currentStage, '8') && (
          <div className="tab-pane tab-pane-usage">
            <UsageView
              sb={sb}
              participants={participants}
              myParticipantId={myParticipantId}
              showEducationalCues={showEducationalCues}
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
              tools={tools}
              fileTree={fileTree}
              userPreferences={userPreferences}
              loadAllRoomApprovals={sb.loadAllRoomApprovals}
              sb={sb}
              myParticipantId={myParticipantId}
            />
          </div>
        )}
      </div>
    </div>
    </AuthGate>
  );
}

export default App;
