// Code → readable label for the research data. Keys mirror the actual option
// codes in DemographicsForm / FeedbackForm / reflectionPrompts (verified
// against source). Shared by the Data tables and the data export so they stay
// consistent.
export const LABELS = {
  // tenure
  lt_1y: '<1 year', '1_3y': '1–3 years', '3_7y': '3–7 years', '7_15y': '7–15 years', gt_15y: '15+ years',
  // industry
  tech: 'Technology', finance: 'Finance', healthcare: 'Healthcare', education: 'Education',
  consulting: 'Consulting', public_sector: 'Public sector', marketing: 'Media / Marketing',
  // work type
  strategy: 'Strategy / planning', operations: 'Operations', analysis: 'Analysis / reporting',
  research: 'Research', writing: 'Writing / communication', customer: 'Customer or client work',
  product_eng: 'Product / engineering', management: 'Management',
  // ai use frequency
  never: 'Never', occasional: 'Occasionally', weekly: 'Weekly', daily: 'Daily', multi_daily: 'Multiple times a day',
  // ai tools
  chatgpt: 'ChatGPT', claude: 'Claude', gemini: 'Gemini', copilot: 'Copilot', perplexity: 'Perplexity',
  image_gen: 'Image-generation tools', internal: 'Internal company AI tool', none: 'None yet',
  // ai use cases
  drafting: 'Drafting text', summarizing: 'Summarizing documents', brainstorm: 'Brainstorming',
  data: 'Data analysis', coding: 'Coding', decision: 'Decision support',
  automation: 'Automating repeated work', not_yet: 'I do not use AI yet',
  // mental model
  search: 'A search engine', productivity: 'A productivity tool', coworker: 'A coworker',
  expert: 'An expert advisor', risky: 'A risky tool that needs supervision', unsure: 'Not sure yet',
  // adoption criteria
  accuracy: 'Accuracy', speed: 'Speed', privacy: 'Privacy', ease: 'Ease of use', control: 'Control',
  explainability: 'Explainability', cost: 'Cost', quality: 'Quality of final output',
  reviewability: 'Review/edit before use',
  // concept used first
  skill: 'Skill file', knowledge: 'Knowledge file', workflow: 'Workflow', audit: 'Audit log',
  none_yet: 'None yet',
  // reflection: skill-file barriers
  wrong_application: 'Might apply instruction incorrectly', forget_contents: 'Might forget skill contents',
  too_rigid: 'Might make AI too rigid', manual_control: 'Rather control each prompt', no_repeated_tasks: 'No repeated tasks',
  // reflection: knowledge-file barriers
  confidentiality: 'Confidentiality', unclear_policy: 'Unclear data policy',
  misinterpretation: 'Fear of wrong interpretation', too_much_effort: 'Too much effort',
  unsure_which: 'Unsure which docs useful', do_not_trust: 'Don’t trust AI with files',
  // reflection: coworker feeling
  saved_prompt: 'A saved prompt', specialized_assistant: 'A specialized assistant',
  junior_teammate: 'A junior teammate', sme: 'A subject-matter expert',
  workflow_component: 'A workflow component', chatbot_label: 'A chatbot with a label',
  // reflection: review point
  before_start: 'Before the AI starts', after_each_step: 'After each AI step',
  before_final: 'Only before final output', when_uncertain: 'Only when AI uncertain',
  high_risk: 'Only high-risk tasks', not_always: 'Not always needed',
  // reflection: confidence shift / check first / behavior change
  much_less: 'Much less confident', slightly_less: 'Slightly less confident', no_change: 'No change',
  slightly_more: 'Slightly more confident', much_more: 'Much more confident',
  prompt: 'The original prompt', coworker_role: 'The coworker role',
  workflow_step: 'The workflow step', review_point: 'The review/approval point', final_output: 'The final output only',
  use_less: 'Use AI less', use_selectively: 'Use AI more selectively', simpler_flows: 'Choose simpler workflows',
  quality_over: 'Prioritize quality over cost', do_not_grok: 'Don’t understand cost yet',
  // shared
  other: 'Other',
};

export const lbl = (v) => v == null || v === '' ? '—'
  : (LABELS[v] || String(v).replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()));

export function fmt(v) {
  if (v == null || v === '') return '—';
  if (Array.isArray(v)) return v.length ? v.map(lbl).join(', ') : '—';
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  if (typeof v === 'number') return String(v);
  return lbl(v);
}
