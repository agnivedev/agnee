'use strict';

/**
 * Skor keyakinan balasan AI (0-100), dihitung kode dari sinyal yang bisa dicek,
 * bukan diminta dari model. Skor akhir = sinyal TERLEMAH: satu pelanggaran berat
 * tidak boleh tertutup sinyal lain yang bagus.
 *
 * Tahap 1 (SHADOW): skor hanya dicatat (ai_confidence_scores), tidak mengubah
 * balasan. Ambang di bawah adalah tebakan awal untuk dikalibrasi dari data.
 *
 * Belum ada sinyal "pertanyaan customer terjawab?" (butuh model kecil) dan
 * "relay menjawab pertanyaan yang diajukan?"; `coverage` menyediakan jalurnya.
 */

const BAND_SEND = 80;
const BAND_SAFE = 50;
// Topik uang butuh keyakinan lebih tinggi untuk dikirim langsung.
const MONEY_TOPICS = new Set(['harga', 'transfer', 'ongkir', 'diskon', 'order']);
const MONEY_SEND = 90;

// Satu kalimat tunggu = satu paragraf. Dua paragraf tunggu = ganda.
const HOLD = /\b(?:pastikan|cek|konfirmasi(?:kan)?|tanyakan)\s+(?:dulu|lagi)\b|\bmohon\s+(?:ditunggu|menunggu)\b|get back ke kakak|sedang\s+(?:saya\s+)?(?:pastikan|cek)\b/i;

const LEAK_EXPLICIT = /jangan\s+kirim\b[^.\n]*\bke\s+customer|sebelum\s+jawabannya\s+masuk|\b(?:ke|kepada)\s+customer\b|\bcustomer\s+(?:minta|menanyakan|ingin|mau)\b|tidak\s+cocok\s+dengan\s+daftar\s+pos/i;
const LEAK_TEAM = /\b(?:tim|departemen|bagian)\s+(?:management|manajemen|finance|keuangan|internal|gudang)\b|\bmanagement\b/i;
const LEAK_TEAM_SOFT = /\bke\s+tim\s+terkait\b|\bdiskusikan\s+dengan\s+tim\b/i;
const NEGATIVE_WORDS = /\b(?:kosong|habis|tidak\s+ada|tidak\s+ready|inden|indent)\b/i;
const OPEN_CLOSER = /ada\s+(?:kebutuhan|barang)\s+lain|ada\s+yang\s+bisa\s+(?:saya\s+)?bantu(?:\s+lagi)?\s*\?|jangan\s+ragu\s+(?:untuk\s+)?(?:chat|menghubungi)/i;
const DISCOUNT_WORDS = /\b(?:harga\s+khusus|diskon|potongan|bisa\s+kurang|gratis\s+ongkir)\b/i;
const PROMISE = /\bbisa\s+kak\b|\bbisa\s+disiapkan\b|\bkami\s+beri\b|\bbisa\s+gratis\b/i;
const CANNOT_SEE = /tidak\s+bisa\s+(?:saya\s+)?(?:lihat|menampilkan)/i;
const INTRO = /\bsaya\s+[A-Z][a-z]+\s+dari\s+[A-Z]/;

// Skor per kode alasan dari penjaga produksi (uncertainty-guard.assess).
const ASSESS_SCORE = {
  invented_price: 0, invented_account: 0,
  stock_claim: 20, payment_claim: 20, discount_claim: 20, order_claim: 20, delivery_promise: 25,
  tool_no_result: 30, transfer_claim_unverified: 30, proof_not_attached: 30,
  empty_promise: 40,
};

const paragraphs = (text) => String(text || '').split(/\n+/).map((p) => p.trim()).filter(Boolean);

/**
 * @param {object} p
 * @param {string} p.customerText
 * @param {string} p.replyText   balasan akhir yang akan dikirim
 * @param {object} [p.assessment] hasil uncertainty-guard.assess
 * @param {Array<{role:string,content:string}>} [p.history] lama -> baru
 * @param {'ya'|'sebagian'|'tidak'|null} [p.coverage] pertanyaan customer terjawab? (belum diisi di tahap 1)
 * @param {number|null} [p.prevAiAgeSec] umur balasan AI sebelumnya di chat ini
 * @returns {{ score: number, band: 'send'|'safe'|'hold', signals: Array<{code:string, score:number}>, topic: string|null }}
 */
function score({ customerText = '', replyText = '', assessment = null, history = [], coverage = null, prevAiAgeSec = null } = {}) {
  const reply = String(replyText || '');
  const signals = [];
  const add = (code, s) => { if (!signals.some((x) => x.code === code)) signals.push({ code, score: s }); };

  for (const reason of assessment?.reasons || []) {
    if (reason.code in ASSESS_SCORE) add(`assess_${reason.code}`, ASSESS_SCORE[reason.code]);
  }

  if (LEAK_EXPLICIT.test(reply)) add('leak_internal', 0);
  else if (LEAK_TEAM.test(reply)) add('mentions_team', 40);
  else if (LEAK_TEAM_SOFT.test(reply)) add('mentions_team_soft', 55);

  if (NEGATIVE_WORDS.test(reply)) add('negative_word', 50);
  if (OPEN_CLOSER.test(reply)) add('open_closer', 50);
  if (DISCOUNT_WORDS.test(reply) && PROMISE.test(reply) && !HOLD.test(reply)) add('discount_promise', 20);
  if (CANNOT_SEE.test(reply)) add('cannot_see_photo', 60);

  const holds = paragraphs(reply).filter((p) => HOLD.test(p)).length;
  if (holds >= 2) add('double_holding', 60);

  const assistantTurns = (history || []).filter((t) => (t?.role || '') === 'assistant').map((t) => String(t.content ?? t.text ?? ''));
  if (INTRO.test(reply) && assistantTurns.some((t) => INTRO.test(t))) add('re_intro', 70);
  const last = assistantTurns[assistantTurns.length - 1];
  if (last && reply.length > 20 && reply.slice(0, 80) === last.slice(0, 80)) add('repeat_text', 40);
  if (prevAiAgeSec != null && prevAiAgeSec < 6) add('burst_race', 70);

  if (/\bper\s+pcs\b/i.test(reply) && /\bper\s+btg\b/i.test(reply) && /\bRp\s*[\d.]+/i.test(reply)) add('mixed_uom', 75);

  if (coverage === 'sebagian') add('partial_answer', 60);
  if (coverage === 'tidak') add('unanswered', 30);

  const value = signals.length ? Math.min(...signals.map((x) => x.score)) : 100;
  const topic = assessment?.topic || null;
  const sendAt = topic && MONEY_TOPICS.has(topic) ? MONEY_SEND : BAND_SEND;
  const band = value >= sendAt ? 'send' : value >= BAND_SAFE ? 'safe' : 'hold';
  return { score: value, band, signals, topic };
}

module.exports = { score, BAND_SEND, BAND_SAFE, MONEY_SEND, MONEY_TOPICS };
