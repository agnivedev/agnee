'use strict';

/**
 * Jenis kendaraan Lalamove untuk pertanyaan ke Management.
 *
 * Saat "Kendaraan ditentukan Management" menyala, AI tidak memilih sendiri
 * kendaraan untuk ongkir: ia bertanya dulu ke Management dengan daftar
 * kendaraan yang tersedia di akun Lalamove-nya (nama, muatan maksimum), lalu
 * jawaban Management ("engkel box", "2 motor") dibaca di sini menjadi kode
 * kendaraan Lalamove dan jumlahnya.
 *
 * Datanya dari API Lalamove (`GET /v3/cities` memberi `key`, `load`,
 * `dimensions` per kendaraan). Tabel di bawah hanya memberi nama Indonesia
 * dan urutan; muatan dari API dipakai bila ada, tabel ini cadangannya.
 * Lalamove tidak punya "container"; yang terbesar Fuso (8 ton).
 */

const VEHICLES = [
  { key: 'MOTORCYCLE', label: 'Motor', loadKg: 20, words: ['motor', 'sepeda motor', 'motorcycle', 'bike'] },
  { key: 'SEDAN', label: 'Sedan', loadKg: 100, words: ['sedan'] },
  { key: 'MPV', label: 'Mobil MPV', loadKg: 200, words: ['mpv', 'mobil'] },
  { key: 'VAN', label: 'Van', loadKg: 600, words: ['van'] },
  { key: 'PICK_UP_TRUCK', label: 'Pick-up', loadKg: 800, words: ['pick up', 'pickup', 'pick-up', 'pu'] },
  { key: 'TRUCK175', label: 'Truk 175', loadKg: 800, words: ['truck 175', 'truk 175', 'truck175'] },
  { key: 'TRUCK330', label: 'Truk 330', loadKg: 1000, words: ['truck 330', 'truk 330', 'truck330'] },
  { key: 'TRUCK550', label: 'Truk 550', loadKg: 1000, words: ['truck 550', 'truk 550', 'truck550'] },
  { key: 'LALANOW', label: 'Lalanow', loadKg: 2000, words: ['lalanow', 'lala now'] },
  { key: 'ENGKELBOX', label: 'Engkel box', loadKg: 2000, words: ['engkel box', 'engkelbox', 'engkel tertutup'] },
  { key: 'ENGKELBAK', label: 'Engkel bak', loadKg: 2500, words: ['engkel bak', 'engkelbak', 'engkel terbuka'] },
  { key: 'CDDBOX', label: 'CDD box', loadKg: 5000, words: ['cdd box', 'cddbox', 'colt diesel box'] },
  { key: 'CDDBAK', label: 'CDD bak', loadKg: 5000, words: ['cdd bak', 'cddbak', 'colt diesel bak'] },
  { key: 'FUSO_BOX', label: 'Fuso box', loadKg: 8000, words: ['fuso box', 'fusobox'] },
  { key: 'FUSO_BAK', label: 'Fuso bak', loadKg: 8000, words: ['fuso bak', 'fusobak'] },
];
const BY_KEY = new Map(VEHICLES.map((v) => [v.key, v]));

/** Kendaraan antar-kota tidak dipakai untuk pengiriman dalam kota. */
const isIntercity = (key) => /_INTERCITY$/.test(String(key));

const kg = (value) => (Number(value) >= 1000 && Number(value) % 1000 === 0 ? `${Number(value) / 1000} ton` : `${Number(value)} kg`);

function loadOf(service, known) {
  const apiLoad = Number(service?.load?.value);
  return Number.isFinite(apiLoad) && apiLoad > 0 ? apiLoad : known?.loadKg || null;
}

/**
 * Kendaraan yang tersedia di akun Lalamove ini (gabungan semua kota), urut
 * dari muatan terkecil, dengan nama Indonesia dan muatan maksimumnya.
 */
function optionsOf(conn) {
  const seen = new Map();
  for (const city of Array.isArray(conn?.cities) ? conn.cities : []) {
    for (const service of Array.isArray(city.services) ? city.services : []) {
      if (!service?.key || isIntercity(service.key)) continue;
      const known = BY_KEY.get(service.key);
      if (!known) continue; // jenis yang belum dikenal tidak ditawarkan ke Management
      const loadKg = loadOf(service, known);
      if (!seen.has(service.key) || (loadKg && !seen.get(service.key).loadKg)) {
        seen.set(service.key, { key: service.key, label: known.label, loadKg });
      }
    }
  }
  return [...seen.values()].sort((a, b) => (a.loadKg || 0) - (b.loadKg || 0) || a.label.localeCompare(b.label, 'id'));
}

/** Daftar pilihan yang diringkas untuk pesan ke Management. */
function optionsText(options) {
  return options.map((o) => `${o.label}${o.loadKg ? ` (${kg(o.loadKg)})` : ''}`).join(', ');
}

function labelOf(key) {
  return BY_KEY.get(key)?.label || key;
}

/**
 * Pertanyaan ke Management: customer mau dikirim ke mana, barangnya apa, dan
 * pilihan kendaraan. Muat di batas pertanyaan departemen (600 karakter).
 */
function buildQuestion({ barang, address, approximate, options }) {
  const where = String(address || '').replace(/\s+/g, ' ').slice(0, 140);
  const goods = String(barang || '').replace(/\s+/g, ' ').slice(0, 160) || 'belum disebut';
  const head = `Ongkir Lalamove. Kirim ke: ${where}${approximate ? ' (perkiraan area)' : ''}. Barang: ${goods}. Pakai kendaraan apa? Balas nama kendaraannya (boleh dengan jumlah, mis. "2 motor"). Pilihan: `;
  let list = optionsText(options);
  const room = 600 - head.length;
  if (list.length > room) list = list.slice(0, Math.max(0, room - 1)).replace(/,[^,]*$/, '');
  return `${head}${list}.`;
}

const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const hasWord = (text, word) => new RegExp(`(?<![a-z0-9])${escape(word).replace(/\s+/g, '\\s*[- ]?\\s*')}(?![a-z0-9])`, 'i').test(text);

/**
 * Jawaban Management -> { key, count, label } atau { error }.
 *  - "engkel" saja = engkel box, "cdd" = CDD box, "fuso" = Fuso box (bak hanya bila disebut)
 *  - "2 motor" / "motor 2" = dua kendaraan, dibatasi 1 sampai 10
 *  - dua jenis berbeda, atau jenis yang tidak ada (mis. "container"), ditolak
 * `available` = kode kendaraan yang boleh dipilih (akun Lalamove ini).
 */
function parseAnswer(text, available = []) {
  // Kode pertanyaan (#a1b2c3) bukan bagian jawaban: dibuang supaya angkanya tak terbaca sebagai jumlah.
  const clean = String(text || '').toLowerCase().replace(/#[0-9a-f]{6}\b/g, ' ').replace(/[^a-z0-9\s.\-]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!clean) return { error: 'kosong' };
  // "motor ga muat, pakai pick up": kendaraan yang ditolak tidak dihitung sebagai pilihan.
  const answer = clean
    .replace(/(?:\b[a-z]+\s+){0,2}\b(?:ga|gak|nggak|ngga|tidak|enggak|kurang)\s+(?:muat|cukup|bisa|kuat|sanggup|usah)\b/g, ' ')
    .replace(/\bbukan\s+(?:pick ?-?up|[a-z]+)/g, ' ')
    .replace(/\s+/g, ' ').trim();
  if (answer) return parseChosen(answer, available);
  return { error: 'tidak_dikenali' };
}

function parseChosen(clean, available) {
  if (/(?<![a-z])(container|kontainer|kontener)(?![a-z])/.test(clean)) return { error: 'tidak_tersedia', kata: 'container' };

  const found = new Set();
  const take = (key) => { if (BY_KEY.has(key)) found.add(key); };
  // Frasa lengkap lebih dulu supaya "engkel bak" tidak terbaca "engkel box".
  for (const vehicle of VEHICLES) {
    if (vehicle.words.some((w) => w.includes(' ') || w.length > 4) && vehicle.words.some((w) => hasWord(clean, w))) take(vehicle.key);
  }
  if (!found.has('ENGKELBAK') && !found.has('ENGKELBOX') && hasWord(clean, 'engkel')) take(/(?<![a-z])(bak|terbuka)(?![a-z])/.test(clean) ? 'ENGKELBAK' : 'ENGKELBOX');
  if (!found.has('CDDBAK') && !found.has('CDDBOX') && hasWord(clean, 'cdd')) take(/(?<![a-z])(bak|terbuka)(?![a-z])/.test(clean) ? 'CDDBAK' : 'CDDBOX');
  if (!found.has('FUSO_BAK') && !found.has('FUSO_BOX') && hasWord(clean, 'fuso')) take(/(?<![a-z])(bak|terbuka)(?![a-z])/.test(clean) ? 'FUSO_BAK' : 'FUSO_BOX');
  if (!found.size) {
    for (const vehicle of VEHICLES) {
      if (vehicle.words.some((w) => hasWord(clean, w))) take(vehicle.key);
    }
  }
  // "mobil" dan "van" tidak boleh menimpa kata yang lebih spesifik.
  if (found.size > 1) {
    for (const key of ['MPV', 'VAN']) if (found.has(key) && [...found].some((k) => k !== key)) found.delete(key);
  }
  if (!found.size) return { error: 'tidak_dikenali' };
  if (found.size > 1) return { error: 'lebih_dari_satu', kandidat: [...found] };
  const key = [...found][0];
  if (available.length && !available.includes(key)) return { error: 'tidak_tersedia', kata: labelOf(key) };

  let count = 1;
  const countWord = '(motor|mobil|mpv|van|sedan|pick ?-?up|pickup|engkel|cdd|fuso|truk|truck|unit|armada|kendaraan)';
  const before = new RegExp(`(?<![a-z0-9])(\\d{1,2})\\s*(?:x|buah|unit)?\\s*${countWord}`, 'i').exec(clean);
  const after = new RegExp(`${countWord}(?:\\s+(?:box|bak))?\\s*(?:x|sebanyak)?\\s*(\\d{1,2})(?![a-z0-9])`, 'i').exec(clean);
  const n = before ? Number(before[1]) : (after ? Number(after[2]) : 1);
  if (Number.isFinite(n) && n >= 1) count = Math.min(10, n);
  return { key, count, label: labelOf(key) };
}

module.exports = { VEHICLES, isIntercity, optionsOf, optionsText, labelOf, buildQuestion, parseAnswer };
