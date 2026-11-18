'use strict';

/**
 * Tahap pembangunan (6 tahap resmi, playbooks/esbeje/umum.md): tebakan Agnes dari barang dan
 * pekerjaan di chat, koreksi dari jawaban Management, dan usulan barang tahap berikutnya.
 * Tahap dipakai di balik layar; kata "tahap" tidak boleh sampai ke customer.
 */

const STAGES = [
  { n: 1, name: 'Pondasi dan beton', words: ['pondasi', 'cor', 'beton', 'sloof', 'kolom', 'bekisting', 'batu kali', 'split', 'bendrat', 'plastik cor', 'cakar ayam', 'telapak', 'galian'] },
  { n: 2, name: 'Plester dan dinding', words: ['plester', 'acian', 'aci', 'bata ringan', 'bata merah', 'hebel', 'dinding', 'mu 100', 'mu 200', 'mu 301', 'mu 380', 'jkt-m25', 'mortar', 'skimwall', 'pasir'] },
  { n: 3, name: 'Atap dan plafon', words: ['atap', 'plafon', 'plafond', 'gypsum', 'gypsum', 'hollow', 'holo', 'galvalum', 'genteng', 'baja ringan', 'talang', 'rangka', 'toren', 'seng'] },
  { n: 4, name: 'Lantai', words: ['keramik', 'granit', 'lantai', 'ubin', 'nat', 'mu 420', 'mu 400', 'mu 408', 'mu 480', 'perekat', 'stepnosing', 'plint'] },
  { n: 5, name: 'Pengecatan', words: ['cat', 'plamir', 'plamur', 'kuas', 'roller', 'thinner', 'dulux', 'nippon', 'mowilex', 'jotun', 'propan', 'avian'] },
  { n: 6, name: 'Finishing tambahan', words: ['kloset', 'closet', 'wastafel', 'kran', 'keran', 'lampu', 'pintu', 'engsel', 'kunci', 'pipa', 'rucika', 'sanitary', 'saklar', 'kabel', 'shower'] },
];

/** Barang yang ditawarkan untuk tiap tahap (daftar "Barang untuk tahap berikutnya" di playbook). Dicari di DealPOS. */
const OFFERS = {
  1: ['semen jakarta', 'rucika'],
  2: ['mortar utama', 'mu 301', 'mu 200', 'semen jakarta'],
  3: ['toren', 'plafon', 'gypsum'],
  4: ['mu 420', 'mu 400', 'perekat keramik'],
  5: ['cat'],
  6: ['rucika', 'toren', 'cat'],
};

const norm = (text) => String(text || '').toLowerCase().replace(/\s+/g, ' ');
const has = (hay, word) => new RegExp(`(?:^|[^a-z0-9])${word.replace(/[.*+?^${}()|[\]\\-]/g, '\\$&')}(?:$|[^a-z0-9])`).test(hay);

/**
 * Tebak tahap dari teks customer (lama ke baru). Tahap yang paling banyak cocok menang; seri dimenangkan
 * kata terbaru. Tidak ada kecocokan = null ("belum jelas").
 */
function guessStage(texts = []) {
  const list = (texts || []).map(norm).filter(Boolean).slice(-8);
  let best = null;
  list.forEach((hay, idx) => {
    for (const stage of STAGES) {
      for (const word of stage.words) {
        if (!has(hay, word)) continue;
        const score = best?.byStage?.[stage.n] || { hits: 0, last: -1, words: [] };
        score.hits += 1; score.last = idx; if (!score.words.includes(word)) score.words.push(word);
        best = best || { byStage: {} };
        best.byStage[stage.n] = score;
      }
    }
  });
  if (!best) return null;
  const [n, score] = Object.entries(best.byStage).sort((a, b) => b[1].hits - a[1].hits || b[1].last - a[1].last)[0];
  const stage = STAGES.find((s) => s.n === Number(n));
  return { n: stage.n, name: stage.name, reason: `customer cari ${score.words.slice(0, 2).join(' ')}` };
}

const nameOf = (n) => STAGES.find((s) => s.n === Number(n))?.name || null;

/** "Tahap (asumsi Agnes): 3 Atap dan plafon (customer cari plafon gypsum)" atau "belum jelas". */
function stageLine(stage) {
  if (!stage?.n) return 'belum jelas';
  return `${stage.n} ${nameOf(stage.n)}${stage.reason ? ` (${stage.reason})` : ''}`;
}

const STAGE_WORDS = [
  [/pondasi|beton|cor\b/, 1], [/plester|dinding|acian|bata/, 2], [/atap|plafon|plafond|gypsum/, 3],
  [/lantai|keramik|granit/, 4], [/cat\b|pengecatan/, 5], [/finishing|sanitary|kloset/, 6],
];

/**
 * Koreksi di jawaban Management: "tahap 4 lantai, tawarkan perekat MU 380" atau "ganti perekat MU 380".
 * Mengembalikan { stage, offer, rest }: `rest` = jawaban tanpa potongan koreksi, itulah yang boleh jadi
 * dasar kalimat ke customer.
 */
function parseCorrection(answer) {
  let rest = String(answer || '');
  let stage = null;
  let offer = null;
  const byNumber = /\btahap\s*(?:ke-?)?\s*([1-6])\b(?:\s+(?:pondasi(?:\s+dan\s+beton)?|plester(?:\s+dan\s+dinding)?|dinding|atap(?:\s+dan\s+plafon)?|plafon|lantai|pengecatan|cat|finishing(?:\s+tambahan)?))?/i.exec(rest);
  const byName = /\btahap\s+(pondasi|plester|dinding|atap|plafon|lantai|pengecatan|cat|finishing)\b(?:\s+dan\s+(?:beton|dinding|plafon|tambahan))?/i.exec(rest);
  if (byNumber) { stage = Number(byNumber[1]); rest = rest.replace(byNumber[0], ' '); }
  else if (byName) {
    const word = byName[1].toLowerCase();
    stage = STAGE_WORDS.find(([re]) => re.test(word))?.[1] || null;
    if (stage) rest = rest.replace(byName[0], ' ');
  }
  const off = /(?:^|[\s,;.])(?:tawarkan|tawarin|tawari|tambahkan|usulkan|ganti(?:\s+(?:dengan|ke|jadi))?)\s+([^,.;\n]{3,60})/i.exec(rest);
  if (off) { offer = off[1].trim(); rest = rest.replace(off[0], ' '); }
  rest = rest.replace(/\s+/g, ' ').replace(/^[\s,;.:\-–]+|[\s,;.:\-–]+$/g, '').replace(/^(?:dan|ya|ok|oke)\b[\s,]*/i, '').trim();
  return { stage, offer, rest };
}

/** Kata kunci pencarian DealPOS untuk tahap berikutnya (null bila sudah tahap akhir/tak jelas). */
function nextOfferTerms(stage) {
  const n = Number(stage);
  if (!Number.isInteger(n) || n < 1 || n >= 6) return null;
  return OFFERS[n + 1] || null;
}

const GENERIC = new Set(['perekat', 'lem', 'barang', 'produk', 'merk', 'merek', 'sak', 'dus', 'buah', 'pcs', 'yang', 'dan', 'dengan', 'untuk', 'jenis']);

/**
 * Barang di DealPOS yang cocok dengan sebutan Management ("perekat MU 380"): semua kata pembeda harus ada
 * di nama barang (kata umum boleh tak ada). Tak ketemu = [] dan barangnya tidak ditawarkan.
 */
function matchOffer(products = [], offer = '', limit = 3) {
  const toks = String(offer || '').toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length >= 2);
  const must = toks.filter((t) => !GENERIC.has(t));
  if (!must.length) return [];
  return (products || [])
    .filter((p) => { const name = String(p?.name || '').toLowerCase(); return must.every((t) => has(name, t)); })
    .sort((a, b) => String(a.name).length - String(b.name).length)
    .slice(0, limit);
}

/** Usulan barang tahap berikutnya dari DealPOS (maks `limit`), dengan harganya. */
function suggestNext(stage, products = [], limit = 2) {
  const terms = nextOfferTerms(stage);
  if (!terms) return [];
  const out = [];
  for (const term of terms) {
    const hit = matchOffer(products, term, 1)[0];
    if (hit && !out.some((o) => o.name === hit.name)) out.push(hit);
    if (out.length >= limit) break;
  }
  return out;
}

const rupiah = (n) => `Rp ${Math.round(Number(n)).toLocaleString('id-ID')}`;
const itemText = (p) => `${p.name} ${rupiah(p.unitPrice ?? p.price)}${p.unit ? ` per ${p.unit}` : ''}`;

module.exports = { matchOffer, suggestNext, itemText, STAGES, OFFERS, guessStage, stageLine, parseCorrection, nextOfferTerms, nameOf };
