import * as pdfjsLib from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import mammoth from 'mammoth';
import * as XLSX from 'xlsx';

// Ship the PDF.js worker with the Vite bundle rather than pulling it from
// cdnjs — version mismatches between the lib and the CDN mirror were
// blowing up at runtime with "Failed to fetch dynamically imported module".
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

// Hard cap on upload size. Above this we don't even try to parse — keeps
// the browser from freezing on a 200 MB PDF and the payload small enough to
// fit through Claude's request body. Number chosen to cover a typical
// workbook deck or multi-page contract without inviting abuse.
const MAX_FILE_BYTES = 25 * 1024 * 1024; // 25 MB

const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
const PDF_TYPES = ['application/pdf'];
const WORD_TYPES = ['application/vnd.openxmlformats-officedocument.wordprocessingml.document'];
const LEGACY_WORD_TYPES = ['application/msword']; // .doc — not parseable client-side
const EXCEL_TYPES = [
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
  'text/csv',
];
const TEXT_TYPES = ['text/plain', 'text/markdown', 'text/csv', 'application/json'];

// Extensions we treat as plain-text even without a clean MIME type. Browsers
// are inconsistent about file.type for these, especially for niche formats,
// so extension-matching is the reliable fallback.
const TEXT_EXTENSIONS = new Set([
  'txt', 'md', 'markdown', 'rst', 'log',
  'json', 'jsonl', 'ndjson', 'yaml', 'yml', 'toml', 'ini', 'conf', 'env',
  'csv', 'tsv', 'psv',
  'html', 'htm', 'xml', 'svg', 'rss', 'atom',
  'js', 'jsx', 'ts', 'tsx', 'mjs', 'cjs',
  'py', 'rb', 'go', 'rs', 'java', 'kt', 'swift', 'c', 'h', 'cpp', 'hpp', 'cs',
  'sh', 'bash', 'zsh', 'fish', 'ps1',
  'sql', 'graphql', 'gql',
  'css', 'scss', 'sass', 'less',
  'vue', 'svelte', 'astro',
  'dockerfile', 'gitignore', 'editorconfig',
]);

const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp']);
const SPREADSHEET_EXTENSIONS = new Set(['xlsx', 'xls', 'xlsm', 'xlsb', 'ods', 'csv', 'tsv']);
const WORD_EXTENSIONS = new Set(['docx']);
const LEGACY_WORD_EXTENSIONS = new Set(['doc']);
const POWERPOINT_EXTENSIONS = new Set(['pptx', 'ppt']);
const PDF_EXTENSIONS = new Set(['pdf']);

function getExtension(fileName) {
  const m = /\.([^.]+)$/.exec(fileName || '');
  return m ? m[1].toLowerCase() : '';
}

export function getFileCategory(file) {
  const ext = getExtension(file.name);
  if (IMAGE_TYPES.includes(file.type) || IMAGE_EXTENSIONS.has(ext)) return 'image';
  if (PDF_TYPES.includes(file.type) || PDF_EXTENSIONS.has(ext)) return 'pdf';
  if (WORD_TYPES.includes(file.type) || WORD_EXTENSIONS.has(ext)) return 'word';
  if (LEGACY_WORD_TYPES.includes(file.type) || LEGACY_WORD_EXTENSIONS.has(ext)) return 'word-legacy';
  if (POWERPOINT_EXTENSIONS.has(ext)) return 'powerpoint';
  if (EXCEL_TYPES.includes(file.type) || SPREADSHEET_EXTENSIONS.has(ext)) return 'spreadsheet';
  if (TEXT_TYPES.includes(file.type) || TEXT_EXTENSIONS.has(ext) || (file.type || '').startsWith('text/')) return 'text';
  return 'unknown';
}

export function getFileIcon(category) {
  switch (category) {
    case 'image': return '\uD83D\uDDBC\uFE0F';
    case 'pdf': return '\uD83D\uDCC4';
    case 'word': return '\uD83D\uDCDD';
    case 'word-legacy': return '\uD83D\uDCDD';
    case 'powerpoint': return '\uD83D\uDCCA';
    case 'spreadsheet': return '\uD83D\uDCCA';
    case 'text': return '\uD83D\uDCC3';
    default: return '\uD83D\uDCCE';
  }
}

function readAsArrayBuffer(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('Could not read the file.'));
    reader.readAsArrayBuffer(file);
  });
}

function readAsText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('Could not read the file as text.'));
    reader.readAsText(file);
  });
}

function readAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('Could not read the file.'));
    reader.readAsDataURL(file);
  });
}

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

async function parseWord(file) {
  const arrayBuffer = await readAsArrayBuffer(file);
  const result = await mammoth.extractRawText({ arrayBuffer });
  return result.value;
}

async function parseSpreadsheet(file) {
  const ext = getExtension(file.name);
  if (ext === 'csv' || ext === 'tsv' || file.type === 'text/csv') {
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

// Strip tags from HTML so the AI reads content, not markup noise.
function parseHtmlLike(rawText) {
  const doc = new DOMParser().parseFromString(rawText, 'text/html');
  // Drop script/style content entirely
  doc.querySelectorAll('script, style, noscript').forEach(el => el.remove());
  const text = doc.body?.innerText || doc.documentElement?.innerText || '';
  return text.replace(/\n{3,}/g, '\n\n').trim();
}

function toMdName(name) {
  const base = name.replace(/\.[^.]+$/, '');
  return base + '.md';
}

function toMarkdown(originalName, text) {
  return `# ${originalName}\n\n${text}`;
}

function friendlyUnsupported(file) {
  const ext = getExtension(file.name);
  if (ext === 'doc') return "Legacy .doc isn't supported. Save it as .docx or export to PDF and re-upload.";
  if (ext === 'pptx' || ext === 'ppt') return "PowerPoint files aren't supported yet. Export to PDF and re-upload.";
  if (ext === 'zip' || ext === 'rar' || ext === '7z' || ext === 'tar' || ext === 'gz') return "Archive files (.zip, .rar, etc.) can't be opened here. Upload individual files instead.";
  if (ext === 'mp4' || ext === 'mov' || ext === 'mp3' || ext === 'wav' || ext === 'm4a') return "Audio/video files aren't supported. If it's a transcript, paste the text or save it as .txt and re-upload.";
  return `File type not supported (${ext ? '.' + ext : file.type || 'unknown'}). Try converting to PDF, .docx, or plain text.`;
}

/**
 * Parse a file and return content suitable for the Claude API.
 * All filenames are converted to .md.
 * Returns: { type: 'text' | 'image', content: string, fileName: string, mediaType?: string, error?: string }
 */
export async function parseFile(file) {
  const mdName = toMdName(file.name);

  // Size gate — applied before category dispatch so even unsupported types
  // bail out fast with the same size error instead of silently loading
  // megabytes into memory.
  if (file.size > MAX_FILE_BYTES) {
    const mb = (file.size / (1024 * 1024)).toFixed(1);
    const limit = (MAX_FILE_BYTES / (1024 * 1024)).toFixed(0);
    return {
      type: 'text',
      content: toMarkdown(file.name, `[This file is ${mb} MB — above the ${limit} MB upload limit. Trim or split it and try again.]`),
      fileName: mdName,
      error: 'too_large',
    };
  }

  const category = getFileCategory(file);

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
        const raw = await readAsText(file);
        const ext = getExtension(file.name);
        // HTML / XML / SVG: strip markup so the AI reads content, not tags.
        if (ext === 'html' || ext === 'htm' || ext === 'xml' || ext === 'svg') {
          return { type: 'text', content: toMarkdown(file.name, parseHtmlLike(raw)), fileName: mdName };
        }
        // Already markdown → keep as-is, don't re-wrap.
        if (ext === 'md' || ext === 'markdown') return { type: 'text', content: raw, fileName: file.name };
        return { type: 'text', content: toMarkdown(file.name, raw), fileName: mdName };
      }
      case 'word-legacy':
      case 'powerpoint':
      case 'unknown':
      default: {
        return {
          type: 'text',
          content: toMarkdown(file.name, `[${friendlyUnsupported(file)}]`),
          fileName: mdName,
          error: 'unsupported',
        };
      }
    }
  } catch (error) {
    return {
      type: 'text',
      content: toMarkdown(file.name, `[Couldn't read this file. ${error?.message || 'Unknown error.'} Try converting it to PDF or plain text.]`),
      fileName: mdName,
      error: 'parse_failed',
    };
  }
}
