// Starter Research Library, derived from research-rational.md — the literature
// and construct map already behind the instrument. Loaded once (via the "Seed
// starter library" action) so the bench isn't a blank slate; the researcher
// edits/extends from here. Theories are framework text (a lens); skills are
// structured recipes ({question, method, output_format, dimensions}).

export const SEED_THEORIES = [
  {
    name: 'Technology Acceptance Model (TAM)',
    body: 'Davis (1989). Adoption of a technology is predicted chiefly by perceived usefulness ("will it help me do my job better?") and perceived ease of use. Apply this lens when interpreting usefulness/relevance ratings, "likely to use," and the gap between finding a tool clear vs. actually intending to use it.',
  },
  {
    name: 'UTAUT',
    body: 'Venkatesh et al. (2003). Acceptance is shaped by performance expectancy, effort expectancy, facilitating conditions, and social/workplace context. Apply when relating adoption intent to role, tenure, industry, and prior tool exposure — adoption is contextual, not just individual.',
  },
  {
    name: 'Trust in Automation (appropriate reliance)',
    body: 'Lee & See (2004). Good outcomes come from *calibrated* trust — relying on automation when it is competent and not when it is not. Over-trust and under-trust are both failures. Apply when interpreting evaluation confidence, comfort delegating, trust-when-inspectable, and confidence shifts after seeing the audit log: a drop can be healthy calibration, not a problem.',
  },
  {
    name: 'Algorithm Aversion',
    body: 'Dietvorst, Simmons & Massey (2015). People disproportionately abandon algorithms after seeing them err, even when the algorithm still outperforms humans. Apply when a participant who engaged deeply rates low, or when confidence drops after the audit stage — the cause may be a single visible error, not overall quality.',
  },
  {
    name: 'Mental Models of AI',
    body: 'Bansal et al. (2019). Human-AI teams perform better when the human has an accurate model of what the AI can do, where it fails, and when to override it. Apply when relating baseline mental model (search engine / assistant / coworker / expert) to delegation choices and outcomes — framing shapes both expectations and disappointment.',
  },
  {
    name: 'Human-AI Interaction Guidelines',
    body: 'Amershi et al. (2019, CHI). Effective AI systems give users clear feedback, control, inspectability, and ways to correct or supervise. Apply when interpreting where participants want human review, what they would check first when output seems wrong, and whether inspectability increases their trust.',
  },
];

// Skills are documents (markdown). Each is a self-contained recipe: question,
// method, output. Edit them in-app, or replace with your own GitHub-hosted .md.
const skill = (name, body) => ({ name, body: body.trim() });

export const SEED_SKILLS = [
  skill('Perception shift: chat tool → work system', `
# Perception shift: chat tool → work system

**Question.** Did the workshop shift how participants frame AI — from a chat tool to something organized into repeatable work systems? For whom most, and least?

**Method.** Compare each participant's "before: AI was a chat tool" vs "after: AI as a repeatable system" survey items. Segment the shift by baseline mental model and AI familiarity. Identify who shifted most and who barely moved.

**Output.** A short narrative plus a table of mean before/after by segment, with 2–3 representative quotes from the real-task / transfer answers.
`),
  skill('Trust calibration & inspectability', `
# Trust calibration & inspectability

**Question.** Does seeing instructions, knowledge, and workflow steps (inspectability) raise trust — and is that trust calibrated or naive?

**Method.** Relate trust-when-inspectable and the Stage 7 (audit) confidence shift to evaluation confidence and satisfaction. Read drops in confidence as possible *healthy calibration* (trust-in-automation), not necessarily failure.

**Output.** A findings list: each as claim → evidence (counts + quotes) → confidence. Flag where a confidence drop looks like good calibration.
`),
  skill('Delegation-boundary taxonomy', `
# Delegation-boundary taxonomy

**Question.** Where do participants draw the line on what they will not delegate to AI, and why?

**Method.** Cluster the free-text "what would you not want AI to do, and why" answers into a taxonomy of boundary types. Note which baseline mental models and roles map to which boundaries.

**Output.** A taxonomy: each theme with a count, a one-line definition, and 2–3 verbatim quotes.
`),
  skill('Engagement type → satisfaction', `
# Engagement type → satisfaction

**Question.** Do "builders" (heavy file / workflow usage) and "talkers" (heavy chat) differ in satisfaction and perceived capability?

**Method.** Classify each participant by their usage segment mix (chat vs file_generation vs workflow_run). Relate engagement type and total tokens to satisfaction, likely-to-use, and the perception shift. Watch for the trap that more tokens ≠ more value.

**Output.** A narrative plus a 2×2 (engagement type × satisfaction) with counts, and 2 contrasting participant vignettes.
`),
  skill('Adoption predictors', `
# Adoption predictors

**Question.** What predicts intention to adopt (likely-to-use) and advocacy (would-recommend)?

**Method.** Through TAM / UTAUT, relate adoption intent to perceived usefulness / relevance, ease / clarity, baseline familiarity, role, and engagement. Note contradictions (e.g. low ratings but would-recommend = yes).

**Output.** A ranked list of predictors with supporting evidence; call out any unreliable signals in the instrument.
`),
  skill('Mental model → outcomes', `
# Mental model → outcomes

**Question.** How does the AI mental model participants arrive with (search engine / assistant / coworker / expert) shape their experience and satisfaction?

**Method.** Group by baseline mental model. Compare delegation comfort, what they'd delegate to a coworker vs a chat (Stage 5), satisfaction, and disappointment signals. Apply mental-models theory: accurate framing → calibrated expectations.

**Output.** One paragraph per mental-model group with its outcome profile and a representative quote.
`),
  skill('Where confidence dips (stage trajectory)', `
# Where confidence dips (stage trajectory)

**Question.** Across the stages, where does clarity / agreement dip — and does a mid-workshop dip predict a low final rating?

**Method.** Trace mean clarity and agreement across stages 3–8. Identify the stages with the largest drops. Test whether individuals who dipped at a stage rated lower at the end (an early-warning signal).

**Output.** A stage-by-stage trajectory summary plus the 2–3 stages that most predict low satisfaction, with evidence.
`),
  skill('Economic awareness & cost reasoning', `
# Economic awareness & cost reasoning

**Question.** After seeing token cost, how do participants reason about when an AI workflow is worth its cost?

**Method.** Combine the Stage 8 cost reflection and the "aware of cost tradeoffs" survey item with actual usage (their own token spend). Note whether heavier users reason about cost differently from lighter ones.

**Output.** Findings on cost-reasoning patterns, each with evidence and a quote; note any mismatch between stated cost-awareness and actual spend.
`),
];
