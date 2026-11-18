'use strict';

/**
 * Jurnal panggilan alat AI per chat, untuk baris "Sudah dicek" di pertanyaan ke
 * departemen. Disusun KODE dari panggilan yang benar-benar terjadi (nama alat,
 * argumen, hasil), bukan dari klaim model. Alat yang tak tersedia tidak pernah
 * diklaim: Agnes belum punya pencarian Google/web, dan baris itu selalu jujur
 * menyebutnya.
 */

const LABELS = {
  cek_harga: 'DealPOS',
  cek_ongkir: 'Lalamove',
  cek_alamat: 'Alamat (peta OSM)',
  cari_toko_terdekat: 'Data Lokasi',
  hitung_kebutuhan: 'Hitung kebutuhan',
};

const NO_WEB = 'Google/web: belum tersedia';

const cut = (text, max) => {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
};

const countOk = (out) => {
  if (Array.isArray(out?.hasil)) return out.hasil.length;
  if (Array.isArray(out?.per_barang)) return out.per_barang.filter((r) => r?.status === 'ok').reduce((n, r) => n + (r.hasil?.length || 0), 0);
  return 0;
};

/** Ringkas satu panggilan: { tool, query, result } atau null bila alatnya tak dicatat. */
function describe(name, args = {}, out = {}) {
  if (!LABELS[name]) return null;
  const status = String(out?.status || '');
  if (name === 'cek_harga') {
    if (status === 'kueri_kosong') return null;
    const list = [...(Array.isArray(args.daftar) ? args.daftar : []), ...(args.barang ? [args.barang] : [])].map((v) => cut(v, 40)).filter(Boolean);
    const n = countOk(out);
    const result = status === 'tidak_ketemu' ? 'tidak ketemu'
      : status === 'sebagian' ? `sebagian ketemu (${n} barang cocok)`
      : n > 0 ? `${n} barang cocok` : (status === 'ok' ? 'ketemu' : 'tak ada hasil');
    return { tool: name, query: list.slice(0, 3).join(', '), result };
  }
  if (name === 'cek_ongkir') {
    const result = status === 'ok' ? 'ongkir terhitung'
      : status === 'lokasi_tidak_terbaca' ? 'gagal: alamat belum terbaca di peta'
      : status === 'menunggu_management' ? 'menunggu keputusan kendaraan'
      : status === 'gagal' ? 'gagal (Lalamove tak memberi harga)'
      : (status || 'tak ada hasil').replace(/_/g, ' ');
    return { tool: name, query: cut(args.tujuan, 60), result };
  }
  if (name === 'cek_alamat') {
    const result = /^ketemu/.test(status) ? 'alamat terbaca'
      : status === 'jalan_ambigu' ? 'jalan ada di banyak kota (ambigu)'
      : status === 'tidak_ketemu' ? 'belum terbaca di peta'
      : (status || 'tak ada hasil').replace(/_/g, ' ');
    return { tool: name, query: cut(args.alamat, 60), result };
  }
  if (name === 'cari_toko_terdekat') {
    const result = status === 'lokasi_tidak_terbaca' ? 'lokasi customer belum terbaca' : status === 'tidak_ada_toko' ? 'belum ada toko' : 'toko terdekat dicari';
    return { tool: name, query: '', result };
  }
  // hitung_kebutuhan
  return { tool: name, query: cut(args.pekerjaan, 40), result: status === 'ok' ? 'terhitung' : 'gagal' };
}

/** Satu entri per alat+kueri (yang terbaru), lama ke baru. */
function dedupe(entries = []) {
  const map = new Map();
  for (const e of entries) {
    if (!e?.tool || !LABELS[e.tool]) continue;
    map.set(`${e.tool}\n${e.query || ''}`, e);
  }
  return [...map.values()];
}

/** Baris "Sudah dicek: ..." untuk pesan ke grup. */
function checkedLine(entries = []) {
  const parts = dedupe(entries).slice(-6).map((e) => `${LABELS[e.tool]}${e.query ? ` "${e.query}"` : ''}: ${e.result || 'tanpa hasil'}`);
  return parts.length ? `${parts.join('; ')}. ${NO_WEB}` : `Belum ada pengecekan alat. ${NO_WEB}`;
}

const hasCalled = (entries, tool) => (entries || []).some((e) => e?.tool === tool);

module.exports = { describe, checkedLine, hasCalled, dedupe, LABELS, NO_WEB };
