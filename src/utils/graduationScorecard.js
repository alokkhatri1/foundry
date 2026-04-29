// Graduation scorecard — maps each participant's activity onto a rubric of
// competency levels, one dimension per top-level tab.
//
// Levels, lowest → highest:
//   0. Not Started   — no evidence of touching the primitive
//   1. Awareness     — touched it, saw what it is
//   2. Application   — used it properly at least once
//   3. Mastery       — used it well, multiple times, refined
//   4. Influence     — their artifact was used or acted on by another participant
//
// The 6 dimensions mirror the app's tabs: Chat, Files, Coworkers, Orchestration,
// Collaboration (cross-tab), Observability. Tools and Capture are no longer
// standalone — they roll into Coworkers and Orchestration respectively, which
// is where participants actually configure them in the new layout.
//
// "Influence" requires cross-participant data (someone else used my file,
// DM'd my coworker, ran my workflow, resolved my review request). We compute
// what we can with the Supabase data at hand; signals are intentionally
// conservative — false negatives are fine, false positives are not.

export const LEVELS = ['Not Started', 'Awareness', 'Application', 'Mastery', 'Influence'];
export const LEVEL_COLORS = {
  0: '#bdb6aa',
  1: '#8fa8c5',
  2: '#5a9e6f',
  3: '#c8956c',
  4: '#8b6fb0',
};

// Walk a file tree looking for files whose ancestor folder chain contains a
// folder with the given name (e.g. 'skills' or 'knowledge'). Returns a flat
// list of matching file nodes. Used instead of regex-on-filename because the
// real convention is folder-based, not name-based.
function filesInFolderNamed(tree, folderName) {
  const acc = [];
  function walk(node, withinTarget) {
    if (!node) return;
    const here = withinTarget || (node.type === 'folder' && node.name === folderName);
    if (node.type === 'file' && withinTarget) acc.push(node);
    for (const child of node.children || []) walk(child, here);
  }
  walk(tree, false);
  return acc;
}

export function computeScorecard({
  userName,
  conversations = [],
  coworkers = [],
  workflows = [],
  workflowRuns = [],
  flatFiles = [],
  approvals = [],
  participants = [],
  tools = [],
  fileTree = null,
  userPreferences = '',
}) {
  // Pull the participant's slice of every entity. "mine" = createdBy === userName,
  // with a permissive fallback for files that were created before createdBy was
  // stamped (treat as own — they don't otherwise count toward any peer's score).
  const myMessages = (conversations || []).reduce((sum, c) => sum + (c.messages || []).filter(m => m.type === 'user').length, 0);
  const myCoworkers = (coworkers || []).filter(c => c.createdBy === userName);
  const myWorkflows = (workflows || []).filter(w => w.createdBy === userName);
  const myRuns = (workflowRuns || []).filter(r => r.startedBy === userName);
  const myFiles = (flatFiles || []).filter(f => !f.createdBy || f.createdBy === userName);
  const myRealFiles = myFiles.filter(f => f.type === 'file');
  const myTools = (tools || []).filter(t => !t.isBuiltin && (!t.createdBy || t.createdBy === userName));

  // Approvals split by whose run, for the Collaboration + Observability dims.
  const myApprovals = (approvals || []).filter(a => a.resolved_by === userName);
  const reviewsForOthers = myApprovals.filter(a => {
    const run = (workflowRuns || []).find(r => r.id === a.run_id);
    return run && run.startedBy !== userName;
  });
  const distinctPeopleIReviewedFor = new Set(reviewsForOthers
    .map(a => (workflowRuns || []).find(r => r.id === a.run_id)?.startedBy)
    .filter(Boolean));
  const approvalsOnMyRuns = (approvals || []).filter(a => {
    const run = (workflowRuns || []).find(r => r.id === a.run_id);
    return run && run.startedBy === userName;
  });

  // Folder-based skills + knowledge detection. Falls back to regex-on-name
  // when no fileTree is passed (test harness) so callers don't have to
  // always thread it.
  const skillsFilesAll = fileTree ? filesInFolderNamed(fileTree, 'skills') : myRealFiles.filter(f => /skill|instruction/i.test(f.name || ''));
  const knowledgeFilesAll = fileTree ? filesInFolderNamed(fileTree, 'knowledge') : [];
  const mySkillFiles = skillsFilesAll.filter(f => !f.createdBy || f.createdBy === userName);
  const myKnowledgeFiles = knowledgeFilesAll.filter(f => !f.createdBy || f.createdBy === userName);
  const myFolderOrganizedFiles = mySkillFiles.length + myKnowledgeFiles.length;
  const skillUsedInMyCoworkers = myCoworkers.some(c =>
    (c.instructionFileIds || []).some(id => mySkillFiles.some(f => f.id === id))
  );
  const othersCoworkers = (coworkers || []).filter(c => c.createdBy && c.createdBy !== userName);
  const myFilesUsedByOthers = myFiles.filter(f =>
    othersCoworkers.some(c =>
      (c.instructionFileIds || []).includes(f.id)
      || (c.knowledgeFileIds || []).includes(f.id)
    )
  );

  // Someone else sent a DM to one of my coworkers — tracked by DM threads
  // whose title matches a coworker name I own.
  const myCoworkerNames = new Set(myCoworkers.map(c => c.name));
  const coworkersDmdByOthers = (conversations || []).filter(c =>
    c.kind === 'dm' && myCoworkerNames.has(c.title)
    && (c.messages || []).some(m => m.authorName && m.authorName !== userName)
  ).length;
  const myToolsUsedByOthers = myTools.filter(t =>
    othersCoworkers.some(c => (c.toolIds || []).includes(t.id))
  ).length;

  // Capture-step signals fold into Orchestration now.
  const myCaptureSteps = myWorkflows.flatMap(w =>
    (w.steps || []).filter(s => s.type === 'capture')
  );
  const myConfiguredCaptures = myCaptureSteps.filter(s => s.targetFileId);
  const myCaptureRunsCompleted = myRuns.filter(r =>
    (r.stepResults || []).some(s => s.type === 'capture' && s.status === 'completed' && s.output && !/^not configured/i.test(String(s.output)))
  ).length;

  // Dimensions -------------------------------------------------------------

  const dimensions = [];

  // 1. Chat & Personalization (Chat tab) — measures whether the participant
  //    actually conversed and taught the AI their voice via preferences.
  //    Caps at Mastery: there's no clean "influence" signal for prefs alone.
  const prefs = (userPreferences || '').trim();
  dimensions.push({
    key: 'chat',
    label: 'Chat & Personalization',
    hint: 'Talking with the AI and teaching it your voice and role.',
    level: (() => {
      if (myMessages === 0 && prefs.length === 0) return 0;
      if (prefs.length === 0) return 1;
      if (prefs.length < 80) return 2;
      return 3;
    })(),
    evidence: (() => {
      const parts = [];
      if (myMessages > 0) parts.push(`${myMessages} message${myMessages === 1 ? '' : 's'} sent`);
      if (prefs.length > 0) parts.push(`preferences ${prefs.length} chars${prefs.length >= 80 ? ' (detailed)' : ''}`);
      return parts.length ? parts.join(' · ') + '.' : 'No activity.';
    })(),
  });

  // 2. Files & Grounding (Files tab) — uploads + skills/knowledge folder
  //    organization + reuse by peers. Folds in the old "Skill authoring"
  //    dimension; level 4 fires for any file (not just skill files) reused.
  dimensions.push({
    key: 'files',
    label: 'Files & Grounding',
    hint: 'Giving the AI documents to work from, organized into skills and knowledge.',
    level: (() => {
      const n = myRealFiles.length;
      if (n === 0) return 0;
      if (myFilesUsedByOthers.length > 0) return 4;
      if (n >= 5 && skillUsedInMyCoworkers) return 3;
      if (n >= 2 || myFolderOrganizedFiles >= 1) return 2;
      return 1;
    })(),
    evidence: (() => {
      if (myRealFiles.length === 0) return 'No files uploaded.';
      const parts = [`${myRealFiles.length} file${myRealFiles.length === 1 ? '' : 's'}`];
      if (mySkillFiles.length) parts.push(`${mySkillFiles.length} skill`);
      if (myKnowledgeFiles.length) parts.push(`${myKnowledgeFiles.length} knowledge`);
      if (myFilesUsedByOthers.length) parts.push(`${myFilesUsedByOthers.length} reused by peers`);
      return parts.join(' · ') + '.';
    })(),
  });

  // 3. Coworkers (Coworkers tab) — folds in the old "Tools & connectors"
  //    dimension. A "rich" coworker now means role + instructions + knowledge
  //    + tool wired in. Influence fires if a peer DM'd a coworker I built or
  //    reused a tool I built.
  const myCoworkersWithTools = myCoworkers.filter(c => (c.toolIds || []).length > 0);
  const richCoworker = myCoworkers.find(c =>
    (c.role || '').trim().length > 40
    && (c.instructionFileIds || []).length > 0
    && (c.knowledgeFileIds || []).length > 0
    && (c.toolIds || []).length > 0
  );
  dimensions.push({
    key: 'coworkers',
    label: 'Coworkers',
    hint: 'Building named AI teammates with role, instructions, knowledge, and tools.',
    level: (() => {
      if (myCoworkers.length === 0) return 0;
      if (coworkersDmdByOthers > 0 || myToolsUsedByOthers > 0) return 4;
      if (myCoworkers.length >= 2 && richCoworker) return 3;
      if (myCoworkers.some(c => (c.role || '').trim().length > 0 && (c.instructionFileIds || []).length > 0)) return 2;
      return 1;
    })(),
    evidence: (() => {
      if (myCoworkers.length === 0) return 'No coworkers built.';
      const parts = [`${myCoworkers.length} coworker${myCoworkers.length === 1 ? '' : 's'}`];
      if (myCoworkersWithTools.length) parts.push(`${myCoworkersWithTools.length} armed with tools`);
      if (myTools.length) parts.push(`${myTools.length} tool${myTools.length === 1 ? '' : 's'} built`);
      if (coworkersDmdByOthers) parts.push(`DM'd by peers`);
      if (myToolsUsedByOthers) parts.push(`tools reused`);
      return parts.join(' · ') + '.';
    })(),
  });

  // 4. Orchestration (Orchestration tab) — folds in the old "Capture learning"
  //    dimension. Mastery requires a workflow that includes a configured
  //    capture step AND completed at least one successful capture run.
  //    Influence fires when a peer runs your workflow.
  const myWorkflowsRunByOthers = myWorkflows.filter(w =>
    (workflowRuns || []).some(r => r.workflowId === w.id && r.startedBy !== userName)
  ).length;
  const myRunsWithHumanReview = myRuns.filter(r =>
    (r.stepResults || []).some(s => s.type === 'approval' && s.status === 'completed')
  );
  dimensions.push({
    key: 'orchestration',
    label: 'Orchestration',
    hint: 'Chaining AI and human steps into a repeatable flow that captures what it learns.',
    level: (() => {
      if (myRuns.length === 0 && myWorkflows.length === 0) return 0;
      if (myWorkflowsRunByOthers > 0) return 4;
      if (myCaptureRunsCompleted >= 1 && myRunsWithHumanReview.length >= 1) return 3;
      if (myRuns.length >= 1) return 2;
      return 1;
    })(),
    evidence: (() => {
      const parts = [];
      if (myWorkflows.length) parts.push(`${myWorkflows.length} workflow${myWorkflows.length === 1 ? '' : 's'} designed`);
      if (myRuns.length) parts.push(`${myRuns.length} run${myRuns.length === 1 ? '' : 's'}`);
      if (myConfiguredCaptures.length) parts.push(`${myConfiguredCaptures.length} capture step${myConfiguredCaptures.length === 1 ? '' : 's'}`);
      if (myWorkflowsRunByOthers) parts.push(`reused by ${myWorkflowsRunByOthers} teammate${myWorkflowsRunByOthers === 1 ? '' : 's'}`);
      return parts.length ? parts.join(' · ') + '.' : 'No orchestration activity yet.';
    })(),
  });

  // 5. Collaboration — cross-room review exchange. Both sides count: opening
  //    a review on a peer (resolveByMe targeting their run) and having one
  //    of yours resolved (approvalsOnMyRuns).
  dimensions.push({
    key: 'collaboration',
    label: 'Collaboration',
    hint: 'Mixed-team draft-and-review across humans and coworkers.',
    level: (() => {
      const resolvedByMe = myApprovals.length;
      const onMyRuns = approvalsOnMyRuns.length;
      if (resolvedByMe === 0 && onMyRuns === 0) return 0;
      if (distinctPeopleIReviewedFor.size >= 2) return 4;
      if (resolvedByMe > 0 && onMyRuns > 0) return 3;
      if (resolvedByMe > 0 || onMyRuns > 0) return 2;
      return 1;
    })(),
    evidence: (() => {
      const parts = [];
      if (myApprovals.length) parts.push(`${myApprovals.length} review${myApprovals.length === 1 ? '' : 's'} resolved`);
      if (approvalsOnMyRuns.length) parts.push(`${approvalsOnMyRuns.length} on your runs`);
      if (distinctPeopleIReviewedFor.size) parts.push(`for ${distinctPeopleIReviewedFor.size} ${distinctPeopleIReviewedFor.size === 1 ? 'person' : 'people'}`);
      return parts.length ? parts.join(' · ') + '.' : 'No review activity yet.';
    })(),
  });

  // 6. Observability (Observability tab) — visible runs + decisions logged
  //    + activity on your own runs. Distinct-runs-touched is the influence
  //    signal: someone whose decisions span the room, not just their own.
  const runsInRoom = (workflowRuns || []).length;
  dimensions.push({
    key: 'observability',
    label: 'Observability',
    hint: 'Watching the mixed team work and acting on what you see.',
    level: (() => {
      if (runsInRoom === 0) return 0;
      const distinctRunsTouched = new Set([
        ...myApprovals.map(a => a.run_id),
        ...approvalsOnMyRuns.map(a => a.run_id),
      ]);
      if (distinctPeopleIReviewedFor.size >= 2 || distinctRunsTouched.size >= 3) return 4;
      if (myApprovals.length >= 2) return 3;
      if (myApprovals.length >= 1 || approvalsOnMyRuns.length >= 1) return 2;
      return 1;
    })(),
    evidence: runsInRoom === 0
      ? 'No runs to watch yet.'
      : `${runsInRoom} run${runsInRoom === 1 ? '' : 's'} visible, ${myApprovals.length} decision${myApprovals.length === 1 ? '' : 's'} by you${approvalsOnMyRuns.length ? `, ${approvalsOnMyRuns.length} on your runs` : ''}.`,
  });

  // Overall band — lowest level across dimensions the user has started
  // (Level 0 dimensions don't drag the overall down — they just mean they
  // haven't touched that primitive yet). If they touched nothing, Not Started.
  const touchedLevels = dimensions.map(d => d.level).filter(l => l > 0);
  const overallLevel = touchedLevels.length === 0 ? 0 : Math.min(...touchedLevels);

  return { dimensions, overallLevel };
}
