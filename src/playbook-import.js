'use strict';

/**
 * Memecah satu dokumen playbook (Markdown, Word, PDF, teks) menjadi bagian
 * yang masing-masing masuk ke satu jenis playbook_docs. Isi dipindahkan apa
 * adanya: model hanya menebak label bagian yang judulnya tidak dikenali.
 */

const KINDS = ['persona', 'compliance', 'qna', 'discovery', 'objection', 'closing', 'followup', 'handoff'];

// Batas ekstraksi aset (20 ribu karakter) terlalu kecil untuk playbook delapan bagian;
// bagian terakhir (handoff) akan terpotong diam-diam.
const MAX_IMPORT_CHARS = 200_000;
const MAX_DOC_CHARS = 40_000;

/**
 * Kata kunci judul → jenis. Urutannya penting: yang lebih spesifik dulu,
 * karena "Larangan saat closing" harus jadi compliance, bukan closing.
 */
const HEADING_RULES = [
  ['compliance', /\b(prohibit\w*|larangan|dilarang|compliance|kepatuhan|pantangan|tidak boleh|do not|don'?t|guardrails?)\b/i],
  ['handoff', /\b(hand ?over|hand-?off|eskalasi|escalat\w*|serah\w*|alih\w* ke (manusia|tim)|ke manusia)\b/i],
  ['followup', /\b(follow[- ]?up|tindak lanjut)\b/i],
  ['objection', /\b(objection\w*|keberatan|sanggahan)\b/i],
  ['discovery', /\b(discovery|menggali|penggalian|kualifikasi|qualif\w*|brief awal)\b/i],
  ['closing', /\b(closing|menutup penjualan|penutupan)\b/i],
  ['qna', /\b(q ?& ?a|q ?n ?a|faq|questions?|tanya[- ]jawab|pertanyaan)\b/i],
  ['persona', /\b(persona|tone|gaya bicara|nada|identitas|voice)\b/i],
];

function cleanHeading(text) {
  return String(text || '')
    .replace(/^#+\s*/, '')
    .replace(/^\s*(?:\d+|[ivx]+|[a-z])[.)]\s+/i, '')
    .replace(/\*\*|__|`/g, '')
    .trim();
}

function kindFromHeading(heading) {
  const cleaned = cleanHeading(heading);
  for (const [kind, pattern] of HEADING_RULES) {
    if (pattern.test(cleaned)) return kind;
  }
  return null;
}

/**
 * Tingkat heading yang dipakai untuk memotong: yang paling dangkal di antara
 * yang muncul minimal dua kali. Judul dokumen (# satu-satunya) tidak ikut
 * memotong, dan sub-bagian (### di bawah ##) tetap menempel ke induknya.
 */
function splitLevel(lines) {
  const counts = new Map();
  let fenced = false;
  for (const line of lines) {
    if (/^\s*```/.test(line)) fenced = !fenced;
    if (fenced) continue;
    const match = line.match(/^(#{1,4})\s+\S/);
    if (match) counts.set(match[1].length, (counts.get(match[1].length) || 0) + 1);
  }
  const levels = [...counts.keys()].sort((a, b) => a - b);
  return levels.find((level) => counts.get(level) >= 2) ?? levels[0] ?? null;
}

/**
 * Dokumen tanpa heading Markdown (PDF, teks polos, Word tanpa style heading):
 * baris pendek tanpa tanda baca akhir yang judulnya dikenali sebagai jenis
 * playbook, atau bernomor seperti "3. Questions & answers", dianggap judul.
 */
function looksLikePlainHeading(line, prevBlank) {
  const text = line.trim();
  if (!prevBlank || !text || text.length > 70) return false;
  if (/[.,;:?!"”)]$/.test(text)) return false;
  if (/^[-*•]\s/.test(text)) return false;
  return /^(?:\d+|[ivx]+)[.)]\s+\S/i.test(text) || kindFromHeading(text) !== null;
}

/**
 * @returns {{ title: string|null, sections: Array<{ heading: string, body: string }> }}
 *   Bagian pertama berjudul "" kalau ada teks sebelum heading pertama.
 */
function splitSections(text) {
  const normalized = String(text || '').replace(/\r\n?/g, '\n').replace(/ /g, ' ');
  const lines = normalized.split('\n');
  const level = splitLevel(lines);

  const isHeading = level
    ? (() => {
      let fenced = false;
      return (line) => {
        if (/^\s*```/.test(line)) fenced = !fenced;
        if (fenced) return false;
        const match = line.match(/^(#{1,4})\s+\S/);
        return Boolean(match && match[1].length === level);
      };
    })()
    : null;

  let title = null;
  const sections = [];
  let current = { heading: '', lines: [] };
  lines.forEach((line, index) => {
    const prevBlank = index === 0 || !lines[index - 1].trim();
    const heading = isHeading ? isHeading(line) : looksLikePlainHeading(line, prevBlank);
    if (heading) {
      sections.push(current);
      current = { heading: cleanHeading(line), lines: [] };
      return;
    }
    // Judul dokumen (heading lebih dangkal dari tingkat potong) sebelum bagian
    // pertama disimpan terpisah, bukan dijadikan isi pembuka.
    if (level && !sections.length && !current.heading && title === null) {
      const match = line.match(/^(#{1,4})\s+(.*)$/);
      if (match && match[1].length < level) { title = cleanHeading(match[2]); return; }
    }
    current.lines.push(line);
  });
  sections.push(current);

  return {
    title,
    sections: sections
      .map((section) => ({ heading: section.heading, body: section.lines.join('\n').trim() }))
      .filter((section) => section.heading || section.body),
  };
}

/**
 * Menurunkan heading di dalam isi satu bagian supaya berada di bawah judul
 * yang ditambahkan getPlaybookContext: "## PLAYBOOK PRODUK" › "### Persona" ›
 * "#### <judul bagian tambahan>" › heading isi.
 */
function demoteHeadings(body) {
  return body.replace(/^(#{1,5})(\s+)/gm, (_, hashes, space) => `${'#'.repeat(Math.min(hashes.length + 3, 6))}${space}`);
}

/**
 * Menggabungkan bagian-bagian yang diarahkan ke jenis yang sama, urut seperti
 * di dokumen. Judul bagian yang memang bernama jenis itu ("Persona & tone")
 * dibuang karena konteks sudah memberinya judul; judul bagian tambahan
 * ("Ringkasan brand" yang diarahkan ke persona) dipertahankan supaya AI tahu
 * itu materi apa.
 *
 * @param {Array<{ heading: string, body: string, kind: string }>} sections
 * @returns {Map<string, string>} jenis → markdown
 */
function composeDocs(sections) {
  const byKind = new Map();
  for (const section of sections) {
    if (!KINDS.includes(section.kind)) continue;
    const body = demoteHeadings(String(section.body || '').trim());
    const heading = String(section.heading || '').trim();
    const keepHeading = heading && kindFromHeading(heading) !== section.kind;
    const block = keepHeading ? `#### ${heading}\n\n${body}`.trim() : body;
    if (!block) continue;
    byKind.set(section.kind, byKind.has(section.kind) ? `${byKind.get(section.kind)}\n\n${block}` : block);
  }
  return byKind;
}

/** Teks yang bisa dipecah. Word dikonversi ke Markdown supaya heading-nya tidak hilang. */
async function extractImportText(buffer, mimeType, filename) {
  const ext = String(filename || '').toLowerCase().split('.').pop();
  if (mimeType === 'application/pdf' || ext === 'pdf') {
    const { PDFParse } = require('pdf-parse');
    const parser = new PDFParse({ data: buffer });
    try {
      return (await parser.getText()).text;
    } finally {
      await parser.destroy();
    }
  }
  if (ext === 'docx' || mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
    const mammoth = require('mammoth');
    const result = await mammoth.convertToMarkdown({ buffer });
    // mammoth meng-escape tanda baca Markdown di teks biasa ("1\." , "\-");
    // di sini kita butuh teksnya, bukan Markdown yang aman ditampilkan ulang.
    return result.value.replace(/\\([\\`*_{}[\]()#+\-.!>])/g, '$1');
  }
  if (ext === 'doc') {
    throw Object.assign(new Error('Format .doc lama tidak bisa dibaca. Simpan ulang sebagai .docx, .md, atau .pdf.'), { statusCode: 415 });
  }
  if (mimeType.startsWith('text/') || ['md', 'markdown', 'txt'].includes(ext)) {
    return buffer.toString('utf8');
  }
  throw Object.assign(new Error(`Tipe file tidak didukung untuk impor playbook: ${mimeType}`), { statusCode: 415 });
}

module.exports = {
  KINDS,
  MAX_IMPORT_CHARS,
  MAX_DOC_CHARS,
  cleanHeading,
  kindFromHeading,
  splitSections,
  composeDocs,
  extractImportText,
};
