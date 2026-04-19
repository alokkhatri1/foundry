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

function countWhere(list, pred) {
  return (list || []).filter(pred).length;
}

function level(value, thresholds) {
  // thresholds = [awareness, application, mastery, influence]
  // returns the highest level whose threshold is met.
  let best = 0;
  for (let i = 0; i < thresholds.length; i++) {
    if (value >= thresholds[i]) best = i + 1;
  }
  return best;
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
}) {
  const myMessages = (conversations || []).reduce((sum, c) => sum + (c.messages || []).filter(m => m.type === 'user').length, 0);
  const myCoworkers = (coworkers || []).filter(c => c.createdBy === userName);
  const myWorkflows = (workflows || []).filter(w => w.createdBy === userName);
  const myRuns = (workflowRuns || []).filter(r => r.startedBy === userName);
  const myFiles = (flatFiles || []).filter(f => !f.createdBy || f.createdBy === userName);

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

  // Skill + knowledge file ids referenced by OTHER participants' coworkers —
  // evidence that a file I created shaped someone else's coworker.
  const myFileIds = new Set(myFiles.map(f => f.id));
  const othersCoworkers = (coworkers || []).filter(c => c.createdBy && c.createdBy !== userName);
  const myFilesUsedByOthers = myFiles.filter(f =>
    othersCoworkers.some(c =>
      (c.instructionFileIds || []).includes(f.id)
      || (c.knowledgeFileIds || []).includes(f.id)
    )
  );

  // My coworkers DM'd by someone else — approximated by any DM thread
  // that references one of my coworkers by name in its title. Crude but
  // non-zero signal; fine for MVP.
  const myCoworkerNames = new Set(myCoworkers.map(c => c.name));
  const coworkersDmdByOthers = (conversations || []).filter(c =>
    c.kind === 'dm' && myCoworkerNames.has(c.title)
    && (c.messages || []).some(m => m.authorName && m.authorName !== userName)
  ).length;

  // Dimensions -------------------------------------------------------------

  const dimensions = [];

  // 1. Personalization (Preferences)
  const prefFile = myFiles.find(f => /prefer|preference/i.test(f.name || ''));
  const prefLen = (prefFile?.content || '').length;
  dimensions.push({
    key: 'personalization',
    label: 'Personalization',
    hint: 'Teaching the AI your voice and role.',
    level: (() => {
      if (myMessages === 0) return 0;
      if (!prefFile || prefLen < 10) return 1;
      if (prefLen < 100) return 2;
      return 3;
    })(),
    evidence: prefFile
      ? `Preferences file: ${prefLen} chars.`
      : myMessages > 0 ? 'Chatted, but no preferences written yet.' : 'No activity.',
  });

  // 2. Grounding (Files as context)
  const myRealFiles = myFiles.filter(f => f.type === 'file');
  dimensions.push({
    key: 'grounding',
    label: 'Grounding',
    hint: 'Giving the AI documents to work from.',
    level: (() => {
      const n = myRealFiles.length;
      if (n === 0) return 0;
      const infl = myFilesUsedByOthers.length > 0 ? 4 : 0;
      return Math.max(infl, level(n, [1, 1, 3, 999]));
    })(),
    evidence: myRealFiles.length === 0
      ? 'No files uploaded.'
      : `${myRealFiles.length} file${myRealFiles.length === 1 ? '' : 's'} in your folders${myFilesUsedByOthers.length > 0 ? ` · ${myFilesUsedByOthers.length} used by others` : ''}.`,
  });

  // 3. Skill authoring (files containing instructions, e.g. in /skills/)
  const skillFiles = myRealFiles.filter(f => /skill|instruction/i.test(f.name || '') || /^\s*#\s*Skill/i.test(f.content || ''));
  const skillUsedInMyCoworkers = myCoworkers.some(c =>
    (c.instructionFileIds || []).some(id => skillFiles.some(f => f.id === id))
  );
  const mySkillsUsedByOthers = skillFiles.filter(f =>
    othersCoworkers.some(c => (c.instructionFileIds || []).includes(f.id))
  ).length;
  dimensions.push({
    key: 'skills',
    label: 'Skill authoring',
    hint: 'Writing reusable instructions that shape coworker behavior.',
    level: (() => {
      if (skillFiles.length === 0) return 0;
      if (!skillUsedInMyCoworkers) return 2;
      if (mySkillsUsedByOthers > 0) return 4;
      if (skillFiles.length > 1) return 3;
      return 2;
    })(),
    evidence: skillFiles.length === 0
      ? 'No skill files authored.'
      : `${skillFiles.length} skill file${skillFiles.length === 1 ? '' : 's'}${skillUsedInMyCoworkers ? ' · used in your coworker' : ''}${mySkillsUsedByOthers ? ` · reused by ${mySkillsUsedByOthers} of others' coworkers` : ''}.`,
  });

  // 4. Coworker creation
  const richCoworkers = myCoworkers.filter(c => (c.role || '').trim().length > 40 || (c.toolIds || []).length > 0);
  dimensions.push({
    key: 'coworkers',
    label: 'Coworker creation',
    hint: 'Building named AI teammates with instructions + knowledge.',
    level: (() => {
      if (myCoworkers.length === 0) return 0;
      if (coworkersDmdByOthers > 0) return 4;
      if (myCoworkers.length >= 2 && richCoworkers.length >= 1) return 3;
      return 2;
    })(),
    evidence: myCoworkers.length === 0
      ? 'No coworkers built.'
      : `${myCoworkers.length} coworker${myCoworkers.length === 1 ? '' : 's'}: ${myCoworkers.map(c => c.name).slice(0, 3).join(', ')}${myCoworkers.length > 3 ? '…' : ''}${coworkersDmdByOthers > 0 ? ' · DM\'d by peers' : ''}.`,
  });

  // 5. Mixed-team collaboration (reviews — sending and resolving)
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

  // 6. Orchestration
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

  // 7. Observability
  const nudgesGiven = 0; // not persisted cross-session; treat as unknown
  dimensions.push({
    key: 'observability',
    label: 'Observability',
    hint: 'Following the trail of what the mixed team did.',
    level: (() => {
      if ((workflowRuns || []).length === 0) return 0;
      if (myApprovals.length > 0) return 3;
      if (myRuns.length > 0) return 2;
      return 1;
    })(),
    evidence: (workflowRuns || []).length === 0
      ? 'No runs recorded yet.'
      : `${(workflowRuns || []).length} run${(workflowRuns || []).length === 1 ? '' : 's'} visible in the room, ${myApprovals.length} decision${myApprovals.length === 1 ? '' : 's'} by you.`,
  });

  // Overall band — lowest level across dimensions the user has started
  // (Level 0 dimensions don't drag the overall down — they just mean they
  // haven't touched that primitive yet). If they touched nothing, Not Started.
  const touchedLevels = dimensions.map(d => d.level).filter(l => l > 0);
  const overallLevel = touchedLevels.length === 0 ? 0 : Math.min(...touchedLevels);

  return { dimensions, overallLevel };
}
