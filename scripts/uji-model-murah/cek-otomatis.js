'use strict';
/**
 * Pemeriksa kode untuk uji model murah (kriteria 1, 2, 3, 6) — deterministik.
 *   node cek-otomatis.js <katalog.tsv> <hasil-dir> [<hasil-dir> ...]  > cek.json
 * katalog.tsv = nama<TAB>harga<TAB>satuan (ditarik baca-saja dari catalog_items ESBEJE; tidak di-commit).
 * Angka rupiah di balasan yang tidak ada di katalog dan tidak diucapkan customer di percakapan = kandidat "karangan".
 * Angka rupiah dari luar katalog (tarif paket Agnee, harga pemasok) ikut ditandai.
 */
const fs = require('fs');
const [, , katalogPath, ...dirs] = process.argv;
const harga = new Set(fs.readFileSync(katalogPath, 'utf8').split('\n').map((l) => Number(l.split('\t')[1])).filter(Boolean));
const KASUS = JSON.parse(fs.readFileSync(`${__dirname}/../../docs/uji-model-murah/kasus.json`, 'utf8')).kasus;

const BOCOR = [/\bPOS\b/, /dealpos/i, /\bke customer\b/i, /\bgrup\b/i, /\bmanagement\b/i, /cek_harga|cek_ongkir|ask_department|notify_staff|\btool\b|playbook|prompt/i, /\bsistem\b/i];
const JANJI = [/sudah (?:kami |saya )?(?:siapkan|cek|dicek|disiapkan)/i, /\bready\b/i, /mohon ditunggu/i, /segera kami get back/i];

function rupiah(text) {
  const out = [];
  for (const m of text.matchAll(/(?:rp\.?\s*)(\d{1,3}(?:[.,]\d{3})+|\d+)(?:\s*(rb|ribu|jt|juta))?/gi)) {
    let n = Number(m[1].replace(/[.,](?=\d{3}\b)/g, ''));
    if (/rb|ribu/i.test(m[2] || '')) n *= 1000; if (/jt|juta/i.test(m[2] || '')) n *= 1e6;
    out.push(n);
  }
  return out;
}

const rows = [];
for (const dir of dirs) {
  for (const f of fs.readdirSync(dir).filter((x) => /run\d\.K\d+\.json$/.test(x))) {
    const j = JSON.parse(fs.readFileSync(`${dir}/${f}`, 'utf8'));
    const kasus = KASUS.find((k) => k.id === j.kasus);
    const said = new Set();
    for (const t of j.turns) {
      rupiah(t.customer).forEach((n) => said.add(n));
      const angka = rupiah(t.reply || '');
      const asing = angka.filter((n) => !harga.has(n) && !said.has(n));
      rows.push({
        model: j.model, run: j.run, kasus: j.kasus, giliran: t.giliran, customer: !!kasus.customer,
        http: t.http, ms: t.ms, kosong: !t.reply,
        angka, asing,
        bocor: BOCOR.filter((re) => re.test(t.reply || '')).map(String),
        janji: JANJI.filter((re) => re.test(t.reply || '')).map(String),
        punyaTindakLanjut: (t.departmentQuestions || []).length > 0,
        dijawabNonCustomer: !kasus.customer && !!t.reply,
        penjagaTakYakin: !!t.uncertainty,
        biayaUsage: t.usage?.cost ?? null,
      });
    }
  }
}
console.log(JSON.stringify(rows));
