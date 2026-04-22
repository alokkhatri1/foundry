// Graduation scorecard — maps each participant's activity onto a rubric of
// competency levels per pedagogical dimension.
//
// Levels, lowest → highest:
//   0. Not Started   — no evidence of touching the primitive
//   1. Awareness     — touched it, saw what it is
//   2. Application   — used it properly at least once
//   3. Mastery       — used it well, multiple times, refined
//   4. Influence     — their artifact was used or acted on by another participant
//
// "Influence" requires cross-participant data (someone else DM'd my coworker,
// used my skill file, resolved my review request, etc). We compute what we
// can with the Supabase data at hand; some influence signals are intentionally
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
  const myMessages = (conversations || []).reduce((sum, c) => sum + (c.messages || []).filter(m => m.type === 'user').length, 0);
  const myCoworkers = (coworkers || []).filter(c => c.createdBy === userName);
  const myWorkflows = (workflows || []).filter(w => w.createdBy === userName);
  const myRuns = (workflowRuns || []).filter(r => r.startedBy === userName);
  const myFiles = (flatFiles || []).filter(f => !f.createdBy || f.createdBy === userName);
  const myRealFiles = myFiles.filter(f => f.type === 'file');
  const myTools = (tools || []).filter(t => !t.isPrebuilt && (!t.createdBy || t.createdBy === userName));

  // Approvals I personally resolved (any action), split by whose run.
  const myApprovals = (approvals || []).filter(a => a.resolved_by === userName);
  const reviewsForOthers = myApprovals.filter(a => {
    const run = (workflowRuns || []).find(r => r.id === a.run_id);
    return run && run.startedBy !== userName;
  });
  const distinctPeopleIReviewedFor = new Set(reviewsForOthers
    .map(a => (workflowRuns || []).find(r => r.id === a.run_id)?.startedBy)
    .filter(Boolean));

  // Approvals on MY runs resolved by someone else (others influenced my flows).
  const approvalsOnMyRuns = (approvals || []).filter(a => {
    const run = (workflowRuns || []).find(r => r.id === a.run_id);
    return run && run.startedBy === userName;
  });

  // Folder-based skills + knowledge detection. Falls back to regex-on-name
  // when no fileTree is passed (test harness) so callers don't have to
  // always thread it.
  const skillsFilesAll = fileTree ? filesInFolderNamed(fileTree, 'skills') : myRealFiles.filter(f => /skill|instruction/i.test(f.name || ''));
  const skillFiles = skillsFilesAll.filter(f => !f.createdBy || f.createdBy === userName);
  const skillUsedInMyCoworkers = myCoworkers.some(c =>
    (c.instructionFileIds || []).some(id => skillFiles.some(f => f.id === id))
  );
  const othersCoworkers = (coworkers || []).filter(c => c.createdBy && c.createdBy !== userName);
  const mySkillsUsedByOthers = skillFiles.filter(f =>
    othersCoworkers.some(c => (c.instructionFileIds || []).includes(f.id))
  ).length;
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

  // Dimensions -------------------------------------------------------------

  const dimensions = [];

  // 1. Personalization (Preferences) — reads the actual user_preferences
  //    content (threaded in from Supabase), not a file named "preferences".
  const prefs = (userPreferences || '').trim();
  dimensions.push({
    key: 'personalization',
    label: 'Personalization',
    hint: 'Teaching the AI your voice and role.',
    level: (() => {
      if (myMessages === 0 && prefs.length === 0) return 0;
      if (prefs.length === 0) return 1;
      if (prefs.length < 80) return 2;
      return 3;
    })(),
    evidence: prefs.length > 0
      ? `Preferences: ${prefs.length} chars${prefs.length >= 80 ? ' (detailed)' : ''}.`
      : myMessages > 0 ? 'Chatted, but no preferences written yet.' : 'No activity.',
  });

  // 2. Grounding (Files as context)
  dimensions.push({
    key: 'grounding',
    label: 'Grounding',
    hint: 'Giving the AI documents to work from.',
    level: (() => {
      const n = myRealFiles.length;
      if (n === 0) return 0;
      if (myFilesUsedByOthers.length > 0) return 4;
      if (n >= 5) return 3;
      if (n >= 2) return 2;
      return 1;
    })(),
    evidence: myRealFiles.length === 0
      ? 'No files uploaded.'
      : `${myRealFiles.length} file${myRealFiles.length === 1 ? '' : 's'} in your folders${myFilesUsedByOthers.length > 0 ? ` · ${myFilesUsedByOthers.length} used by others` : ''}.`,
  });

  // 3. Skill authoring — now folder-based (/skills/) instead of name regex.
  dimensions.push({
    key: 'skills',
    label: 'Skill authoring',
    hint: 'Writing reusable instructions that shape coworker behavior.',
    level: (() => {
      if (skillFiles.length === 0) return 0;
      if (mySkillsUsedByOthers > 0) return 4;
      if (skillUsedInMyCoworkers && skillFiles.length >= 2) return 3;
      if (skillUsedInMyCoworkers) return 2;
      return 1;
    })(),
    evidence: skillFiles.length === 0
      ? 'No skill files authored.'
      : `${skillFiles.length} skill file${skillFiles.length === 1 ? '' : 's'}${skillUsedInMyCoworkers ? ' · used in your coworker' : ''}${mySkillsUsedByOthers ? ` · reused by ${mySkillsUsedByOthers} of others' coworkers` : ''}.`,
  });

  // 4. Coworker creation — compound Mastery gate (role + instruction files +
  //    tool) instead of a flat 40-char role threshold.
  const richCoworker = myCoworkers.find(c =>
    (c.role || '').trim().length > 40
    && (c.instructionFileIds || []).length > 0
    && (c.toolIds || []).length > 0
  );
  dimensions.push({
    key: 'coworkers',
    label: 'Coworker creation',
    hint: 'Building named AI teammates with instructions + knowledge.',
    level: (() => {
      if (myCoworkers.length === 0) return 0;
      if (coworkersDmdByOthers > 0) return 4;
      if (myCoworkers.length >= 2 && richCoworker) return 3;
      if (myCoworkers.some(c => (c.role || '').trim().length > 0 || (c.instructionFileIds || []).length > 0)) return 2;
      return 1;
    })(),
    evidence: myCoworkers.length === 0
      ? 'No coworkers built.'
      : `${myCoworkers.length} coworker${myCoworkers.length === 1 ? '' : 's'}: ${myCoworkers.map(c => c.name).slice(0, 3).join(', ')}${myCoworkers.length > 3 ? '\u2026' : ''}${coworkersDmdByOthers > 0 ? ' · DM\'d by peers' : ''}.`,
  });

  // 5. Tools / Connectors — new dimension. Counts participant-authored tools
  //    (non-prebuilt) plus coworkers that actually wire a tool in.
  const myCoworkersWithTools = myCoworkers.filter(c => (c.toolIds || []).length > 0);
  const myToolsUsedByOthers = myTools.filter(t =>
    othersCoworkers.some(c => (c.toolIds || []).includes(t.id))
  ).length;
  dimensions.push({
    key: 'tools',
    label: 'Tools & connectors',
    hint: 'Extending coworkers with external actions.',
    level: (() => {
      if (myTools.length === 0 && myCoworkersWithTools.length === 0) return 0;
      if (myToolsUsedByOthers > 0) return 4;
      if (myTools.length >= 1 && myCoworkersWithTools.length >= 1) return 3;
      if (myCoworkersWithTools.length >= 1) return 2;
      return 1;
    })(),
    evidence: (() => {
      const parts = [];
      if (myTools.length) parts.push(`${myTools.length} tool${myTools.length === 1 ? '' : 's'} built`);
      if (myCoworkersWithTools.length) parts.push(`${myCoworkersWithTools.length} coworker${myCoworkersWithTools.length === 1 ? '' : 's'} armed`);
      if (myToolsUsedByOthers) parts.push(`${myToolsUsedByOthers} used by others`);
      return parts.length ? parts.join(' · ') + '.' : 'No tools built yet.';
    })(),
  });

  // 6. Mixed-team collaboration (reviews — sending and resolving)
  dimensions.push({
    key: 'collaboration',
    label: 'Mixed-team collaboration',
    hint: 'Both roles of the draft-and-review exchange.',
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

  // 7. Orchestration
  const myRunsWithHumanReview = myRuns.filter(r =>
    (r.stepResults || []).some(s => s.type === 'approval' && s.status === 'completed')
  );
  const myWorkflowsRunByOthers = myWorkflows.filter(w =>
    (workflowRuns || []).some(r => r.workflowId === w.id && r.startedBy !== userName)
  ).length;
  dimensions.push({
    key: 'orchestration',
    label: 'Orchestration',
    hint: 'Chaining AI and human steps into a repeatable flow.',
    level: (() => {
      if (myRuns.length === 0 && myWorkflows.length === 0) return 0;
      if (myWorkflowsRunByOthers > 0) return 4;
      if (myRunsWithHumanReview.length > 0) return 3;
      if (myRuns.length > 0) return 2;
      return 1;
    })(),
    evidence: (() => {
      const parts = [];
      if (myWorkflows.length) parts.push(`${myWorkflows.length} workflow${myWorkflows.length === 1 ? '' : 's'} designed`);
      if (myRuns.length) parts.push(`${myRuns.length} run${myRuns.length === 1 ? '' : 's'}`);
      if (myRunsWithHumanReview.length) parts.push('including human review');
      if (myWorkflowsRunByOthers) parts.push(`reused by ${myWorkflowsRunByOthers} teammate${myWorkflowsRunByOthers === 1 ? '' : 's'}`);
      return parts.length ? parts.join(' · ') + '.' : 'No orchestration activity yet.';
    })(),
  });

  // 8. Capture Learning — new dimension. Did they configure a Capture step,
  //    did it run successfully, did knowledge/skills actually compound?
  const myCaptureSteps = myWorkflows.flatMap(w =>
    (w.steps || []).filter(s => s.type === 'capture')
  );
  const myConfiguredCaptures = myCaptureSteps.filter(s => s.targetFileId);
  const myCaptureRunsCompleted = myRuns.filter(r =>
    (r.stepResults || []).some(s => s.type === 'capture' && s.status === 'completed' && s.output && !/^not configured/i.test(String(s.output)))
  ).length;
  const myCaptureFiles = new Set(myConfiguredCaptures.map(s => s.targetFileId));
  const myCapturedFilesUsedByOthers = [...myCaptureFiles].filter(fid =>
    othersCoworkers.some(c =>
      (c.instructionFileIds || []).includes(fid) || (c.knowledgeFileIds || []).includes(fid)
    )
  ).length;
  dimensions.push({
    key: 'capture',
    label: 'Capture learning',
    hint: 'Turning a run into compounding knowledge or refined skills.',
    level: (() => {
      if (myCaptureSteps.length === 0) return 0;
      if (myCapturedFilesUsedByOthers > 0) return 4;
      if (myCaptureRunsCompleted >= 2) return 3;
      if (myCaptureRunsCompleted >= 1) return 2;
      return 1;
    })(),
    evidence: (() => {
      const parts = [];
      if (myConfiguredCaptures.length) parts.push(`${myConfiguredCaptures.length} capture step${myConfiguredCaptures.length === 1 ? '' : 's'} configured`);
      if (myCaptureRunsCompleted) parts.push(`${myCaptureRunsCompleted} successful run${myCaptureRunsCompleted === 1 ? '' : 's'}`);
      if (myCapturedFilesUsedByOthers) parts.push(`file${myCapturedFilesUsedByOthers === 1 ? '' : 's'} reused by peers`);
      return parts.length ? parts.join(' · ') + '.' : 'No capture steps configured.';
    })(),
  });

  // 9. Observability — now weighted toward actual review signals (decisions
  //    + activity on your runs) rather than re-counting unrelated activity.
  const runsInRoom = (workflowRuns || []).length;
  dimensions.push({
    key: 'observability',
    label: 'Observability',
    hint: 'Watching the mixed team work and acting on what you see.',
    level: (() => {
      if (runsInRoom === 0) return 0;
      // Distinct runs I had decision-log involvement on — as reviewer or as
      // owner whose run produced decisions.
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
