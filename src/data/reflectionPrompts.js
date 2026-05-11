// Per-stage reflection prompts — research+industry required instrument.
// Source: research-questions.md, Section 3 (Q15-Q38).
//
// Each stage has four required questions in a fixed shape:
//   1. clarity 1-5     — "How clearly do you understand …?"
//                        (clarity scale: 1 Not clear at all → 5 Extremely clear)
//   2. agreement 1-5   — usefulness / trust / confidence per stage
//                        (agreement scale: 1 Strongly disagree → 5 Strongly agree)
//   3. text OR chip   — see per-stage `questions[2]`. Stages 3,4,6 ask
//                        a transfer-to-work text. Stage 5 asks a text.
//                        Stage 7 has no text (replaced by a second single-
//                        select). Stage 8 asks a text.
//   4. chips OR chip   — multi-select for stages 3,4,6 (barriers);
//                        single-select for 5 (feeling), 7 (troubleshoot
//                        first), 8 (behavior change).
//
// Stages 1, 2, and 9 don't reflect — Stage 1 is intro, Stage 2 is
// preferences (no primitive to consolidate yet), Stage 9 is graduation.

export const REFLECTION_STAGES = new Set(['3', '4', '5', '6', '7', '8']);

// Used by the takeaway PDF + admin export to read the wording the
// participant saw at submit time. Bump when prompt wording changes.
export const REFLECTION_TEXT_VERSION = 2;

export const REFLECTION_PROMPTS = {
  '3': {
    label: 'Files as skills',
    anchor: 'You wrote an instruction file — a skill — and watched the AI follow it. You stopped repeating instructions and started shaping how the AI should work.',
    questions: [
      {
        id: 'clarity',
        type: 'clarity',
        text: 'How clearly do you understand what a skill file does?',
      },
      {
        id: 'agreement',
        type: 'agreement',
        text: 'A skill file would be useful for my real work.',
      },
      {
        id: 'transfer',
        type: 'text',
        text: 'What kind of repeated instruction would you put into a skill file instead of typing it every time?',
        placeholder: 'A check, a tone, a checklist, a format you keep re-typing…',
      },
      {
        id: 'barriers',
        type: 'chips',
        text: 'What would make you hesitate to rely on a skill file?',
        options: [
          { v: 'wrong_application',  label: 'It might apply the instruction incorrectly' },
          { v: 'forget_contents',    label: 'I might forget what the skill contains' },
          { v: 'too_rigid',          label: 'It might make the AI too rigid' },
          { v: 'manual_control',     label: 'I would rather control each prompt manually' },
          { v: 'no_repeated_tasks',  label: 'I do not have repeated tasks where this is useful' },
          { v: 'privacy',            label: 'Privacy or company policy concerns' },
          { v: 'other',              label: 'Other' },
        ],
      },
    ],
  },
  '4': {
    label: 'Files as knowledge',
    anchor: 'You gave the AI a knowledge file before asking your question and watched it use that document as context.',
    questions: [
      {
        id: 'clarity',
        type: 'clarity',
        text: 'How clearly do you understand the difference between a skill file and a knowledge file?',
      },
      {
        id: 'agreement',
        type: 'agreement',
        text: 'Using a knowledge file would make me trust the AI’s answer more.',
      },
      {
        id: 'transfer',
        type: 'text',
        text: 'When would attaching a knowledge file be better than explaining context in the chat?',
        placeholder: 'A type of question, a kind of document, a recurring topic…',
      },
      {
        id: 'barriers',
        type: 'chips',
        text: 'What would stop you from attaching a document to an AI conversation?',
        options: [
          { v: 'confidentiality',   label: 'Confidentiality' },
          { v: 'unclear_policy',    label: 'Unclear data policy' },
          { v: 'misinterpretation', label: 'Fear of wrong interpretation' },
          { v: 'too_much_effort',   label: 'Too much effort' },
          { v: 'unsure_which',      label: 'I do not know which documents are useful' },
          { v: 'do_not_trust',      label: 'I do not trust the AI with files' },
          { v: 'other',             label: 'Other' },
        ],
      },
    ],
  },
  '5': {
    label: 'AI Coworkers',
    anchor: 'You built a named AI teammate with a role, knowledge, and skills. Same model under the hood, but now configured for a specific kind of work.',
    questions: [
      {
        id: 'clarity',
        type: 'clarity',
        text: 'How clearly do you understand what makes an AI coworker different from a regular chat?',
      },
      {
        id: 'agreement',
        type: 'agreement',
        text: 'Giving the AI a role, name, knowledge, and skills made it feel more useful.',
      },
      {
        id: 'feeling',
        type: 'chip',
        text: 'What did the AI coworker feel most like?',
        options: [
          { v: 'saved_prompt',          label: 'A saved prompt' },
          { v: 'specialized_assistant', label: 'A specialized assistant' },
          { v: 'junior_teammate',       label: 'A junior teammate' },
          { v: 'sme',                   label: 'A subject-matter expert' },
          { v: 'workflow_component',    label: 'A workflow component' },
          { v: 'chatbot_label',         label: 'A chatbot with a label' },
          { v: 'unsure',                label: 'I am not sure' },
        ],
      },
      {
        id: 'transfer',
        type: 'text',
        text: 'What would you delegate to an AI coworker that you would not delegate to a regular chat?',
        placeholder: 'A type of work, a kind of judgment, a piece of someone’s job…',
      },
    ],
  },
  '6': {
    label: 'Workflow',
    anchor: 'You connected multiple AI coworkers and a human review step into a workflow.',
    questions: [
      {
        id: 'clarity',
        type: 'clarity',
        text: 'How clearly do you understand how a workflow chains AI and human steps?',
      },
      {
        id: 'agreement',
        type: 'agreement',
        text: 'A workflow would be useful for repeated tasks in my work.',
      },
      {
        id: 'transfer',
        type: 'text',
        text: 'What makes a task suitable for an AI workflow instead of a one-off chat?',
        placeholder: 'A pattern, a frequency, a shape of work…',
      },
      {
        id: 'review_point',
        type: 'chips',
        text: 'Where should human review happen in an AI workflow?',
        options: [
          { v: 'before_start',     label: 'Before the AI starts' },
          { v: 'after_each_step',  label: 'After each AI step' },
          { v: 'before_final',     label: 'Only before the final output' },
          { v: 'when_uncertain',   label: 'Only when the AI is uncertain' },
          { v: 'high_risk',        label: 'Only for high-risk tasks' },
          { v: 'not_always',       label: 'Human review is not always needed' },
          { v: 'other',            label: 'Other' },
        ],
      },
    ],
  },
  '7': {
    label: 'Audit',
    anchor: 'You watched a workflow run play out, including steps, approvals, and tool calls.',
    questions: [
      {
        id: 'clarity',
        type: 'clarity',
        text: 'How clearly do you understand what a run log tells you?',
      },
      {
        id: 'agreement',
        type: 'agreement',
        text: 'Seeing the audit log made me more confident that I could evaluate the AI’s work.',
      },
      {
        id: 'confidence_shift',
        type: 'chip',
        text: 'After seeing the run log, how did your confidence in the AI output change?',
        options: [
          { v: 'much_less',     label: 'Much less confident' },
          { v: 'slightly_less', label: 'Slightly less confident' },
          { v: 'no_change',     label: 'No change' },
          { v: 'slightly_more', label: 'Slightly more confident' },
          { v: 'much_more',     label: 'Much more confident' },
        ],
      },
      {
        id: 'check_first',
        type: 'chip',
        text: 'When an AI output seems wrong, what would you check first?',
        options: [
          { v: 'prompt',         label: 'The original prompt' },
          { v: 'skill',          label: 'The skill/instruction file' },
          { v: 'knowledge',      label: 'The knowledge file' },
          { v: 'coworker_role',  label: 'The coworker role' },
          { v: 'workflow_step',  label: 'The workflow step where the issue appeared' },
          { v: 'review_point',   label: 'The human review or approval point' },
          { v: 'final_output',   label: 'The final output only' },
          { v: 'unsure',         label: 'I am not sure' },
        ],
      },
    ],
  },
  '8': {
    label: 'Economics',
    anchor: 'You saw the token cost of AI conversations, coworkers, and workflow runs.',
    questions: [
      {
        id: 'clarity',
        type: 'clarity',
        text: 'How clearly do you understand what drives token cost in an AI workflow?',
      },
      {
        id: 'agreement',
        type: 'agreement',
        text: 'Seeing cost information would change how I use AI.',
      },
      {
        id: 'transfer',
        type: 'text',
        text: 'When is a more expensive AI workflow worth it?',
        placeholder: 'A type of task, a level of stakes, a quality threshold…',
      },
      {
        id: 'behavior_change',
        type: 'chip',
        text: 'How would cost visibility change your behavior?',
        options: [
          { v: 'use_less',        label: 'I would use AI less' },
          { v: 'use_selectively', label: 'I would use AI more selectively' },
          { v: 'simpler_flows',   label: 'I would choose simpler workflows when possible' },
          { v: 'quality_over',    label: 'I would still prioritize quality over cost' },
          { v: 'do_not_grok',     label: 'I do not understand the cost well enough yet' },
          { v: 'no_change',       label: 'It would not change my behavior' },
          { v: 'other',           label: 'Other' },
        ],
      },
    ],
  },
};
