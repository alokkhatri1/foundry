import * as pdfjsLib from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import mammoth from 'mammoth';
import * as XLSX from 'xlsx';

// Ship the PDF.js worker with the Vite bundle rather than pulling it from
// cdnjs — version mismatches between the lib and the CDN mirror were
// blowing up at runtime with "Failed to fetch dynamically imported module".
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
const PDF_TYPES = ['application/pdf'];
const WORD_TYPES = ['application/vnd.openxmlformats-officedocument.wordprocessingml.document'];
const EXCEL_TYPES = [
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
  'text/csv',
];
const TEXT_TYPES = ['text/plain', 'text/markdown', 'text/csv', 'application/json'];

export function getFileCategory(file) {
  if (IMAGE_TYPES.includes(file.type)) return 'image';
  if (PDF_TYPES.includes(file.type)) return 'pdf';
  if (WORD_TYPES.includes(file.type)) return 'word';
  if (EXCEL_TYPES.includes(file.type) || file.name.endsWith('.csv')) return 'spreadsheet';
  if (TEXT_TYPES.includes(file.type) || file.name.endsWith('.md') || file.name.endsWith('.txt') || file.name.endsWith('.json')) return 'text';
  return 'unknown';
}

export function getFileIcon(category) {
  switch (category) {
    case 'image': return '\uD83D\uDDBC\uFE0F';
    case 'pdf': return '\uD83D\uDCC4';
    case 'word': return '\uD83D\uDCDD';
    case 'spreadsheet': return '\uD83D\uDCCA';
    case 'text': return '\uD83D\uDCC3';
    default: return '\uD83D\uDCCE';
  }
}

// Read file as ArrayBuffer
function readAsArrayBuffer(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsArrayBuffer(file);
  });
}

// Read file as text
function readAsText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsText(file);
  });
}

// Read file as base64 data URL
function readAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// Extract text from PDF
async function parsePDF(file) {
  const arrayBuffer = await readAsArrayBuffer(file);
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  const pages = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const textContent = await page.getTextContent();
    const text = textContent.items.map(item => item.str).join(' ');
    pages.push(`--- Page ${i} ---\n${text}`);
  }
  return pages.join('\n\n');
}

// Extract text from Word doc
async function parseWord(file) {
  const arrayBuffer = await readAsArrayBuffer(file);
  const result = await mammoth.extractRawText({ arrayBuffer });
  return result.value;
}

// Extract text from spreadsheet
async function parseSpreadsheet(file) {
  if (file.name.endsWith('.csv') || file.type === 'text/csv') {
    return await readAsText(file);
  }
  const arrayBuffer = await readAsArrayBuffer(file);
  const workbook = XLSX.read(arrayBuffer, { type: 'array' });
  const sheets = [];
  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    const csv = XLSX.utils.sheet_to_csv(sheet);
    sheets.push(`--- Sheet: ${sheetName} ---\n${csv}`);
  }
  return sheets.join('\n\n');
}

// Convert any filename to .md
function toMdName(name) {
  const base = name.replace(/\.[^.]+$/, '');
  return base + '.md';
}

// Wrap extracted text in clean markdown
function toMarkdown(originalName, text) {
  return `# ${originalName}\n\n${text}`;
}

/**
 * Parse a file and return content suitable for the Claude API.
 * All filenames are converted to .md.
 * Returns: { type: 'text' | 'image', content: string, fileName: string, mediaType?: string }
 */
export async function parseFile(file) {
  const category = getFileCategory(file);
  const mdName = toMdName(file.name);

  try {
    switch (category) {
      case 'image': {
        const dataUrl = await readAsDataURL(file);
        const match = dataUrl.match(/^data:(image\/\w+);base64,(.+)$/);
        if (match) {
          return { type: 'image', mediaType: match[1], content: match[2], fileName: mdName };
        }
        return { type: 'text', content: toMarkdown(file.name, '[Image could not be processed]'), fileName: mdName };
      }
      case 'pdf': {
        const text = await parsePDF(file);
        return { type: 'text', content: toMarkdown(file.name, text), fileName: mdName };
      }
      case 'word': {
        const text = await parseWord(file);
        return { type: 'text', content: toMarkdown(file.name, text), fileName: mdName };
      }
      case 'spreadsheet': {
        const text = await parseSpreadsheet(file);
        return { type: 'text', content: toMarkdown(file.name, text), fileName: mdName };
      }
      case 'text': {
        const text = await readAsText(file);
        // Already text — if it's already markdown, keep as-is
        if (file.name.endsWith('.md')) return { type: 'text', content: text, fileName: file.name };
        return { type: 'text', content: toMarkdown(file.name, text), fileName: mdName };
      }
      default:
        return { type: 'text', content: toMarkdown(file.name, `[Unsupported file type: ${file.type}]`), fileName: mdName };
    }
  } catch (error) {
    return { type: 'text', content: toMarkdown(file.name, `[Error reading file: ${error.message}]`), fileName: mdName };
  }
}
