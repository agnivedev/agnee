'use strict';

/**
 * Pemberitahuan serah-terima: ketika balasan AI menjanjikan akan meneruskan
 * sesuatu ke manusia ("aku teruskan ke tim", "akan aku sampaikan ke Bang Al"),
 * orang yang ditunjuk company diberi tahu lewat WhatsApp.
 *
 * Hanya jalur customer-minta-manusia yang membuat tugas dan routing. Kalau AI
 * sendiri yang menulis janji itu, tidak ada yang tahu — celah yang ditemukan
 * di hari pertama Mansur (10 Okt 2026).
 */

// Kata kerja meneruskan + tujuannya harus sama-sama ada, supaya "aku sampaikan
// harga" atau "teruskan ke link ini" tidak ikut terhitung. Tujuan: tim, nama
// orang (Bang/Kak/Pak/Bu/Mas/Mbak), owner, admin, CS, atasan.
const VERB = '(?:ku)?(?:teruskan|sampaikan|diteruskan|disampaikan|kabari|kabarin|kabarkan|dikabarkan|laporkan|dilaporkan|tanyakan|ditanyakan|forward|inform|pass|relay|escalate)';
const TARGET = '(?:tim|team|bang|abang|kak|pak|bu|mas|mbak|owner|pemilik|admin|cs|supervisor|atasan|manusia|orangnya|mereka)';
const CLAIM = new RegExp(`\\b${VERB}\\b[^.!?\\n]{0,40}\\b${TARGET}\\b`, 'i');

/** Apakah balasan AI ini menjanjikan meneruskan sesuatu ke orang? */
function claimsForward(text) {
  return CLAIM.test(String(text || ''));
}

function digits(raw) {
  return String(raw || '').replace(/\D/g, '');
}

/** Nama/nomor customer untuk pesan pemberitahuan; nomor ditulis utuh supaya bisa di-tap. */
function describeCustomer({ chatId, name }) {
  const number = String(chatId || '').split('@')[0];
  const clean = String(name || '').trim();
  return clean && clean !== number ? `${clean} (+${number})` : `+${number}`;
}

/**
 * @param {object} p
 * @param p.chatId        id chat customer
 * @param p.name          nama tampilan customer kalau ada
 * @param p.customerText  pesan terakhir customer
 * @param p.aiText        balasan AI yang menjanjikan meneruskan
 */
function buildNotice({ chatId, name, customerText, aiText }) {
  const cut = (value, max) => {
    const text = String(value || '').replace(/\s+/g, ' ').trim();
    return text.length > max ? `${text.slice(0, max - 1)}…` : text;
  };
  const lines = [
    '*Perlu ditindaklanjuti*',
    `Customer: ${describeCustomer({ chatId, name })}`,
    `Bertanya: "${cut(customerText, 400)}"`,
    `Asisten membalas: "${cut(aiText, 300)}"`,
    '',
    'Asisten sudah menjanjikan akan menyampaikan ini. Mohon dibalas langsung ke customer.',
  ];
  return lines.join('\n');
}

/**
 * Pembatas kirim per chat: satu pemberitahuan per jendela waktu, supaya
 * customer yang menagih berulang tidak membanjiri penerima.
 */
function createCooldown({ windowMs = 20 * 60_000, now = () => Date.now() } = {}) {
  const last = new Map();
  return {
    /** true kalau boleh kirim (dan langsung dicatat). */
    take(key) {
      const t = now();
      const prev = last.get(key);
      if (prev !== undefined && t - prev < windowMs) return false;
      last.set(key, t);
      if (last.size > 5000) {
        for (const [k, v] of last) if (t - v >= windowMs) last.delete(k);
      }
      return true;
    },
    /** Kirim gagal total: lepaskan supaya balasan berikutnya mencoba lagi. */
    release(key) { last.delete(key); },
  };
}

module.exports = { claimsForward, buildNotice, createCooldown, describeCustomer, digits };
