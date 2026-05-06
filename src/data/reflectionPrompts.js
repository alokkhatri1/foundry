// Per-stage reflection prompts. Fires when the participant advances OUT
// of the listed stage. Stages 1, 2, 11 don't have a reflection — they're
// either intro (no primitive to consolidate yet) or the final scorecard.
//
// Each prompt has:
//   - anchor:  italicised one-liner reminding the participant what they
//              just did. The reflection is the consolidation step.
//   - scaled:  1-5 confidence question, stage-specific.
//   - note:    optional free-text cue, deliberately concrete.

export const REFLECTION_STAGES = new Set(['3', '4', '5', '6', '7', '8', '9', '10']);

export const REFLECTION_PROMPTS = {
  '3': {
    label: 'Files as context',
    anchor: 'You just handed the AI a file before asking your question and watched it pull from the contents in its answer. Files became its working memory for that conversation.',
    scaled: 'How comfortable do you feel doing this with a real document from your own work?',
    note: 'What surprised you about how the AI used the file — good or bad?',
  },
  '4': {
    label: 'Files as skills',
    anchor: 'You moved from giving the AI raw information to giving it instructions — a skill file telling it how to think about a task.',
    scaled: 'How well do you feel you could write a skill file for a job you actually do?',
    note: 'Did the AI follow your instructions the way you expected? Where did it drift?',
  },
  '5': {
    label: 'AI Coworkers',
    anchor: 'You built a named AI teammate with a role, knowledge, and skills baked in. Same model under the hood, but a specific kind of helper.',
    scaled: 'How confident are you that you could build a coworker for a real role on your team?',
    note: 'Did giving it a name and persona change how you used it? How?',
  },
  '6': {
    label: 'Orchestration',
    anchor: 'You composed multiple coworkers and a human review into a workflow — choreographing a small mixed team to handle one job end-to-end.',
    scaled: 'Could you sketch a real workflow at work as a chain of AI + human steps?',
    note: 'Where would you put the human checkpoints in your real workflow, and why?',
  },
  '7': {
    label: 'Observability',
    anchor: 'You watched a workflow run play out — every step, every approval, every tool call on the record.',
    scaled: 'How well could you read a run log and explain to a colleague what happened?',
    note: 'What did the run reveal about your workflow that you couldn’t see in a normal chat?',
  },
  '8': {
    label: 'Capstone',
    anchor: 'You laid out a full real-world workflow as a step-by-step plan — coworkers, knowledge, skills, human checks.',
    scaled: 'How real and runnable does the workflow you just designed feel?',
    note: 'What’s the riskiest step in your plan, and why?',
  },
  '9': {
    label: 'Copilot',
    anchor: 'You sent your capstone plan to the workflow copilot and let it build alongside you.',
    scaled: 'How confident are you driving the copilot to build a workflow on your own?',
    note: 'Where did the copilot help most? Where did it slow you down?',
  },
  '10': {
    label: 'Economics',
    anchor: 'You saw the bill — the actual token cost of every AI conversation, run, and coworker your team consumed.',
    scaled: 'How clearly do you understand which parts of an AI workflow drive cost?',
    note: 'After seeing the numbers, what would you do differently in a real deployment?',
  },
};
