// Per-stage guidance the AI receives in its system prompt on the first
// message of a conversation. Keeps the AI stage-aware so it can orient
// participants toward what's currently possible — without spoiling future
// stages.

const STAGE_GUIDES = {
  '1': {
    nowAvailable: 'chat with you (the assistant) and DM other humans in the cohort via the left sidebar.',
    invitation: 'Say hi warmly. Invite them to either ask you anything or DM a coworker.',
    externalReference: null,
  },
  '2': {
    nowAvailable: 'Preferences — a Preferences button in the header lets them write about themselves (role, style, how they want responses).',
    invitation: 'Suggest they write a short paragraph about themselves. Explain that you\'ll apply it to every answer.',
    externalReference: 'This is the same idea as "Custom Instructions" in ChatGPT or "About me" in Claude — personal context.',
  },
  '3': {
    nowAvailable: 'Files — a shared document library (Files tab in the header; also a Files section in the sidebar).',
    invitation: 'Invite them to attach a file to the chat as context. Explain that you\'ll ground your answers in what they give you.',
    externalReference: 'Similar to how Notion, Obsidian, or Google Drive share knowledge — here it\'s knowledge you can reference.',
  },
  '4': {
    nowAvailable: 'Files can now be attached as skills (instructions), not just context (knowledge). A small context/skill toggle appears on each attached file chip.',
    invitation: 'Invite them to try writing an instruction file (e.g., "summarize responses in 3 bullet points") and toggle it as a skill.',
    externalReference: 'This is how Custom GPTs\' instructions work under the hood. Skill files shape HOW you respond, not WHAT you know.',
  },
  '5': {
    nowAvailable: 'AI Coworkers — they can build named AI teammates with their own instructions (skills), knowledge files, and identity (Coworkers tab in the header). A coworker is skills + knowledge + persona, full stop; producing artifacts and acting on the world is what Stage 6 (Orchestration) adds on top.',
    invitation: 'Invite them to build their first coworker. A credit analyst, a legal reviewer, a creative partner — whatever fits their work. Encourage them to think of it as packaging a way of thinking, not as a do-it-all bot.',
    externalReference: 'Like Custom GPTs or Claude Projects — bundled specialists. Same primitive you already know, just with a shared organizational context the room can see.',
  },
  '6': {
    nowAvailable: 'Orchestration — chain AI coworkers and human approval steps into a multi-step workflow. Each coworker step processes upstream output with its knowledge + instructions; each human step reviews and either approves (flow continues) or rejects with feedback (flow halts and bounces back to the previous human step for revision). This is also where coworkers stop just responding and start producing artifacts — each step can save its output to the team workspace.',
    invitation: 'Invite them to chain the coworker primitive they just felt — put a coworker, then a reviewer, then another coworker, then another reviewer. Run it. See a mixed team produce one outcome through several hands, with artifacts landing in Files for everyone to read.',
    externalReference: 'Same primitive as Temporal, n8n, or Zapier — but with AI coworkers as first-class steps and humans pausing the flow for review.',
  },
  '7': {
    nowAvailable: 'Observability — your team\'s queryable record. Every workflow run, approval, and tool call your mixed team produced is now legible to AI and to every participant in the room. This is what makes the closed loop possible: nothing important happens off-record.',
    invitation: 'Invite them to look at what\'s already happened in the workshop — the runs, the approvals they gave, the tools that fired. The framing isn\'t just accountability; it\'s that this record is what makes the next workflow smarter. Their coworkers can read it. They can read it. The substrate just got richer.',
    externalReference: 'Same role as Datadog, OpenTelemetry, or Grafana in a software system — but for a team of humans and agents working together. The deeper analogy is Diana Hu\'s "queryable organization": every important action produces an artifact the AI at the centre of the company can learn from.',
  },
  '8': {
    nowAvailable: 'Economics — a running total of their LLM spend + per-segment breakdown (chat, coworker work, workflow runs) for the workshop so far. Cost also appears per step on run detail views.',
    invitation: 'Invite them to open the Usage tab and see their accumulated spend for the workshop. The number has been ticking silently the whole time; this is the first moment it becomes visible. Point out which segment is largest and why.',
    externalReference: 'Like a cloud bill review, but for AI teammates. Output tokens cost 5\u00D7 input; caching knowledge files saves ~10\u00D7. Choices about prompt length, skill reuse, and model selection all show up here.',
  },
};

export function buildStageGuidance(stage) {
  const guide = STAGE_GUIDES[stage];
  if (!guide) return '';
  const parts = [
    `## Workshop stage: ${stage}`,
    `At this stage the participant has access to: ${guide.nowAvailable}`,
    guide.invitation ? `On your first reply in this conversation, gently: ${guide.invitation}` : '',
    guide.externalReference ? `External reference you can draw on if relevant: ${guide.externalReference}` : '',
    `Do not describe capabilities from later stages. If they ask about something not yet revealed, say "that comes later in the workshop" and move on.`,
  ].filter(Boolean);
  return parts.join('\n\n');
}
