'use strict';

/**
 * Konteks "staf sudah turun tangan" untuk AI.
 *
 * Kasus ESBEJE 6–9 Nov (Rusnandar): staf menulis "kami bantu buatkan proforma
 * invoice yah", tetapi riwayat yang dibaca AI memberi SEMUA pesan keluar peran
 * "assistant" tanpa penanda penulisnya. AI mengira kalimat staf itu miliknya
 * sendiri, jadi ia menjelaskan apa itu proforma, menawarkan membuatnya "sekarang",
 * berjanji "saya cek dulu", memperkenalkan diri lagi, dan menganggap "Ok skip ya"
 * dari customer sebagai perintah operator.
 *
 * Perbaikannya ada di dua tempat yang sama-sama murni (tanpa database):
 *  - `labelStaffContent` menandai pesan yang ditulis manusia di riwayat;
 *  - `withStaffContext` menambahkan aturan membaca penanda itu ke system prompt,
 *    hanya bila riwayat memang memuat pesan staf.
 */

/** Penanda umum, tidak menyebut nama company: dipakai semua tenant. */
const MARKER_TEXT = 'Staf tim, bukan kamu';
const STAFF_PREFIX = `[${MARKER_TEXT}] `;

/** Pesan yang ditulis manusia (aplikasi Agnee atau HP) diberi penanda penulisnya. */
function labelStaffContent(content) {
  const text = String(content || '').trim();
  if (!text) return text;
  return text.startsWith(STAFF_PREFIX) ? text : `${STAFF_PREFIX}${text}`;
}

function isStaffTurn(turn) {
  return turn?.role === 'assistant' && String(turn.content || '').startsWith(STAFF_PREFIX);
}

function hasStaffTurn(history = []) {
  return (history || []).some(isStaffTurn);
}

/** Buang penanda: untuk tempat yang menampilkan isi asli (mis. perbandingan balasan). */
function stripStaffLabel(content) {
  const text = String(content || '');
  return text.startsWith(STAFF_PREFIX) ? text.slice(STAFF_PREFIX.length) : text;
}

const STAFF_CONTEXT_RULES = `## Staf manusia sudah turun tangan di chat ini
Pesan berawalan "[${MARKER_TEXT}]" di riwayat ditulis oleh manusia dari tim, BUKAN olehmu. Yang mereka janjikan atau kerjakan (proforma/invoice, jadwal, harga, pesanan, janji menghubungi) adalah urusan mereka dan dianggap sudah atau sedang dikerjakan.
- Jangan menjelaskan ulang, jangan menawarkan membuatkan, dan jangan mengulang dari awal apa yang sudah dikerjakan staf. Jangan menjanjikan "saya cek dulu" atau "saya konfirmasi ke tim" untuk hal yang staf sendiri sudah tulis di chat.
- Pesan pendek customer sesudah pesan staf ("Utk apa kak?", "Kan udh", "Ok skip ya", "Ini sistem ya") adalah tanggapan atas pesan staf itu. Lawan bicaramu SELALU customer. Jangan menganggapnya perintah operator, jangan menulis "draft", "alur otomatis", atau "kalau mau saya kirim ke customer".
- Kalau customer menunjuk bahwa hal itu sudah dikerjakan ("kan udah"), akui singkat bahwa rekan kami sudah menanganinya dan terima kasih sudah mengingatkan; jangan berjanji mengecek atau mengerjakannya lagi.
- Kalau customer bertanya soal isi pesan staf yang tidak bisa kamu jawab dari pesan staf itu sendiri, katakan singkat bahwa rekan kami yang menulisnya akan menjelaskan langsung di chat ini. Jangan menebak maksudnya dan jangan memperkenalkan diri lagi.
- Jangan meminta lagi data yang sudah diberikan customer di riwayat (alamat, jumlah, barang).
- Kalau pesan customer jelas topik baru yang tidak menyangkut yang dikerjakan staf, jawab seperti biasa.`;

/** System prompt + aturan staf, hanya bila riwayat memuat pesan staf. */
function withStaffContext(systemPrompt, history = []) {
  if (!hasStaffTurn(history)) return systemPrompt;
  const base = String(systemPrompt || '');
  if (base.includes('## Staf manusia sudah turun tangan')) return base;
  return `${base}\n\n${STAFF_CONTEXT_RULES}`;
}

/**
 * Satu giliran riwayat dari pesan WhatsApp. `authorKind` datang dari
 * `withReplyAuthors` (ai | human | broadcast); selain 'human' tidak diberi penanda.
 */
function historyTurn({ fromMe, authorKind, content }) {
  if (!fromMe) return { role: 'user', content };
  return { role: 'assistant', content: authorKind === 'human' ? labelStaffContent(content) : content };
}

module.exports = {
  STAFF_PREFIX, STAFF_CONTEXT_RULES,
  labelStaffContent, isStaffTurn, hasStaffTurn, stripStaffLabel, withStaffContext, historyTurn,
};
