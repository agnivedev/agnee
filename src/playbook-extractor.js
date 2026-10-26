'use strict';

const MAX_EXTRACTED_CHARS = 20_000;

// Format kantor modern = arsip zip berisi XML; dibaca lewat jszip (sudah ikut
// terpasang sebagai dependensi mammoth).
const ZIP_DOCUMENT_EXTS = ['xlsx', 'xlsm', 'pptx', 'odt', 'ods', 'odp'];
const TEXT_EXTS = ['md', 'txt', 'markdown', 'csv', 'tsv', 'json', 'html', 'htm', 'xml', 'rtf', 'yaml', 'yml', 'log'];
const LEGACY_OFFICE_EXTS = ['doc', 'xls', 'ppt'];

function extOf(filename) {
  const name = String(filename || '').toLowerCase();
  return name.includes('.') ? name.split('.').pop() : '';
}

function classifyKind(mimeType, filename) {
  const ext = extOf(filename);
  if (mimeType.startsWith('image/')) return 'image';
  if (mimeType.startsWith('video/')) return 'video';
  if (mimeType.startsWith('audio/')) return 'audio';
  if (mimeType === 'application/pdf' || ext === 'pdf') return 'document';
  if (mimeType.includes('word') || ['doc', 'docx'].includes(ext)) return 'document';
  if (mimeType.includes('spreadsheet') || mimeType.includes('presentation') || mimeType.includes('excel') || mimeType.includes('powerpoint')) return 'document';
  if ([...ZIP_DOCUMENT_EXTS, ...LEGACY_OFFICE_EXTS].includes(ext)) return 'document';
  if (mimeType.startsWith('text/') || TEXT_EXTS.includes(ext)) return 'document';
  if (['application/json', 'application/xml', 'application/rtf'].includes(mimeType)) return 'document';
  return 'other';
}

function truncate(text, maxChars = MAX_EXTRACTED_CHARS) {
  const trimmed = String(text || '').trim();
  return trimmed.length > maxChars ? `${trimmed.slice(0, maxChars)}\n\n[...dipotong, dokumen terlalu panjang...]` : trimmed;
}

/** File tanpa byte NUL dan tanpa karakter pengganti UTF-8 dianggap teks biasa. */
function looksLikeText(buffer) {
  const head = buffer.subarray(0, 8192);
  if (!head.length || head.includes(0)) return false;
  return !head.toString('utf8').includes('�');
}

function decodeXml(text) {
  return text
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec)))
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function naturalOrder(a, b) {
  return a.localeCompare(b, undefined, { numeric: true });
}

/** Excel: tiap sheet jadi bagian "## Nama sheet", tiap baris dipisah tab. */
async function readXlsx(zip) {
  const read = async (name) => (zip.file(name) ? zip.file(name).async('string') : '');
  const shared = [...(await read('xl/sharedStrings.xml')).matchAll(/<si>([\s\S]*?)<\/si>/g)]
    .map(([, si]) => decodeXml([...si.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((m) => m[1]).join('')));
  const rels = new Map([...(await read('xl/_rels/workbook.xml.rels')).matchAll(/<Relationship\b[^>]*>/g)]
    .map(([tag]) => [tag.match(/Id="([^"]+)"/)?.[1], tag.match(/Target="([^"]+)"/)?.[1]]));
  let sheets = [...(await read('xl/workbook.xml')).matchAll(/<sheet\b[^>]*>/g)].map(([tag]) => {
    const target = rels.get(tag.match(/r:id="([^"]+)"/)?.[1]) || '';
    return { name: decodeXml(tag.match(/name="([^"]*)"/)?.[1] || ''), path: target.startsWith('/') ? target.slice(1) : `xl/${target.replace(/^\.\//, '')}` };
  });
  if (!sheets.length || sheets.some((sheet) => !zip.file(sheet.path))) {
    sheets = Object.keys(zip.files).filter((n) => /^xl\/worksheets\/sheet\d+\.xml$/.test(n)).sort(naturalOrder)
      .map((p, i) => ({ name: `Sheet ${i + 1}`, path: p }));
  }
  const parts = [];
  for (const sheet of sheets) {
    const rows = [];
    for (const [, row] of (await read(sheet.path)).matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
      const cells = [...row.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)].map(([, attrs, inner = '']) => {
        const type = attrs.match(/\bt="([^"]+)"/)?.[1];
        if (type === 'inlineStr') return decodeXml([...inner.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((m) => m[1]).join(''));
        const value = inner.match(/<v>([\s\S]*?)<\/v>/)?.[1] ?? '';
        if (type === 's') return shared[Number(value)] ?? '';
        if (type === 'b') return value === '1' ? 'TRUE' : 'FALSE';
        return decodeXml(value);
      });
      if (cells.some((cell) => cell.trim())) rows.push(cells.join('\t').replace(/\t+$/, ''));
    }
    if (rows.length) parts.push(`## ${sheet.name}\n\n${rows.join('\n')}`);
  }
  return parts.join('\n\n');
}

/** PowerPoint: teks tiap slide berurutan, satu paragraf per baris. */
async function readPptx(zip) {
  const slides = Object.keys(zip.files).filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n)).sort(naturalOrder);
  const parts = [];
  for (const [index, name] of slides.entries()) {
    const xml = await zip.file(name).async('string');
    const lines = [...xml.matchAll(/<a:p\b[^>]*>([\s\S]*?)<\/a:p>/g)]
      .map(([, p]) => decodeXml([...p.matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)].map((m) => m[1]).join('')).trim())
      .filter(Boolean);
    if (lines.length) parts.push(`## Slide ${index + 1}\n\n${lines.join('\n')}`);
  }
  return parts.join('\n\n');
}

/** OpenDocument (odt/ods/odp): content.xml dengan jeda baris per paragraf dan sel. */
async function readOpenDocument(zip) {
  const xml = zip.file('content.xml') ? await zip.file('content.xml').async('string') : '';
  return decodeXml(xml
    .replace(/<text:tab\/>/g, '\t')
    .replace(/<text:line-break\/>/g, '\n')
    .replace(/<\/table:table-cell>/g, '\t')
    .replace(/<\/(text:p|text:h|table:table-row)>/g, '\n')
    .replace(/<[^>]+>/g, ''))
    .replace(/\t+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n');
}

async function readZipDocument(buffer, ext) {
  const JSZip = require('jszip');
  const zip = await JSZip.loadAsync(buffer);
  if (ext === 'xlsx' || ext === 'xlsm') return readXlsx(zip);
  if (ext === 'pptx') return readPptx(zip);
  return readOpenDocument(zip);
}

function zipExtFor(mimeType, ext) {
  if (ZIP_DOCUMENT_EXTS.includes(ext)) return ext;
  if (mimeType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet') return 'xlsx';
  if (mimeType === 'application/vnd.openxmlformats-officedocument.presentationml.presentation') return 'pptx';
  if (mimeType.startsWith('application/vnd.oasis.opendocument.')) return 'odt';
  return null;
}

/**
 * Extracts plain text from an uploaded playbook asset where feasible.
 * Images/video/audio are stored for reference only — no text is extracted from them
 * since the app has no vision/transcription pipeline.
 * Returns { kind, text, status }.
 */
async function extractPlaybookText(buffer, mimeType, filename, { maxChars = MAX_EXTRACTED_CHARS } = {}) {
  const mime = String(mimeType || '').toLowerCase();
  let kind = classifyKind(mime, filename);
  const ext = extOf(filename);

  // Jenis tak dikenal (mis. .ini, .srt, kode sumber) yang isinya teks tetap dibaca.
  if (kind === 'other' && looksLikeText(buffer)) kind = 'document';
  if (kind !== 'document') {
    return { kind, text: null, status: 'unsupported' };
  }

  try {
    if (mime === 'application/pdf' || ext === 'pdf') {
      const { PDFParse } = require('pdf-parse');
      const parser = new PDFParse({ data: buffer });
      try {
        const result = await parser.getText();
        return { kind, text: truncate(result.text, maxChars), status: 'ready' };
      } finally {
        await parser.destroy();
      }
    }
    if (ext === 'docx' || mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
      const mammoth = require('mammoth');
      const result = await mammoth.extractRawText({ buffer });
      return { kind, text: truncate(result.value, maxChars), status: 'ready' };
    }
    const zipExt = zipExtFor(mime, ext);
    if (zipExt) {
      return { kind, text: truncate(await readZipDocument(buffer, zipExt), maxChars), status: 'ready' };
    }
    if (LEGACY_OFFICE_EXTS.includes(ext) || mime === 'application/msword' || mime === 'application/vnd.ms-excel' || mime === 'application/vnd.ms-powerpoint') {
      // Format biner Office lama tidak punya pembaca pure-JS yang andal di sini.
      return { kind, text: null, status: 'unsupported' };
    }
    // text/*, .md, .txt, .csv, .json, and anything else UTF-8 readable
    return { kind, text: truncate(buffer.toString('utf8'), maxChars), status: 'ready' };
  } catch (error) {
    return { kind, text: null, status: 'failed', error: error.message };
  }
}

module.exports = { extractPlaybookText, classifyKind, looksLikeText, MAX_EXTRACTED_CHARS };
