'use strict';

const MAX_EXTRACTED_CHARS = 20_000;

// Format kantor modern = arsip zip berisi XML; dibaca lewat jszip (sudah ikut
// terpasang sebagai dependensi mammoth).
const ZIP_DOCUMENT_EXTS = ['xlsx', 'xlsm', 'pptx', 'odt', 'ods', 'odp'];
const TEXT_EXTS = ['md', 'txt', 'markdown', 'csv', 'tsv', 'json', 'html', 'htm', 'xml', 'rtf', 'yaml', 'yml', 'log'];
const LEGACY_OFFICE_EXTS = ['doc', 'xls', 'ppt'];
const LEGACY_OFFICE_MIMES = ['application/msword', 'application/vnd.ms-excel', 'application/vnd.ms-powerpoint'];
// Batas isi arsip setelah dibuka. File 19 MB yang wajar jarang lewat dari ini;
// arsip "bom" (ratusan MB nol yang dimampatkan) bisa menghabiskan memori
// container dan menjatuhkan app untuk semua company.
const MAX_UNZIPPED_BYTES = 80 * 1024 * 1024;

// Alasan untuk pemilik, ditampilkan di layar apa adanya.
const REASONS = {
  failed: 'File rusak atau dikunci password, jadi tidak bisa dibuka.',
  tooBig: 'Isi file terlalu besar untuk dibaca. Pecah jadi beberapa file.',
  legacy: 'Format Office lama (.doc/.xls/.ppt). Simpan ulang sebagai .docx, .xlsx, atau .pptx.',
  media: 'Isi gambar, video, atau audio tidak bisa dibaca AI.',
  other: 'Jenis file ini tidak berisi teks yang bisa dibaca.',
};

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

function hasUtf16Bom(buffer) {
  return (buffer[0] === 0xff && buffer[1] === 0xfe) || (buffer[0] === 0xfe && buffer[1] === 0xff);
}

/**
 * Teks dari Windows sering bukan UTF-8: Notepad/Excel "Unicode" menyimpan
 * UTF-16 (dengan BOM), CSV Excel biasa menyimpan ANSI (Windows-1252), yang
 * dibaca sebagai UTF-8 jadi tanda tanya untuk é, –, dan sejenisnya.
 */
function decodeText(buffer) {
  if (buffer[0] === 0xff && buffer[1] === 0xfe) return new TextDecoder('utf-16le').decode(buffer.subarray(2));
  if (buffer[0] === 0xfe && buffer[1] === 0xff) return new TextDecoder('utf-16be').decode(buffer.subarray(2));
  const utf8 = new TextDecoder('utf-8').decode(buffer);
  return utf8.includes('�') ? new TextDecoder('windows-1252').decode(buffer) : utf8;
}

/** File berekstensi asing dianggap teks bila tanpa byte NUL dan hampir tanpa karakter kontrol. */
function looksLikeText(buffer) {
  if (hasUtf16Bom(buffer)) return true;
  const head = buffer.subarray(0, 8192);
  if (!head.length || head.includes(0)) return false;
  const text = decodeText(head);
  const control = text.match(/[\u0001-\u0008\u000b\u000e-\u001f\u007f]/g)?.length || 0;
  return control / text.length < 0.02;
}

function htmlToText(html) {
  return decodeXml(html
    .replace(/<(script|style|noscript)\b[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|tr|h[1-6]|section|article)>/gi, '\n')
    .replace(/<\/t[dh]>/gi, '\t')
    .replace(/<[^>]+>/g, ''))
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n');
}

function decodeXml(text) {
  return text
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec)))
    .replace(/&nbsp;/g, ' ')
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

/** Membuka arsip setelah memastikan ukuran isinya (menurut daftar isi zip) masuk akal. */
async function openZip(buffer) {
  const JSZip = require('jszip');
  const zip = await JSZip.loadAsync(buffer);
  const unzipped = Object.values(zip.files).reduce((sum, entry) => sum + (entry._data?.uncompressedSize || 0), 0);
  if (unzipped > MAX_UNZIPPED_BYTES) throw Object.assign(new Error(`isi arsip ${Math.round(unzipped / 1e6)} MB`), { reason: REASONS.tooBig });
  return zip;
}

async function readZipDocument(buffer, ext) {
  const zip = await openZip(buffer);
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
 * Returns { kind, text, status, reason? }; `reason` is shown to the owner when
 * status is not 'ready'.
 */
async function extractPlaybookText(buffer, mimeType, filename, { maxChars = MAX_EXTRACTED_CHARS } = {}) {
  const mime = String(mimeType || '').toLowerCase();
  let kind = classifyKind(mime, filename);
  const ext = extOf(filename);
  const unsupported = (reason) => ({ kind, text: null, status: 'unsupported', reason });

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
      await openZip(buffer);
      const mammoth = require('mammoth');
      const result = await mammoth.extractRawText({ buffer });
      return { kind, text: truncate(result.value, maxChars), status: 'ready' };
    }
    const zipExt = zipExtFor(mime, ext);
    if (zipExt) {
      return { kind, text: truncate(await readZipDocument(buffer, zipExt), maxChars), status: 'ready' };
    }
    // Ekstensi teks didahulukan dari MIME: Windows mengirim .csv sebagai
    // application/vnd.ms-excel, yang kalau dipercaya terbaca "Office lama".
    const textual = TEXT_EXTS.includes(ext) || mime.startsWith('text/')
      || ['application/json', 'application/xml', 'application/rtf'].includes(mime);
    if (textual) {
      const raw = decodeText(buffer);
      const html = ['html', 'htm'].includes(ext) || mime === 'text/html';
      return { kind: 'document', text: truncate(html ? htmlToText(raw) : raw, maxChars), status: 'ready' };
    }
    if (LEGACY_OFFICE_EXTS.includes(ext) || LEGACY_OFFICE_MIMES.includes(mime)) {
      // Format biner Office lama tidak punya pembaca pure-JS yang andal di sini.
      return unsupported(REASONS.legacy);
    }
    if (['image', 'video', 'audio'].includes(kind)) return unsupported(REASONS.media);
    // Jenis tak dikenal (mis. .ini, .srt, kode sumber) yang isinya teks tetap dibaca.
    if (looksLikeText(buffer)) {
      kind = 'document';
      return { kind, text: truncate(decodeText(buffer), maxChars), status: 'ready' };
    }
    return unsupported(REASONS.other);
  } catch (error) {
    return { kind, text: null, status: 'failed', error: error.message, reason: error.reason || REASONS.failed };
  }
}

module.exports = { extractPlaybookText, classifyKind, looksLikeText, decodeText, MAX_EXTRACTED_CHARS, MAX_UNZIPPED_BYTES };
