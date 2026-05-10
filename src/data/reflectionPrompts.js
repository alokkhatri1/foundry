// Per-stage reflection prompts. Fires when the participant advances OUT
// of the listed stage. Stages 1, 2, 9 don't have a reflection — they're
// either intro (no primitive to consolidate yet) or the final scorecard.
//
// Each prompt has four pieces — three required at submit time:
//   - anchor:  italicised one-liner reminding the participant what they
//              just did. The reflection itself is the consolidation step.
//   - scaled:  1-5 understanding question, stage-specific.
//   - note:    open "in your own words" prompt that probes whether the
//              participant can articulate the primitive — the real
//              comprehension check.
//   - habit:   a small daily-practice habit they'll try this week. Phrased
//              as a habit ("what will you try"), not a project commit
//              ("pick a document, when will you do it"). The accumulated
//              answers across stages become the participant's personal
//              practice plan in the takeaway PDF.

export const REFLECTION_STAGES = new Set(['3', '4', '5', '6', '7', '8']);

export const REFLECTION_PROMPTS = {
  '3': {
    label: 'Files as skills',
    anchor: 'You wrote an instruction file — a skill — and watched the AI follow it. You stopped describing what you wanted every time and started authoring how it should think.',
    scaled: 'How clearly do you understand what a skill file does?',
    note: 'In your own words: what does a skill file change about how you work with the AI?',
    habit: 'A small experiment you’ll run this week to test a skill file in real work?',
  },
  '4': {
    label: 'Files as knowledge',
    anchor: 'You handed the AI a knowledge file before asking your question and watched it pull from the contents. Documents became its working memory for the conversation.',
    scaled: 'How clearly do you understand the difference between a skill file and a knowledge file?',
    note: 'In your own words: what does a knowledge file do that a skill file doesn’t?',
    habit: 'A small habit to make “give the AI a doc first” your default this week?',
  },
  '5': {
    label: 'AI Coworkers',
    anchor: 'You built a named AI teammate with a role, knowledge, and skills baked in. Same model under the hood, but a specific kind of helper.',
    scaled: 'How clearly do you understand what makes an AI coworker different from a chat?',
    note: 'In your own words: what does giving the AI a name, role, knowledge, and skills actually change?',
    habit: 'A moment in your week you’ll try delegating something to an AI coworker?',
  },
  '6': {
    label: 'Workflow',
    anchor: 'You composed multiple coworkers and a human review into a workflow — choreographing a small mixed team to handle one job end-to-end.',
    scaled: 'How clearly do you understand how a workflow chains coworkers and human steps?',
    note: 'In your own words: why would a workflow include a human review step?',
    habit: 'A workflow at work you’ll sketch out this week as a chain of AI + human steps?',
  },
  '7': {
    label: 'Audit',
    anchor: 'You watched a workflow run play out — every step, every approval, every tool call on the record.',
    scaled: 'How clearly do you understand what a run log tells you?',
    note: 'In your own words: what does the audit trail give you that a normal chat doesn’t?',
    habit: 'A habit you’ll start to debug or improve AI work via the audit log?',
  },
  '8': {
    label: 'Economics',
    anchor: 'You saw the bill — the actual token cost of every AI conversation, run, and coworker your team consumed.',
    scaled: 'How clearly do you understand what drives token cost in an AI workflow?',
    note: 'In your own words: what makes one workflow more expensive than another?',
    habit: 'A habit you’ll start to keep AI costs in check?',
  },
};
