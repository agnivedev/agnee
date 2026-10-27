'use strict';

/**
 * Aturan promo per company (Pengaturan > Promo). Jenis yang ada: gratis
 * ongkir untuk wilayah tertentu, dengan syarat opsional (minimal belanja,
 * minimal jumlah barang, produk tertentu, periode, batas subsidi).
 *
 * Keputusan "berlaku atau tidak" selalu diambil di sini, bukan oleh model:
 * AI memanggil `cek_ongkir`, alat mencocokkan wilayah tujuan dan syarat,
 * dan AI hanya menyampaikan hasilnya.
 */

const KINDS = ['free_shipping'];
const MAX_AREAS = 300;
const MAX_PRODUCTS = 50;

const clip = (value, max) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

/** Nama wilayah dibandingkan tanpa huruf besar, tanda baca, dan awalan administratif. */
function norm(value) {
  return String(value ?? '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\b(kecamatan|kec|kota|kabupaten|kab|provinsi|prov|kelurahan|kel|desa)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const moneyOrNull = (value) => {
  if (value === '' || value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : NaN;
};

const dateOrNull = (value) => {
  if (value === '' || value == null) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? NaN : d.toISOString();
};

/**
 * Isian dari layar/API menjadi aturan yang bersih. `{ error }` kalau ada isian
 * yang tidak masuk akal, supaya tidak tersimpan diam-diam sebagai promo
 * "berlaku di mana saja".
 */
function normalizeRule(input = {}) {
  const name = clip(input.name, 120);
  if (!name) return { error: 'Isi nama promo.' };
  if (!KINDS.includes(input.kind || 'free_shipping')) return { error: 'Jenis promo tidak dikenal.' };

  const rawAreas = Array.isArray(input.areas) ? input.areas : [];
  if (rawAreas.length > MAX_AREAS) return { error: `Maksimal ${MAX_AREAS} wilayah per promo.` };
  const seen = new Set();
  const areas = [];
  for (const area of rawAreas) {
    const entry = { province: clip(area?.province, 80), city: clip(area?.city, 80), district: clip(area?.district, 80) };
    if (!entry.province && !entry.city && !entry.district) continue;
    const key = `${norm(entry.province)}|${norm(entry.city)}|${norm(entry.district)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    areas.push(entry);
  }

  const c = input.conditions || {};
  const minSubtotal = moneyOrNull(c.minSubtotal);
  const minQty = moneyOrNull(c.minQty);
  const maxSubsidy = moneyOrNull(input.maxSubsidy);
  if (Number.isNaN(minSubtotal)) return { error: 'Minimal belanja harus berupa angka rupiah.' };
  if (Number.isNaN(minQty)) return { error: 'Minimal jumlah barang harus berupa angka.' };
  if (Number.isNaN(maxSubsidy)) return { error: 'Batas subsidi ongkir harus berupa angka rupiah.' };
  const products = [...new Set((Array.isArray(c.products) ? c.products : []).map((p) => clip(p, 80)).filter(Boolean))].slice(0, MAX_PRODUCTS);

  const startsAt = dateOrNull(input.startsAt);
  const endsAt = dateOrNull(input.endsAt);
  if (Number.isNaN(startsAt) || Number.isNaN(endsAt)) return { error: 'Tanggal promo tidak valid.' };
  if (startsAt && endsAt && new Date(endsAt) < new Date(startsAt)) return { error: 'Tanggal berakhir harus setelah tanggal mulai.' };

  return {
    rule: {
      kind: input.kind || 'free_shipping',
      name,
      enabled: input.enabled !== false,
      startsAt,
      endsAt,
      areas,
      conditions: {
        ...(minSubtotal ? { minSubtotal } : {}),
        ...(minQty ? { minQty } : {}),
        ...(products.length ? { products } : {}),
      },
      maxSubsidy: maxSubsidy || null,
      notes: clip(input.notes, 1000),
    },
  };
}

/** Aktif = saklar hidup dan hari ini di dalam periode. */
function isActive(rule, now = new Date()) {
  if (!rule || rule.enabled === false) return false;
  const t = now.getTime();
  if (rule.startsAt && new Date(rule.startsAt).getTime() > t) return false;
  if (rule.endsAt && new Date(rule.endsAt).getTime() < t) return false;
  return true;
}

function activeRules(rules, now = new Date()) {
  return (Array.isArray(rules) ? rules : []).filter((r) => r.kind === 'free_shipping' && isActive(r, now));
}

/**
 * Potongan nama wilayah dari tujuan: tiap segmen alamat bertanda koma dan
 * tiap nilai komponen alamat hasil geocode, dibandingkan utuh (bukan sebagian)
 * supaya "Ciputat" tidak ikut mencocokkan "Ciputat Timur".
 */
function placeSegments(destination) {
  const out = new Set();
  const add = (v) => { const n = norm(v); if (n) out.add(n); };
  for (const text of [destination?.address, destination?.typed]) {
    String(text || '').split(/[,\n]/).forEach(add);
  }
  for (const value of Object.values(destination?.components || {})) {
    if (typeof value === 'string') add(value);
  }
  return out;
}

/** Wilayah paling spesifik yang diisi harus cocok; tingkat di atasnya hanya memperkuat. */
function areaMatches(area, segments) {
  const district = norm(area.district);
  const city = norm(area.city);
  const province = norm(area.province);
  if (district) {
    if (!segments.has(district)) return false;
    if (city && !segments.has(city)) {
      // Kota boleh tidak tercatat di hasil geocode selama provinsinya cocok.
      if (province && !segments.has(province)) return false;
    }
    return true;
  }
  if (city) return segments.has(city);
  if (province) return segments.has(province);
  return false;
}

/** Syarat promo terhadap isi pesanan: `{ unmet, unknown }` berisi kalimat untuk model. */
function checkConditions(rule, order = {}) {
  const c = rule.conditions || {};
  const unmet = [];
  const unknown = [];
  const subtotal = Number.isFinite(Number(order.subtotal)) && order.subtotal !== null && order.subtotal !== undefined && order.subtotal !== '' ? Number(order.subtotal) : null;
  const qty = Number.isFinite(Number(order.qty)) && order.qty !== null && order.qty !== undefined && order.qty !== '' ? Number(order.qty) : null;
  if (c.minSubtotal) {
    if (subtotal == null) unknown.push(`total belanja (minimal Rp ${c.minSubtotal.toLocaleString('id-ID')})`);
    else if (subtotal < c.minSubtotal) unmet.push(`total belanja minimal Rp ${c.minSubtotal.toLocaleString('id-ID')}`);
  }
  if (c.minQty) {
    if (qty == null) unknown.push(`jumlah barang (minimal ${c.minQty})`);
    else if (qty < c.minQty) unmet.push(`jumlah barang minimal ${c.minQty}`);
  }
  if (c.products?.length) {
    const ordered = (Array.isArray(order.products) ? order.products : []).map(norm).filter(Boolean);
    if (!ordered.length) unknown.push(`produk yang dibeli (harus ${c.products.join(' / ')})`);
    else if (!c.products.some((k) => ordered.some((p) => p.includes(norm(k))))) unmet.push(`produk harus ${c.products.join(' / ')}`);
  }
  return { unmet, unknown };
}

/**
 * Menilai semua promo aktif untuk satu tujuan dan pesanan.
 * Status per promo: berlaku | syarat_belum_terpenuhi | syarat_belum_diketahui | di_luar_wilayah.
 */
function evaluate(rules, destination, order = {}, now = new Date()) {
  const segments = placeSegments(destination);
  return activeRules(rules, now).map((rule) => {
    const inArea = !rule.areas.length || rule.areas.some((a) => areaMatches(a, segments));
    if (!inArea) return { rule, status: 'di_luar_wilayah' };
    const { unmet, unknown } = checkConditions(rule, order);
    if (unmet.length) return { rule, status: 'syarat_belum_terpenuhi', kurang: unmet };
    if (unknown.length) return { rule, status: 'syarat_belum_diketahui', perlu_info: unknown };
    return { rule, status: 'berlaku' };
  });
}

const rupiah = (value) => `Rp ${Math.round(Number(value)).toLocaleString('id-ID')}`;

function describeConditions(rule) {
  const c = rule.conditions || {};
  const parts = [];
  if (c.minSubtotal) parts.push(`minimal belanja ${rupiah(c.minSubtotal)}`);
  if (c.minQty) parts.push(`minimal ${c.minQty} barang`);
  if (c.products?.length) parts.push(`produk: ${c.products.join(', ')}`);
  if (rule.maxSubsidy) parts.push(`ongkir ditanggung toko maksimal ${rupiah(rule.maxSubsidy)}`);
  return parts;
}

function describeAreas(rule, limit = 40) {
  if (!rule.areas.length) return 'semua wilayah';
  const names = rule.areas.map((a) => [a.district, a.city && a.city !== a.district ? a.city : '', a.province].filter(Boolean).slice(0, 2).join(', '));
  return names.length > limit ? `${names.slice(0, limit).join('; ')}; dan ${names.length - limit} wilayah lain` : names.join('; ');
}

const GUIDE = `## PROMO GRATIS ONGKIR
- Daftar promo di bawah hanya untuk menjawab "ada gratis ongkir?". Berlaku atau tidaknya untuk customer tertentu ditentukan alat cek_ongkir, bukan dari tebakanmu atau dari daftar ini.
- Jangan menjanjikan gratis ongkir sebelum cek_ongkir menyatakan status "berlaku". Kalau status "syarat_belum_diketahui", tanyakan info yang diminta; kalau "syarat_belum_terpenuhi", sebutkan apa yang kurang dengan ramah; kalau "di_luar_wilayah", katakan promo ini belum menjangkau wilayahnya.
- Isi "total_belanja", "jumlah_barang", dan "produk" pada cek_ongkir dari pesanan customer sejauh sudah diketahui. Jangan mengarang angkanya.`;

/** Bagian prompt: promo aktif beserta wilayah dan syaratnya. Kosong bila tidak ada. */
function section(rules, now = new Date()) {
  const active = activeRules(rules, now);
  if (!active.length) return '';
  const lines = active.map((rule) => {
    const parts = [`- ${clip(rule.name, 120)}: gratis ongkir untuk ${describeAreas(rule)}`];
    const cond = describeConditions(rule);
    parts.push(cond.length ? `syarat: ${cond.join('; ')}` : 'syarat: tanpa syarat lain');
    if (rule.endsAt) parts.push(`sampai ${new Date(rule.endsAt).toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' })}`);
    if (rule.notes) parts.push(`catatan: ${clip(rule.notes, 300)}`);
    return parts.join('; ');
  });
  return [GUIDE, '', ...lines].join('\n');
}

/** Hasil evaluasi menjadi objek untuk model. Promo yang berlaku paling menguntungkan menang. */
function summarize(results) {
  if (!results.length) return null;
  const fitting = results.filter((r) => r.status === 'berlaku');
  const best = fitting.sort((a, b) => (a.rule.maxSubsidy ?? Infinity) < (b.rule.maxSubsidy ?? Infinity) ? 1 : -1)[0];
  if (best) {
    return {
      nama: best.rule.name,
      status: 'berlaku',
      gratis_penuh: !best.rule.maxSubsidy,
      subsidi_maksimal: best.rule.maxSubsidy ? rupiah(best.rule.maxSubsidy) : null,
    };
  }
  const pending = results.find((r) => r.status === 'syarat_belum_diketahui')
    || results.find((r) => r.status === 'syarat_belum_terpenuhi');
  if (pending) {
    return { nama: pending.rule.name, status: pending.status, ...(pending.kurang ? { kurang: pending.kurang } : { perlu_info: pending.perlu_info }) };
  }
  return { status: 'di_luar_wilayah', pesan: 'Alamat customer belum termasuk wilayah promo gratis ongkir.' };
}

/** Ongkir yang tetap dibayar customer setelah promo; `total` angka Lalamove. null bila tak ada promo yang berlaku. */
function customerPays(total, results) {
  if (total == null) return null;
  const caps = results.filter((r) => r.status === 'berlaku').map((r) => r.rule.maxSubsidy ?? Infinity);
  if (!caps.length) return null;
  return Math.max(0, total - Math.max(...caps));
}

module.exports = {
  KINDS, norm, normalizeRule, isActive, activeRules, placeSegments, areaMatches, checkConditions,
  evaluate, section, summarize, customerPays, describeAreas, describeConditions, GUIDE,
};
