'use strict';

/**
 * Penjaga chat yang bukan customer.
 *
 * Audit ESBEJE 9 Nov: 19% balasan AI terkirim ke yang bukan customer. Bot
 * tagihan (SPayLater, SPinjam, Telkomsel Halo) dibalas seperti pembeli, dan
 * teman pemilik yang mengira nomor itu nomor pribadinya dibalas 31 kali dengan
 * kalimat yang sama ("Ada yang bisa saya bantu terkait bahan bangunan?").
 * Aturan "tiga giliran tanpa kemajuan" sudah ada di prompt dan tidak dipatuhi,
 * jadi keduanya ditegakkan di sini.
 */

// Pesan tagihan, OTP, dan pemberitahuan otomatis. Satu pola kuat sudah cukup;
// pola lemah (sebut "tagihan" saja) butuh pasangan supaya customer yang menulis
// "tagihan saya kemarin sudah dibayar" tidak ikut terbuang.
const STRONG_NOTICE = [
  /\bjatuh\s+tempo\b/i,
  /\bmohon\s+abaikan\s+pesan\s+ini\b/i,
  /\babaikan\s+pesan\s+ini\s+jika\b/i,
  /\b(?:kode\s+)?otp\b.*\b(?:jangan|rahasiakan|berikan)\b/i,
  /\bkode\s+verifikasi\b/i,
  /\b(?:spaylater|spinjam|kredivo|akulaku|gopaylater|indodana|kartu\s+kredit\s+anda)\b/i,
  /\bpengingat\s+tagihan\b/i,
  /\bmsisdn\b/i,
];
const WEAK_NOTICE = [
  /\btagihan\b/i,
  /\bsegera\s+(?:lakukan\s+)?(?:pembayaran|bayar|selesaikan)\b/i,
  /\bcall\s+center\b/i,
  /\bpelanggan\s+yth\b/i,
  /\bnomor\s+anda\b/i,
];

/** Teks pemberitahuan otomatis (tagihan, OTP), bukan tulisan orang. */
function isAutomatedNotice(text) {
  const t = String(text || '');
  if (!t.trim()) return false;
  if (STRONG_NOTICE.some((re) => re.test(t))) return true;
  return WEAK_NOTICE.filter((re) => re.test(t)).length >= 2;
}

// Jenis pesan yang hanya dikirim akun bisnis lewat template resmi WhatsApp.
// Customer biasa tidak bisa mengirimnya.
const BUSINESS_TEMPLATE_TYPES = new Set(['notification_template']);

/** Pesan ini sendiri berjenis template akun bisnis. */
function isBusinessTemplateType(type) {
  return BUSINESS_TEMPLATE_TYPES.has(String(type || ''));
}

// Balasan AI yang hanya menawarkan bantuan tanpa isi: inilah yang diulang 31
// kali di chat teman pemilik.
const GENERIC_OFFER = [
  /\bada\s+yang\s+bisa\s+\S+\s+bantu\b/i,
  /\bada\s+kebutuhan\b.*\?/i,
  /\b(?:kakak|kak|anda)\s+(?:lagi|sedang)\s+cari\s+(?:apa|produk)\b/i,
  /\bsalah\s+sambung\b/i,
  /\bsaya\s+tidak\s+mengerti\s+maksud/i,
  /\bbukan\s+nomor\s+pribadi\b/i,
  /\bsiap\s+bantu\b/i,
  /\bmungkin\s+ada\s+yang\s+(?:sedang\s+)?dicari\b/i,
];

/**
 * Balasan yang isinya cuma tawaran bantuan: cocok pola tawaran, dan tidak
 * memuat angka harga atau keterangan barang yang panjang.
 */
function isGenericOffer(text) {
  const t = String(text || '').trim();
  if (!t) return false;
  if (/\brp\.?\s*\d/i.test(t)) return false;
  if (!GENERIC_OFFER.some((re) => re.test(t))) return false;
  // Balasan panjang yang kebetulan ditutup "ada yang bisa dibantu lagi?"
  // biasanya membawa isi; batasnya longgar karena perkenalan ulang juga panjang.
  return t.length <= 320;
}

// Tanda customer sedang membicarakan jual-beli. Sengaja longgar: lebih baik
// AI tetap menjawab customer sungguhan daripada mendiamkannya.
const COMMERCE = /\b(?:harga|hrg|berapa|brp|ready|stok|stock|beli|order|pesan|psn|kirim|ongkir|antar|alamat|lokasi|toko|buka|jam|bayar|transfer|tf|rekening|invoice|nota|diskon|promo|katalog|ukuran|warna|merk|merek|sak|batang|btg|lembar|lbr|dus|pcs|meter|kg|semen|cat|pipa|paralon|keramik|besi|triplek|gypsum|baja|genteng|kloset|closet|kran|keran|bata|pasir|hollow|holo|mortar|lem|seng|atap|plafon|rangka)\b/i;

function hasCommerceSignal(text) {
  return COMMERCE.test(String(text || ''));
}

/**
 * Balasan baru akan menjadi tawaran kosong ketiga berturut-turut, dan
 * customer di giliran-giliran itu tidak menyebut apa pun soal jual-beli.
 *
 * `history` berurutan lama→baru dengan `role` 'user'/'assistant'. Pesan
 * customer yang beruntun di antara dua balasan AI dihitung bersama.
 */
function isStuckLoop({ history = [], reply = '', customerText = '', limit = 3 } = {}) {
  if (!isGenericOffer(reply)) return false;
  if (hasCommerceSignal(customerText)) return false;
  let generic = 1;
  for (let i = history.length - 1; i >= 0 && generic < limit; i -= 1) {
    const turn = history[i];
    if (!turn) continue;
    if (turn.role === 'assistant') {
      if (!isGenericOffer(turn.content)) return false;
      generic += 1;
    } else if (hasCommerceSignal(turn.content)) {
      return false;
    }
  }
  return generic >= limit;
}

module.exports = {
  isAutomatedNotice,
  isBusinessTemplateType,
  isGenericOffer,
  hasCommerceSignal,
  isStuckLoop,
};
