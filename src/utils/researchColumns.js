// Shared column definitions for the research data — used by BOTH the on-screen
// Data tables and the Excel export, so the download mirrors the bench exactly
// (same columns, same order, same full-question headers). `agg` is only used by
// the on-screen aggregate pills; the export ignores it.

export const DEMO_COLS = [
  { key: 'role', label: 'What is your role or job title?' },
  { key: 'tenure_band', label: 'How long have you been in your current role?', agg: 'cat' },
  { key: 'industry', label: 'Which industry are you in?', agg: 'cat' },
  { key: 'work_type', label: 'Which best describes the type of work you do?', agg: 'multi' },
  { key: 'ai_familiarity', label: 'How familiar are you with AI tools today? (1–5)', agg: 'mean' },
  { key: 'ai_use_frequency', label: 'How often do you use AI tools right now?', agg: 'cat' },
  { key: 'ai_tools', label: 'Which AI tools have you used?', agg: 'multi' },
  { key: 'ai_use_cases', label: 'What do you usually use AI for?', agg: 'multi' },
  { key: 'ai_mental_model', label: 'Which statement best describes how you currently think about AI?', agg: 'cat' },
  { key: 'evaluation_confidence', label: 'I can usually tell when an AI answer is good enough to use. (1–5)', agg: 'mean' },
  { key: 'delegation_comfort', label: 'I feel comfortable delegating a work task to AI if I can review the output. (1–5)', agg: 'mean' },
  { key: 'adoption_criteria_top3', label: 'When deciding whether to use AI, what matters most? (top 3, ranked)', agg: 'multi' },
  { key: 'delegation_boundary', label: 'What kind of work would you not want AI to do for you? Why?' },
];

export const SURVEY_COLS = [
  { key: 'satisfaction', label: 'Overall, I was satisfied with the workshop. (1–5)', agg: 'mean' },
  { key: 'relevance', label: 'The workshop content was relevant to my role or work. (1–5)', agg: 'mean' },
  { key: 'clarity', label: 'The workshop was clearly organized. (1–5)', agg: 'mean' },
  { key: 'theory_practice', label: 'The balance between explanation and hands-on practice was appropriate. (1–5)', agg: 'mean' },
  { key: 'improved_skills', label: 'The workshop improved my ability to use AI at work. (1–5)', agg: 'mean' },
  { key: 'identify_ai_tasks', label: 'I can identify tasks in my work that are suitable for AI. (1–5)', agg: 'mean' },
  { key: 'identify_human_review', label: 'I can identify tasks that should still require human review. (1–5)', agg: 'mean' },
  { key: 'likely_to_use', label: 'I am likely to use at least one Foundry concept in my real work. (1–5)', agg: 'mean' },
  { key: 'concept_used_first', label: 'Which Foundry concept are you most likely to use first?', agg: 'cat' },
  { key: 'real_task_text', label: 'What is one real task where you could imagine using Foundry?' },
  { key: 'foundry_improvement_text', label: 'What is one thing that would make Foundry easier to use?' },
  { key: 'platform_rating', label: 'The Foundry platform was easy to navigate. (1–5)', agg: 'mean' },
  { key: 'platform_reliability', label: 'The platform was reliable during the workshop. (1–5)', agg: 'mean' },
  { key: 'platform_support', label: 'The platform helped me understand AI workflows better than a lecture alone. (1–5)', agg: 'mean' },
  { key: 'ai_was_chat_tool', label: 'Before this workshop, I mostly thought of AI as a chat tool. (1–5)', agg: 'mean' },
  { key: 'ai_repeatable_systems', label: 'After this workshop, I see AI as something organized into repeatable work systems. (1–5)', agg: 'mean' },
  { key: 'aware_human_oversight', label: 'After this workshop, I feel more aware of where AI needs human oversight. (1–5)', agg: 'mean' },
  { key: 'aware_cost_tradeoffs', label: 'After this workshop, I feel more aware that AI use involves cost/resource tradeoffs. (1–5)', agg: 'mean' },
  { key: 'trust_when_inspectable', label: 'I would trust AI more when I can inspect its instructions, knowledge, and workflow steps. (1–5)', agg: 'mean' },
  { key: 'would_recommend', label: 'Would you recommend this workshop to a colleague?', agg: 'yesno' },
  { key: 'most_valuable', label: 'What was most valuable? (legacy)' },
];

// Reflection stages (the stages that have a reflection form).
export const REFLECTION_STAGES = ['3', '4', '5', '6', '7', '8'];
export const STAGE_NAME = { 3: 'Skills', 4: 'Knowledge', 5: 'Coworkers', 6: 'Workflow', 7: 'Audit', 8: 'Economics' };
