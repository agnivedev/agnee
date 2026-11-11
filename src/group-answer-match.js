'use strict';

/**
 * Mencocokkan pesan grup departemen tanpa reply dan tanpa #kode ke pertanyaan
 * AI yang masih terbuka.
 *
 * Audit grup Manajemen Bestseller 11 Nov: staf menjawab santai di grup
 * ("ga ada", "yes", "ada merk alindo harga 575rb"), tetapi jawaban itu tidak
 * pernah terhubung ke pertanyaannya, jadi pertanyaan tetap terbuka, pengingat
 * jalan 4 kali, dan staf mengeluh "udah dijawab nanya lagi".
 *
 * LLM hanya memilih NOMOR pertanyaan dari daftar kandidat (atau tidak memilih),
 * dan hanya diterima bila yakin tinggi. Ragu = pesan dibiarkan, tanpa balasan
 * di grup, supaya obrolan biasa tidak diganggu.
 */

const LOOSE_WINDOW_HOURS = 24;
const MAX_CANDIDATES = 6;
const CONTEXT_MESSAGES = 6;

const SYSTEM = `Kamu membaca grup WhatsApp tim Management toko bahan bangunan. Asisten AI toko mengajukan pertanyaan ke grup ini (daftar bernomor di bawah, belum terjawab). Staf sering menjawab santai tanpa menekan reply.
Tugasmu: tentukan apakah PESAN BARU adalah jawaban untuk salah satu pertanyaan di daftar.
Aturan:
- Pesan harus berisi informasi yang menjawab pertanyaan itu: ya/tidak, ada/kosong, harga, merek, jadwal, keputusan. Jawaban singkat seperti "ga ada" atau "yes" sah bila pesan-pesan sebelumnya di grup menunjukkan itu menjawab pertanyaan tersebut.
- Obrolan biasa, sapaan, candaan, pertanyaan staf ke staf, pesan tentang urusan lain, atau keluhan bukan jawaban.
- Bila lebih dari satu pertanyaan mungkin, atau barang/topiknya tidak jelas sama, jangan memilih.
- Pilih HANYA nomor dari daftar. Lebih baik tidak memilih daripada salah memilih: jawaban yang dipilih akan diteruskan ke customer.
Jawab HANYA JSON: {"nomor": <nomor atau null>, "yakin": "tinggi" atau "rendah"}.`;

function cut(text, max) {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

/** Pesan yang tak mungkin jawaban: kosong, satu huruf, atau hanya tanda baca/emoji. */
function worthMatching(text) {
  const t = String(text || '').trim();
  return t.length >= 2 && /[\p{L}\p{N}]/u.test(t);
}

/**
 * Teks yang berasal dari bot sendiri: pemberitahuan pertanyaan/pengingat
 * (memuat #kode 6 heksa atau judul bakunya) dan balasan pencocokan.
 */
function looksLikeBotNotice(text) {
  const t = String(text || '');
  if (!t) return false;
  return /#[0-9a-f]{6}\b/i.test(t)
    || /^\*?(?:Pertanyaan dari asisten|Pengingat(?: terakhir)?\b)/i.test(t.trim())
    || /^Saya baca pesan tadi sebagai jawaban/i.test(t.trim());
}

function buildPrompt({ candidates, context, text }) {
  const list = candidates.map((q, i) => {
    const asked = cut(q.question, 280);
    const cust = q.customerText ? `\n   Pesan customer: ${cut(q.customerText, 120)}` : '';
    return `${i + 1}. ${asked}${cust}`;
  }).join('\n');
  const before = context.length
    ? `Pesan sebelumnya di grup (lama ke baru):\n${context.map((c) => `- ${cut(c, 160)}`).join('\n')}\n\n`
    : '';
  return `Pertanyaan AI yang belum terjawab:\n${list}\n\n${before}PESAN BARU: "${cut(text, 400)}"`;
}

function parseVerdict(raw, count) {
  const s = String(raw || '');
  const a = s.indexOf('{');
  const b = s.lastIndexOf('}');
  if (a < 0 || b <= a) return null;
  let json;
  try { json = JSON.parse(s.slice(a, b + 1)); } catch { return null; }
  const n = Number(json.nomor);
  if (!Number.isInteger(n) || n < 1 || n > count) return null;
  if (String(json.yakin || '').toLowerCase() !== 'tinggi') return null;
  return n - 1;
}

/**
 * `ask(prompt, systemPrompt, meta)` mengembalikan teks model. Mengembalikan
 * pertanyaan yang dijawab, atau null bila tidak ada yang cocok / gagal.
 * `context` = pesan grup sebelum pesan ini (lama ke baru).
 */
async function matchLooseAnswer({ ask, candidates, context = [], text, meta = {} }) {
  if (!worthMatching(text)) return null;
  const pool = (candidates || []).slice(0, MAX_CANDIDATES);
  if (!pool.length) return null;
  let raw;
  try {
    raw = await ask(buildPrompt({ candidates: pool, context: context.slice(-CONTEXT_MESSAGES), text }), SYSTEM, meta);
  } catch {
    return null;
  }
  const idx = parseVerdict(raw, pool.length);
  return idx === null ? null : pool[idx];
}

module.exports = { matchLooseAnswer, looksLikeBotNotice, buildPrompt, parseVerdict, worthMatching, LOOSE_WINDOW_HOURS, MAX_CANDIDATES, CONTEXT_MESSAGES };
