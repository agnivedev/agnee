'use strict';

/**
 * Ringkasan percakapan untuk pertanyaan ke departemen (Management, Finance).
 *
 * Audit grup Manajemen Bestseller 18 Nov: pertanyaan berbunyi "mohon dipastikan"
 * tanpa konteks, staf harus membuka chat untuk tahu apa yang diminta, dan hampir
 * tak ada yang menjawab. Format baru memuat awal chat, pesan pemicu, yang sudah
 * diketahui AI, dan SATU hal yang harus diputuskan, supaya bisa dijawab dari HP.
 *
 * Model hanya meringkas isi chat dan pertanyaan AI; tidak boleh menambah fakta.
 * Gagal atau tak valid = null, pemanggil jatuh ke format lama (kutipan pesan customer).
 */

const FIELD_MAX = { awal: 160, ringkasan: 300, pemicu: 200, diketahui: 260, putuskan: 220 };

const SYSTEM = `Kamu merangkum percakapan WhatsApp toko bahan bangunan untuk tim internal yang akan memutuskan satu hal. Tulis ringkas, bahasa Indonesia, terbaca di HP.
Aturan:
- Pakai HANYA isi percakapan dan pertanyaan AI di bawah. Jangan mengarang barang, harga, jumlah, alamat, atau janji. Yang tidak ada di sumber: kosongkan ("").
- "awal": apa yang pertama ditulis customer di chat ini (kutip pendek, atau ringkas 1 kalimat bila panjang).
- "ringkasan": 2-3 kalimat jalannya percakapan, sebut siapa yang berkata apa: apa yang customer minta, apa yang sudah dijawab Agnes (AI) atau staf (harga, stok, ongkir), dan apa yang masih menggantung. Hanya dari percakapan; kosongkan bila belum ada jalannya percakapan.
- "pemicu": pesan customer yang membuat AI bertanya ke tim (kutip pendek).
- "diketahui": barang, jumlah, alamat, dan harga yang SUDAH jelas dari percakapan atau pertanyaan AI (nama barang persis seperti disebut). Satu baris.
- "putuskan": SATU kalimat tegas, idealnya pilihan yang dijawab singkat (ada/kosong; harga berapa; boleh/tidak; kendaraan apa). Dilarang "mohon dipastikan" atau "mohon dicek" tanpa objek.
Jawab HANYA JSON: {"awal": "...", "ringkasan": "...", "pemicu": "...", "diketahui": "...", "putuskan": "..."}.`;

const cut = (text, max) => {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
};

/** `turns`: [{ from: 'customer' | 'ai' | 'staf', body }] lama ke baru. */
function buildPrompt({ firstMessage = '', turns = [], customerText = '', question = '' }) {
  const chat = turns.slice(-12).map((t) => `${t.from === 'customer' ? 'Customer' : (t.from === 'ai' ? 'Agnes (AI)' : 'Staf')}: ${cut(t.body, 220)}`).join('\n');
  return `Pesan pertama customer di chat ini: "${cut(firstMessage, 220)}"\n\nPercakapan terakhir (lama ke baru; Customer = pembeli, Agnes (AI) = asisten digital toko, Staf = manusia toko):\n${chat || '(kosong)'}\n\nPesan customer yang memicu pertanyaan: "${cut(customerText, 300)}"\n\nPertanyaan AI ke tim: "${cut(question, 600)}"`;
}

function parseBrief(raw) {
  const s = String(raw || '');
  const a = s.indexOf('{'); const b = s.lastIndexOf('}');
  if (a < 0 || b <= a) return null;
  let json;
  try { json = JSON.parse(s.slice(a, b + 1)); } catch { return null; }
  const out = {};
  for (const [key, max] of Object.entries(FIELD_MAX)) out[key] = cut(json?.[key], max);
  // Tanpa hal yang diputuskan, ringkasan tak berguna.
  if (!out.putuskan || /^mohon\s+(?:dipastikan|dicek|konfirmasi)\.?$/i.test(out.putuskan)) return null;
  return out;
}

async function generateBrief({ ask, firstMessage, turns, customerText, question }) {
  try {
    return parseBrief(await ask(buildPrompt({ firstMessage, turns, customerText, question }), SYSTEM));
  } catch { return null; }
}

/** Tindak lanjut ke grup: balasan customer pertama setelah jawaban diteruskan. */
function buildFollowupNotice({ customerLabel, text }) {
  return `*Customer membalas* (${customerLabel}): "${cut(text, 300)}"`;
}

module.exports = { generateBrief, parseBrief, buildPrompt, buildFollowupNotice, SYSTEM, FIELD_MAX };
