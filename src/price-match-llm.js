'use strict';

/**
 * Cadangan `cek_harga` saat pencarian kata tidak menemukan barang.
 *
 * Customer toko bangunan memakai istilah lapangan: "paralon 4 inch" (di POS:
 * RUCIKA STD 4 AW/D), "gypsum anti air" (JAYABOARD GYPSUM WET-AREA 9MM),
 * "siltip" (SEAL TAPE). Audit ESBEJE 9 Nov: barang yang ada di katalog
 * ditanyakan ke Management, customer menunggu, satu akhirnya beli di toko lain.
 *
 * Dua langkah, keduanya oleh LLM:
 *  1. pahami: barang apa yang dimaksud, kategori DealPOS mana, kata kunci
 *     penamaan katalog;
 *  2. pilih: dari kandidat bernomor di kategori itu, barang mana yang cocok.
 * Model hanya memilih NOMOR dari daftar, jadi barang yang dikembalikan selalu
 * barang katalog sungguhan dengan harga dari POS, tidak pernah karangan.
 */

const { matchTerms } = require('./dealpos-prices');

const MAX_CATEGORIES = 3;
const MAX_CANDIDATES = 50;
const MAX_PICKS = 8;
const CACHE_TTL_MS = 6 * 3600_000;
const CACHE_MAX = 500;

const UNDERSTAND_SYSTEM = `Kamu membantu toko bahan bangunan mencocokkan permintaan customer dengan katalog POS.
Customer sering memakai istilah lapangan atau merek umum, misalnya: paralon = pipa PVC (merek Rucika, Wavin, Maspion; ukuran inci; kelas AW/D), siltip = seal tape, gypsum anti air = gypsum wet area, kloset = closet, keni = knee/elbow pipa, sok = socket, holo = hollow, triplek = plywood, GRC = papan semen, cat tembok = cat emulsi.
Tugasmu: tentukan barang yang dimaksud, pilih kategori katalog yang paling mungkin (dari daftar yang diberikan, tulis persis), dan beri kata kunci yang mungkin muncul di NAMA barang katalog: jenis barang, ukuran dalam penulisan katalog (mis. "4" untuk 4 inci, "3/4", "9MM", "40KG"), dan merek yang umum dijual untuk barang itu di Indonesia walau customer tidak menyebutnya (mis. pipa PVC: Rucika, Wavin, Maspion, Pralon, Vinilon).
Jawab HANYA JSON: {"barang": "...", "kategori": ["..."], "kata_kunci": ["..."]}. Kalau permintaannya bukan barang toko bangunan, jawab {"barang": "", "kategori": [], "kata_kunci": []}.`;

const PICK_SYSTEM = `Kamu memilih barang katalog yang sesuai dengan permintaan customer toko bahan bangunan.
Aturan:
- Pilih HANYA nomor dari daftar. Jangan mengarang barang.
- Nama katalog POS sering singkat dan tanpa kata jenisnya: "RUCIKA STD 4 AW" adalah pipa PVC Rucika standar 4 inci kelas AW (satuan btg = batang pipa), "JAYABOARD GYPSUM WET- AREA 9MM" adalah gypsum tahan air. Nilai dari merek, ukuran, satuan, dan kategori, bukan dari kata yang sama persis.
- Kalau customer menyebut ukuran, kelas, berat, atau warna, pilih hanya yang cocok dengan itu.
- Kalau beberapa varian sama-sama cocok dan customer belum menentukan (mis. kelas AW dan D, warna, kemasan), pilih semuanya (maksimal ${MAX_PICKS}).
- Kalau nama, kode, atau seri yang ditulis customer ada di nama barang (mis. "MU 480" -> "MU 480 RENOFIX 25KG"), barang itu cocok: pilih.
- Lebih baik memilih barang yang mungkin dimaksud (customer akan mengonfirmasi) daripada kosong. Kosong hanya bila jelas tidak ada barang sejenis di daftar.
- Kalau tidak ada yang benar-benar sesuai, pilih kosong. Barang yang hanya mirip namanya tetapi berbeda jenis TIDAK boleh dipilih (besi hollow "TALI PUTIH" bukan tali tambang, batu gurinda duduk bukan kloset duduk, masker anti air bukan gypsum anti air). Aksesori (tutup, valve, sambungan) bukan barang utamanya kecuali itu yang diminta.
Jawab HANYA JSON: {"pilih": [nomor, ...]}.`;

function parseJson(text) {
  const raw = String(text || '').trim();
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try { return JSON.parse(raw.slice(start, end + 1)); } catch { return null; }
}

/** Kategori yang ada di katalog, terbanyak dulu. */
function categoriesOf(items) {
  const counts = new Map();
  for (const item of items) {
    const c = String(item.category || '').trim();
    if (c) counts.set(c, (counts.get(c) || 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([name, count]) => ({ name, count }));
}

/**
 * Kandidat di kategori terpilih, diurutkan menurut jumlah kata kunci yang ada
 * di nama/merek. Kategori yang tidak dikenali diabaikan; tanpa kategori sah,
 * seluruh katalog dipakai (tetap disaring kata kunci).
 */
function candidatesFor(items, { categories = [], keywords = [] }, max = MAX_CANDIDATES) {
  const wanted = new Set(categories.map((c) => String(c).trim().toLowerCase()).filter(Boolean));
  const known = new Set(items.map((i) => String(i.category || '').trim().toLowerCase()));
  const usable = [...wanted].filter((c) => known.has(c));
  const pool = usable.length ? items.filter((i) => usable.includes(String(i.category || '').trim().toLowerCase())) : items;
  const terms = [...new Set(keywords.flatMap((k) => [...matchTerms(k)]))];
  // Ukuran ("4", "3/4") paling membedakan: tanpa bobot ini "VINILON 2 1/2 AW
  // PIPA PVC" mengalahkan "RUCIKA STD 4 D" untuk "paralon 4 inch".
  const isSize = (t) => /^\d+(?:\/\d+)?$/.test(t);
  const scored = pool.map((item) => {
    const own = matchTerms([item.name, item.brand].filter(Boolean).join(' '));
    const hits = terms.reduce((sum, t) => sum + (own.has(t) ? (isSize(t) ? 3 : 1) : 0), 0);
    return { item, hits };
  });
  const hitting = scored.filter((s) => s.hits > 0).sort((a, b) => b.hits - a.hits);
  if (hitting.length) return hitting.slice(0, max).map((s) => s.item);
  // Kategori kecil tanpa kata kunci yang cocok: biarkan model memilih dari semuanya.
  return usable.length && pool.length <= max ? pool : [];
}

function cacheKey(scope, query) {
  return `${scope}::${String(query || '').toLowerCase().replace(/\s+/g, ' ').trim()}`;
}

/**
 * Pencocok berbasis LLM untuk satu katalog. `ask(prompt, systemPrompt, meta)`
 * mengembalikan teks model (atau melempar); `meta` diteruskan apa adanya
 * dari `resolve` (mis. companyId untuk pencatatan biaya). Hasil disimpan sebentar per
 * `scope` (company) supaya istilah yang sama tidak dibayar dua kali.
 */
function createMatcher({ ask, now = () => Date.now() }) {
  const cache = new Map();

  function remember(key, value) {
    if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value);
    cache.set(key, { at: now(), value });
  }

  /**
   * `seed`: hasil pencarian kata untuk kueri yang sama. Ikut ditaruh di daftar
   * kandidat (paling atas) supaya barang yang namanya memang cocok tetap bisa
   * dipilih, tetapi LLM yang memutuskan: pencarian kata pernah menawarkan besi
   * hollow "TALI PUTIH" untuk tali tambang.
   */
  async function resolve({ scope = '', items = [], query = '', meta = {}, seed = [] }) {
    const text = String(query || '').replace(/\s+/g, ' ').trim().slice(0, 200);
    if (!text || !items.length) return { matches: [] };
    const key = cacheKey(scope, text);
    const hit = cache.get(key);
    if (hit && now() - hit.at < CACHE_TTL_MS) {
      const byId = new Map(items.map((i) => [i.id ?? i.code ?? i.name, i]));
      const matches = hit.value.ids.map((id) => byId.get(id)).filter(Boolean);
      return { matches, barang: hit.value.barang, cached: true };
    }

    const cats = categoriesOf(items).slice(0, 80);
    const understood = parseJson(await ask(
      `Permintaan customer: "${text}"\n\nKategori katalog (nama | jumlah barang):\n${cats.map((c) => `${c.name} | ${c.count}`).join('\n') || '(tidak ada kategori)'}`,
      UNDERSTAND_SYSTEM,
      meta,
    ));
    const barang = String(understood?.barang || '').trim().slice(0, 120);
    const categories = (Array.isArray(understood?.kategori) ? understood.kategori : []).slice(0, MAX_CATEGORIES).map(String);
    const keywords = (Array.isArray(understood?.kata_kunci) ? understood.kata_kunci : []).slice(0, 12).map(String);
    // Model tidak menangkap barangnya: belum ada keputusan, pemanggil memakai
    // hasil pencarian kata. Tidak disimpan supaya bisa dicoba lagi.
    if (!barang && !keywords.length) return { matches: [], barang: '', undecided: true };

    const fromCategory = candidatesFor(items, { categories, keywords: [...keywords, barang, text] });
    // Hasil kata di luar kategori terpilih hanya mengganggu ("4 inch" membawa
    // amplas dan mata gerinda 4"); di dalam kategori, ia membantu.
    const wanted = new Set(categories.map((c) => c.trim().toLowerCase()));
    const knownCat = items.some((i) => wanted.has(String(i.category || '').trim().toLowerCase()));
    const seedHere = (knownCat ? seed.filter((i) => wanted.has(String(i.category || '').trim().toLowerCase())) : seed).slice(0, 15);
    const candidates = [];
    const seenIds = new Set();
    for (const item of [...seedHere, ...fromCategory]) {
      const id = item.id ?? item.code ?? item.name;
      if (seenIds.has(id)) continue;
      seenIds.add(id);
      candidates.push(item);
      if (candidates.length >= MAX_CANDIDATES + 15) break;
    }
    if (!candidates.length) return { matches: [], barang, undecided: true };
    const list = candidates.map((item, idx) => `${idx + 1}. ${item.name}${item.unit ? ` | ${item.unit}` : ''}${item.category ? ` | ${item.category}` : ''}`).join('\n');
    const pickedRaw = await ask(
      `Permintaan customer: "${text}"\nDipahami sebagai: ${barang || '(tidak jelas)'}\n\nDaftar barang katalog:\n${list}`,
      PICK_SYSTEM,
      meta,
    );
    const picked = parseJson(pickedRaw);
    if (!picked || !Array.isArray(picked.pilih)) return { matches: [], barang, undecided: true };
    const numbers = (Array.isArray(picked?.pilih) ? picked.pilih : [])
      .map((n) => Number.parseInt(n, 10))
      .filter((n) => Number.isInteger(n) && n >= 1 && n <= candidates.length);
    const matches = [...new Set(numbers)].slice(0, MAX_PICKS).map((n) => candidates[n - 1]);
    remember(key, { ids: matches.map((i) => i.id ?? i.code ?? i.name), barang });
    return { matches, barang };
  }

  return { resolve, cache };
}

module.exports = { createMatcher, candidatesFor, categoriesOf, parseJson, UNDERSTAND_SYSTEM, PICK_SYSTEM };
