// Build the post-workshop takeaway as a real (text-based) PDF using
// jsPDF's text APIs. Multi-page, paginated automatically, every word
// selectable + searchable + copyable in the resulting file.
//
// Deliberately not using html2canvas-style "render the DOM as an image
// and embed it" — that produces a giant, pixelated, untexted PDF for
// anything beyond a one-page certificate. This is a document, not a
// poster.
//
// Pure async function: hand it the participant's data, it returns a
// jsPDF instance you can call .save() on.

import { REFLECTION_PROMPTS } from '../data/reflectionPrompts';
import { LEVELS } from './graduationScorecard';

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

function fmtDate(d) {
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}

// Layout constants. A4 in points: 595 x 842.
const PAGE_W = 595;
const PAGE_H = 842;
const MARGIN_X = 56;
const MARGIN_TOP = 64;
const MARGIN_BOTTOM = 56;
const CONTENT_W = PAGE_W - MARGIN_X * 2;

const COLORS = {
  ink:       [26, 20, 16],
  inkMid:    [74, 58, 44],
  inkMuted:  [138, 122, 104],
  peachDeep: [217, 119, 87],
  rule:      [226, 211, 189],
};

export async function buildHandoutPdf({
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
  // Lazy-import so we don't pin jsPDF into the main bundle.
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });

  let y = MARGIN_TOP;

  // ─── helpers that use closure over `doc` and `y` ───
  function setColor([r, g, b]) {
    doc.setTextColor(r, g, b);
  }

  function ensureSpace(needed) {
    if (y + needed > PAGE_H - MARGIN_BOTTOM) {
      doc.addPage();
      y = MARGIN_TOP;
    }
  }

  // Wrap text and write it; advances y. Returns final y so callers can
  // stack things below it.
  function writeText(text, { font = 'helvetica', style = 'normal', size = 10, color = COLORS.ink, lineGap = 4, indent = 0, italic = false }) {
    if (!text) return;
    doc.setFont(font, italic ? 'italic' : style);
    doc.setFontSize(size);
    setColor(color);
    const lines = doc.splitTextToSize(text, CONTENT_W - indent);
    const lineHeight = size * 1.3;
    for (const line of lines) {
      ensureSpace(lineHeight);
      doc.text(line, MARGIN_X + indent, y);
      y += lineHeight;
    }
    y += lineGap;
  }

  function rule({ thickness = 0.5, color = COLORS.rule, gap = 14 } = {}) {
    ensureSpace(gap + thickness);
    doc.setDrawColor(color[0], color[1], color[2]);
    doc.setLineWidth(thickness);
    doc.line(MARGIN_X, y, MARGIN_X + CONTENT_W, y);
    y += gap;
  }

  function sectionHeading(text) {
    ensureSpace(40);
    writeText(text, { font: 'times', style: 'normal', size: 18, color: COLORS.ink, lineGap: 8 });
  }

  function sectionSub(text) {
    writeText(text, { font: 'helvetica', style: 'normal', size: 10, color: COLORS.inkMuted, lineGap: 14 });
  }

  function subheading(text) {
    ensureSpace(28);
    writeText(text, { font: 'times', style: 'normal', size: 13, color: COLORS.peachDeep, lineGap: 4 });
  }

  function fieldLine(label, value) {
    if (value == null || value === '') return;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    setColor(COLORS.inkMid);
    const labelW = doc.getTextWidth(label + ': ');
    ensureSpace(14);
    doc.text(label + ':', MARGIN_X, y);
    doc.setFont('helvetica', 'normal');
    setColor(COLORS.ink);
    const lines = doc.splitTextToSize(String(value), CONTENT_W - labelW);
    const lineHeight = 13;
    lines.forEach((line, i) => {
      if (i === 0) {
        doc.text(line, MARGIN_X + labelW, y);
      } else {
        ensureSpace(lineHeight);
        y += lineHeight;
        doc.text(line, MARGIN_X + labelW, y);
      }
    });
    y += lineHeight + 2;
  }

  function blockquote(text) {
    if (!text) return;
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(10.5);
    setColor(COLORS.inkMid);
    const indent = 16;
    const wrap = CONTENT_W - indent - 6;
    const lines = doc.splitTextToSize(text.trim(), wrap);
    const lineHeight = 14;
    const blockStart = y;
    for (const line of lines) {
      ensureSpace(lineHeight);
      doc.text(line, MARGIN_X + indent, y);
      y += lineHeight;
    }
    // Vertical rule on the left of the quote.
    doc.setDrawColor(COLORS.peachDeep[0], COLORS.peachDeep[1], COLORS.peachDeep[2]);
    doc.setLineWidth(2);
    doc.line(MARGIN_X + 4, blockStart - 11, MARGIN_X + 4, y - lineHeight + 3);
    y += 8;
  }

  // ─── 1. Header ───
  doc.setFont('times', 'normal');
  doc.setFontSize(28);
  setColor(COLORS.ink);
  ensureSpace(36);
  doc.text('Foundry workshop takeaway', MARGIN_X, y);
  y += 36;

  const date = fmtDate(new Date());
  const levelWord = (typeof level === 'number' && LEVELS[level]) ? LEVELS[level] : null;
  const headerBits = [userName || 'Participant'];
  if (orgName) headerBits.push(orgName);
  headerBits.push(date);
  if (levelWord) headerBits.push(`Level: ${levelWord}`);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  setColor(COLORS.inkMuted);
  ensureSpace(14);
  doc.text(headerBits.join('  ·  '), MARGIN_X, y);
  y += 18;

  rule();

  // ─── 2. What you learned ───
  const orderedReflectionStages = ['3', '4', '5', '6', '7', '8', '9', '10'];
  const reflectionRows = (reflections || [])
    .filter(r => orderedReflectionStages.includes(String(r.stage)))
    .sort((a, b) => Number(a.stage) - Number(b.stage));
  if (reflectionRows.length > 0) {
    sectionHeading('What you learned');
    sectionSub('Your own words across the workshop, captured stage by stage.');
    for (const r of reflectionRows) {
      const prompt = REFLECTION_PROMPTS[String(r.stage)];
      const label = prompt ? prompt.label : `Stage ${r.stage}`;
      subheading(`Stage ${r.stage}  ·  ${label}`);
      if (typeof r.confidence === 'number') {
        fieldLine('Understanding', `${r.confidence} / 5`);
      }
      if (r.note && r.note.trim()) {
        blockquote(r.note);
      }
    }
    rule();
  }

  // ─── 3. Capstone plan ───
  const filledCapstone = (capstoneRows || []).filter(row => {
    const step = (row.step || '').trim();
    const node = (row.node || '').trim();
    return step.length > 0 || node.length > 0;
  });
  if (filledCapstone.length > 0) {
    const fileById = fileLookup(flatFiles);
    sectionHeading('Your capstone plan');
    sectionSub('The end-to-end workflow you laid out, step by step.');
    filledCapstone.forEach((row, i) => {
      const num = String(i + 1).padStart(2, '0');
      const type = (row.type || 'coworker') === 'human' ? 'Human' : 'Coworker';
      const heading = (row.step || '').trim() || `Step ${i + 1}`;
      subheading(`${num}  ·  ${heading}`);
      fieldLine('Type', type);
      if (row.node && row.node.trim()) fieldLine('Role', row.node.trim());
      if (Array.isArray(row.knowledgeFileIds) && row.knowledgeFileIds.length > 0) {
        const names = row.knowledgeFileIds.map(id => nameForFile(fileById, id)).filter(Boolean);
        if (names.length) fieldLine('Reads (knowledge)', names.join(', '));
      }
      if (Array.isArray(row.skillsFileIds) && row.skillsFileIds.length > 0) {
        const names = row.skillsFileIds.map(id => nameForFile(fileById, id)).filter(Boolean);
        if (names.length) fieldLine('Produces (skills)', names.join(', '));
      }
      if (row.reviewerId) {
        fieldLine('Reviewer', nameForParticipant(participants, row.reviewerId));
      }
      if (row.remarks && row.remarks.trim()) {
        fieldLine('Notes', row.remarks.trim());
      }
      y += 4;
    });
    rule();
  }

  // ─── 4. What you built ───
  const myName = userName || '';
  const myCoworkers = (coworkers || []).filter(c => (c.createdBy || c.created_by) === myName);
  const myWorkflows = (workflows || []).filter(w => (w.createdBy || w.created_by) === myName);
  if (myCoworkers.length > 0 || myWorkflows.length > 0) {
    sectionHeading('What you built');
    if (myCoworkers.length > 0) {
      subheading(`Coworkers (${myCoworkers.length})`);
      for (const c of myCoworkers) {
        const role = (c.role || '').toString().trim();
        const trimmed = role.length > 140 ? role.slice(0, 140) + '…' : role;
        fieldLine(c.name, trimmed || '—');
      }
      y += 4;
    }
    if (myWorkflows.length > 0) {
      subheading(`Workflows (${myWorkflows.length})`);
      for (const w of myWorkflows) {
        const stepCount = Array.isArray(w.steps) ? w.steps.length : 0;
        fieldLine(w.name, `${stepCount} step${stepCount === 1 ? '' : 's'}`);
      }
      y += 4;
    }
    rule();
  }

  // ─── 5. Scorecard ───
  if (scorecard && Array.isArray(scorecard.dimensions) && scorecard.dimensions.length > 0) {
    sectionHeading('Scorecard');
    sectionSub('Six primitives, your level on each.');
    for (const d of scorecard.dimensions) {
      const word = LEVELS[d.level] || '—';
      fieldLine(d.title || d.key, word);
    }
    y += 4;
  }

  // ─── Closer ───
  ensureSpace(40);
  rule();
  writeText('Generated by Foundry. Save this somewhere you’ll see it when you next sit down to build something.', {
    font: 'helvetica',
    italic: true,
    size: 9.5,
    color: COLORS.inkMuted,
    lineGap: 4,
  });

  // Page footer (page numbers) on every page.
  const pageCount = doc.internal.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    setColor(COLORS.inkMuted);
    const label = `${i} / ${pageCount}`;
    const w = doc.getTextWidth(label);
    doc.text(label, PAGE_W - MARGIN_X - w, PAGE_H - 28);
    doc.text('Foundry workshop takeaway', MARGIN_X, PAGE_H - 28);
  }

  return { doc, filename: `${safeName(userName)}_Foundry_Takeaway.pdf` };
}
