// Builds a personalised post-workshop takeaway as a markdown string.
// Pure function: hand it the participant's data, get back a doc they
// can paste into Notion / Confluence / Obsidian / a wiki.
//
// Sections (in order):
//   1. Header — name, org, date, level
//   2. What you learned — per-stage understanding ratings + their notes
//   3. Your capstone plan — the workflow rows they laid out
//   4. What you built — coworkers + workflows credited to them
//   5. Scorecard — six dimensions with their level word
//
// Empty sections are skipped so a participant who didn't reach the
// capstone, for instance, doesn't get a "Your capstone plan" header
// followed by nothing.

import { REFLECTION_PROMPTS } from '../data/reflectionPrompts';
import { LEVELS } from './graduationScorecard';

function fmtDate(d) {
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}

function safeName(s) {
  return (s || 'Participant').replace(/[^a-zA-Z0-9_-]+/g, '_');
}

function fileLookup(flatFiles) {
  const byId = new Map();
  for (const f of (flatFiles || [])) byId.set(f.id, f);
  return byId;
}

function nameForFile(byId, id) {
  const f = byId.get(id);
  return f ? f.name : id;
}

function nameForParticipant(participants, id) {
  const p = (participants || []).find(x => x.id === id);
  return p ? p.name : id;
}

export function buildHandoutMarkdown({
  userName,
  orgName,
  level,
  scorecard,
  reflections,
  capstoneRows,
  coworkers,
  workflows,
  flatFiles,
  participants,
}) {
  const lines = [];
  const date = fmtDate(new Date());
  const levelWord = (typeof level === 'number' && LEVELS[level]) ? LEVELS[level] : null;

  // ─────── Header ───────
  lines.push(`# Foundry workshop takeaway`);
  lines.push('');
  const headerBits = [`**${userName || 'Participant'}**`];
  if (orgName) headerBits.push(orgName);
  headerBits.push(date);
  if (levelWord) headerBits.push(`Level: ${levelWord}`);
  lines.push(headerBits.join('  ·  '));
  lines.push('');
  lines.push('---');
  lines.push('');

  // ─────── What you learned (reflections) ───────
  const orderedReflectionStages = ['3', '4', '5', '6', '7', '8', '9', '10'];
  const reflectionRows = (reflections || [])
    .filter(r => orderedReflectionStages.includes(String(r.stage)))
    .sort((a, b) => Number(a.stage) - Number(b.stage));
  if (reflectionRows.length > 0) {
    lines.push(`## What you learned`);
    lines.push('');
    lines.push('Your own words across the workshop, captured stage by stage.');
    lines.push('');
    for (const r of reflectionRows) {
      const prompt = REFLECTION_PROMPTS[String(r.stage)];
      const label = prompt ? prompt.label : `Stage ${r.stage}`;
      lines.push(`### Stage ${r.stage} · ${label}`);
      if (typeof r.confidence === 'number') {
        lines.push(`**Understanding:** ${r.confidence} / 5`);
        lines.push('');
      }
      if (r.note && r.note.trim()) {
        // Quote the participant's own writing so it stands out as theirs.
        for (const line of r.note.trim().split('\n')) lines.push(`> ${line}`);
        lines.push('');
      }
    }
    lines.push('---');
    lines.push('');
  }

  // ─────── Capstone plan ───────
  const filledCapstone = (capstoneRows || []).filter(row => {
    const step = (row.step || '').trim();
    const node = (row.node || '').trim();
    return step.length > 0 || node.length > 0;
  });
  if (filledCapstone.length > 0) {
    const fileById = fileLookup(flatFiles);
    lines.push(`## Your capstone plan`);
    lines.push('');
    lines.push('The end-to-end workflow you laid out, step by step.');
    lines.push('');
    filledCapstone.forEach((row, i) => {
      const num = String(i + 1).padStart(2, '0');
      const type = (row.type || 'coworker') === 'human' ? 'Human' : 'Coworker';
      const heading = (row.step || '').trim() || `Step ${i + 1}`;
      lines.push(`### ${num}  ·  ${heading}`);
      lines.push(`- **Type:** ${type}`);
      if (row.node && row.node.trim()) lines.push(`- **Role:** ${row.node.trim()}`);
      if (Array.isArray(row.knowledgeFileIds) && row.knowledgeFileIds.length > 0) {
        const names = row.knowledgeFileIds.map(id => nameForFile(fileById, id)).filter(Boolean);
        if (names.length) lines.push(`- **Reads (knowledge):** ${names.join(', ')}`);
      }
      if (Array.isArray(row.skillsFileIds) && row.skillsFileIds.length > 0) {
        const names = row.skillsFileIds.map(id => nameForFile(fileById, id)).filter(Boolean);
        if (names.length) lines.push(`- **Produces (skills):** ${names.join(', ')}`);
      }
      if (row.reviewerId) {
        lines.push(`- **Reviewer:** ${nameForParticipant(participants, row.reviewerId)}`);
      }
      if (row.remarks && row.remarks.trim()) {
        lines.push(`- **Notes:** ${row.remarks.trim()}`);
      }
      lines.push('');
    });
    lines.push('---');
    lines.push('');
  }

  // ─────── What you built ───────
  const myName = userName || '';
  const myCoworkers = (coworkers || []).filter(c => (c.createdBy || c.created_by) === myName);
  const myWorkflows = (workflows || []).filter(w => (w.createdBy || w.created_by) === myName);
  if (myCoworkers.length > 0 || myWorkflows.length > 0) {
    lines.push(`## What you built`);
    lines.push('');
    if (myCoworkers.length > 0) {
      lines.push(`### Coworkers (${myCoworkers.length})`);
      for (const c of myCoworkers) {
        const role = (c.role || '').toString().trim();
        lines.push(`- **${c.name}**${role ? ` — ${role.slice(0, 120)}${role.length > 120 ? '…' : ''}` : ''}`);
      }
      lines.push('');
    }
    if (myWorkflows.length > 0) {
      lines.push(`### Workflows (${myWorkflows.length})`);
      for (const w of myWorkflows) {
        const stepCount = Array.isArray(w.steps) ? w.steps.length : 0;
        lines.push(`- **${w.name}** — ${stepCount} step${stepCount === 1 ? '' : 's'}`);
      }
      lines.push('');
    }
    lines.push('---');
    lines.push('');
  }

  // ─────── Scorecard ───────
  if (scorecard && Array.isArray(scorecard.dimensions) && scorecard.dimensions.length > 0) {
    lines.push(`## Scorecard`);
    lines.push('');
    lines.push('Six primitives, your level on each.');
    lines.push('');
    for (const d of scorecard.dimensions) {
      const word = LEVELS[d.level] || '—';
      lines.push(`- **${d.title || d.key}** — ${word}`);
    }
    lines.push('');
  }

  // Closer
  lines.push('---');
  lines.push('');
  lines.push('_Generated by Foundry. Save this somewhere you\'ll see it when you next sit down to build something._');
  lines.push('');

  return { content: lines.join('\n'), filename: `${safeName(userName)}_Foundry_Takeaway.md` };
}
