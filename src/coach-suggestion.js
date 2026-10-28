'use strict';

/**
 * Aksi atas "balasan yang lebih baik" dari penilaian Uji AI: logika murni
 * (tanpa database, tanpa jaringan).
 *
 * Saran balasan hanya perbaikan untuk satu pesan. Supaya Agnes benar-benar
 * membaik, saran itu disaring jadi satu Fakta umum (pertanyaan + jawaban),
 * disimulasikan sebelum/sesudah, baru diterapkan. Semua penolakan terjadi di
 * kode, bukan di prompt: saran model sering memuat "Rp ..." kosong atau janji
 * "harga saya infokan nanti" yang bertentangan dengan playbook.
 */

const crypto = require('node:crypto');
const { CATEGORIES, validateCandidate, normalizeBody } = require('./knowledge-proposals');

/** Simulasi yang dipakai untuk menerapkan harus masih segar. */
const SIMULATION_TTL_MS = 30 * 60 * 1000;

// "Rp ...", "Rp …", atau tiga titik di tengah kalimat: angka yang belum diisi.
const PLACEHOLDER = /rp\s*(?:\.{2,}|…)|\.{3,}|…|\[[^\]]*\]|\bxxx+\b/i;

function findPlaceholder(text) {
  return PLACEHOLDER.test(String(text || ''));
}

const DISTILL_SYSTEM_PROMPT = `Kamu menyaring "balasan yang lebih baik" dari penilai menjadi SATU Fakta umum untuk playbook sebuah bisnis.

Fakta = informasi bisnis yang benar dan berlaku untuk banyak customer (kebijakan, cara kerja, jawaban tetap atas pertanyaan yang sering muncul).
Bukan Fakta: gaya bahasa, urutan funnel, nada, cara menutup pesan, sapaan. Itu urusan aturan playbook, bukan Fakta.

Aturan:
- Pakai HANYA informasi yang ada di balasan yang dinilai, balasan saran, atau catatan penilai. Jangan menambah harga, angka, stok, jadwal, atau janji.
- Kalau saran memuat angka kosong ("Rp ..."), titik-titik, atau janji menunda ("saya infokan nanti"), bagian itu TIDAK ikut ke Fakta.
- Tulis pertanyaan seperti customer menanyakannya (umum, tanpa nama atau nomor). Jawaban singkat, benar, siap dibacakan, maksimal 500 karakter.
- Kalau tidak ada informasi bisnis yang layak dijadikan Fakta, putuskan "discard" dan jelaskan alasannya dalam satu kalimat.

Balas HANYA JSON:
{"decision":"fact"|"discard","reason":"satu kalimat","question":"","answer":"","category":"profile|product|pricing|faq|funnel|objection|closing"}`;

function distillUserPrompt({ mode, customerMessage, aiReply, suggestedReply, issues }) {
  const decide = mode === 'accept'
    ? 'Pengguna sudah memutuskan MENERIMA perbaikan ini. Susun Fakta terdekat dari isinya. Putuskan "discard" hanya bila benar-benar tak ada informasi bisnis di dalamnya.'
    : 'Putuskan sendiri: jadikan Fakta hanya bila informasinya benar-benar umum dan berguna untuk customer lain; selain itu "discard".';
  return [
    decide,
    `PESAN CUSTOMER: ${String(customerMessage || '').slice(0, 600)}`,
    aiReply ? `BALASAN YANG DINILAI: ${String(aiReply).slice(0, 1200)}` : '',
    `BALASAN SARAN PENILAI: ${String(suggestedReply || '').slice(0, 1200)}`,
    issues?.length ? `CATATAN PENILAI:\n- ${issues.slice(0, 6).map((i) => String(i).slice(0, 240)).join('\n- ')}` : '',
  ].filter(Boolean).join('\n\n');
}

function extractJson(text) {
  const raw = String(text || '');
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try { return JSON.parse(raw.slice(start, end + 1)); } catch { return null; }
}

/**
 * Mengubah keluaran model jadi keputusan yang pasti bentuknya.
 * - mode 'auto': "discard" dihormati.
 * - mode 'accept': "discard" tetap menghasilkan draf dari balasan saran mentah
 *   (needsEdit) supaya orang yang menerima bisa memperbaikinya sendiri.
 * `problems` selalu berisi alasan draf belum layak simulasi.
 */
function parseDistill(text, { mode, customerMessage, suggestedReply }) {
  const parsed = extractJson(text);
  const fallback = {
    question: String(customerMessage || '').replace(/\s+/g, ' ').trim().slice(0, 200),
    answer: String(suggestedReply || '').replace(/\s+/g, ' ').trim().slice(0, 600),
    category: 'faq',
  };
  const modelDiscard = !parsed || parsed.decision === 'discard';
  const reason = String(parsed?.reason || '').trim().slice(0, 300)
    || (parsed ? 'Tidak ada informasi bisnis umum di saran ini.' : 'Penyaring tidak memberi jawaban yang bisa dibaca.');

  if (modelDiscard && mode === 'auto') {
    return { decision: 'discard', reason, draft: null, problems: [], needsEdit: false };
  }
  const draft = modelDiscard
    ? fallback
    : {
      question: String(parsed.question || '').replace(/\s+/g, ' ').trim(),
      answer: String(parsed.answer || '').replace(/[ \t]+/g, ' ').trim(),
      category: CATEGORIES.includes(parsed.category) ? parsed.category : 'faq',
    };
  return {
    decision: 'fact',
    reason: modelDiscard ? `${reason} Draf diambil dari saran apa adanya; periksa dan sunting dulu.` : reason,
    draft,
    problems: draftProblems(draft),
    needsEdit: modelDiscard,
  };
}

const PROBLEM_TEXT = {
  'panjang pertanyaan': 'Pertanyaan terlalu pendek atau terlalu panjang (8–200 karakter).',
  'panjang jawaban': 'Jawaban terlalu pendek atau terlalu panjang (12–600 karakter).',
  'data pribadi': 'Hapus nomor telepon, email, atau nomor rekening dari teks ini.',
  placeholder: 'Masih ada angka kosong ("Rp ...") atau tanda titik-titik/kurung; isi dengan data sebenarnya atau hapus.',
};

/** Daftar alasan draf belum boleh disimulasikan; kosong = layak. */
function draftProblems(draft) {
  const problems = [];
  if (findPlaceholder(draft.answer) || findPlaceholder(draft.question)) problems.push(PROBLEM_TEXT.placeholder);
  const checked = validateCandidate(draft, { manual: true });
  if (!checked.ok && checked.reason !== 'placeholder') {
    problems.push(PROBLEM_TEXT[checked.reason] || `Jawaban ditolak: ${checked.reason.replace(/^klaim: /, 'mengandung klaim ')}.`);
  }
  return [...new Set(problems)];
}

/** Draf yang sudah dinormalkan, atau { problems }. */
function checkDraft(raw) {
  const problems = draftProblems({ question: raw?.question, answer: raw?.answer, category: raw?.category });
  if (problems.length) return { ok: false, problems };
  const checked = validateCandidate(raw, { manual: true });
  return {
    ok: true,
    question: checked.question,
    answer: checked.answer,
    category: checked.category,
    customerMessage: String(raw?.customerMessage || checked.question).replace(/\s+/g, ' ').trim().slice(0, 400),
  };
}

function simulationKey(companyId, { question, answer }) {
  const basis = `${companyId}|${normalizeBody(question)}|${normalizeBody(answer)}`;
  return crypto.createHash('sha1').update(basis).digest('hex');
}

/**
 * Apakah hasil simulasi boleh dilanjutkan ke "Terapkan". Yang memblokir:
 * ada pertanyaan tanpa balasan sesudahnya, atau balasan sesudahnya melanggar
 * aturan gaya. Nilai penilai (judge) hanya peringatan, keputusannya manusia.
 */
function evaluateSimulation(rows) {
  const list = Array.isArray(rows) ? rows : [];
  const reasons = [];
  if (!list.length) reasons.push('Simulasi tidak menghasilkan baris.');
  if (list.some((row) => !row.after)) reasons.push('Sebagian pertanyaan uji tidak mendapat balasan "sesudah".');
  const broken = list.filter((row) => row.rules && row.rules.passed === false).length;
  if (broken) reasons.push(`${broken} balasan "sesudah" melanggar aturan gaya.`);
  const warnings = list.filter((row) => row.judge && row.judge.verdict !== 'pass').length;
  return { blocked: reasons.length > 0, reasons, judgeWarnings: warnings };
}

module.exports = {
  SIMULATION_TTL_MS,
  DISTILL_SYSTEM_PROMPT,
  distillUserPrompt,
  parseDistill,
  checkDraft,
  draftProblems,
  findPlaceholder,
  simulationKey,
  evaluateSimulation,
};
