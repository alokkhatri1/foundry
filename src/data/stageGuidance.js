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
  '5a': {
    nowAvailable: 'AI Coworkers — they can build named AI assistants with their own instruction files, knowledge files, and identity (Coworkers tab in the header).',
    invitation: 'Invite them to build their first coworker. A credit analyst, a legal reviewer, a creative partner — whatever fits their work.',
    externalReference: 'Like Custom GPTs or Claude Projects — bundled specialists. Same primitive you already know, just with a shared organizational context.',
  },
  '5b': {
    nowAvailable: 'AI Coworkers can now use tools — external APIs, connectors, or platform actions. The coworker stops just responding and can do things.',
    invitation: 'Invite them to add a tool to a coworker. This is the jump from assistant to agent.',
    externalReference: 'The shift from "GPT" to "agent" — the AI gains hands. In Liberating Structures terms, the AI is now a peer doing work, not just reflecting.',
  },
  '6': {
    nowAvailable: 'Delegation — a new tab where they can describe a piece of work and see two panels side-by-side: how it looks staffed by humans only (roles + skills) vs. a mixed team of humans and AI coworkers.',
    invitation: 'Invite them to open the Delegation tab and describe a real piece of work from their job. The two-panel view makes the routine-vs-creative split visible — what becomes AI, what stays human.',
    externalReference: 'This is the Delegation Dilemma made visible — agentic AI adoption is organizational redesign, not a technical upgrade. The heuristic: work that can live in a document + knowledge base can be an AI coworker; work that requires dynamic, creative thinking stays human.',
  },
  '7': {
    nowAvailable: 'Orchestration — the Orchestration tab (formerly Workflow) lets them chain AI coworkers, human approvals, and system actions into a multi-step process with human-in-loop checks.',
    invitation: 'Invite them to take one slice of the Delegation map they just built and make it real — wire coworkers into a sequence, add an approval step where a human signs off.',
    externalReference: 'Same primitive as Temporal, n8n, or Zapier — but with AI coworkers as first-class steps and humans pausing the flow for review.',
  },
  '8': {
    nowAvailable: 'Observability — the Observability tab (formerly Activity) shows every orchestration run, approval, and tool call on the record. The audit trail for a mixed team.',
    invitation: 'Invite them to look at what\'s already happened in the workshop — the runs, the approvals they gave, the tools that fired. This is how a mixed team stays accountable.',
    externalReference: 'Same role as Datadog, OpenTelemetry, or Grafana in a software system — but for a team of humans and agents working together.',
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
