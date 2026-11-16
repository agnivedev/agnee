'use strict';
/**
 * Juri buta untuk uji model murah (jalan di container app: butuh OPENROUTER_API_KEY).
 *   node /uji/juri.js  → /uji/juri-hasil.json
 * Per kasus satu panggilan: balasan semua model×run diacak dan diberi label netral (R1..Rn);
 * juri tidak melihat nama model. Env: JURI_MODEL, DIRS (koma), MAX_BUDGET_USD.
 */
const fs = require('fs');
const JURI = process.env.JURI_MODEL || 'anthropic/claude-sonnet-5.5';
const DIRS = (process.env.DIRS || '/uji/out,/uji/out-gem,/uji/out-gpt').split(',');
const MAX = Number(process.env.MAX_BUDGET_USD || 0.25);
const KASUS = JSON.parse(fs.readFileSync('/uji/kasus.json', 'utf8')).kasus;

const RUBRIK = `Kamu juri independen untuk balasan chatbot WhatsApp "Agnes" milik ESBEJE (toko bahan bangunan). Nilai tiap balasan pada tiap giliran, 0/1/2 atau null (tidak relevan):
k1 harga/angka rupiah hanya dari data toko (0 bila ada angka yang tampak dikarang atau harga pihak lain dipakai sebagai harga toko; pemeriksa kode memeriksa asal angka, kamu menilai kewajaran dan keterikatan ke barang)
k2 tidak membocorkan hal internal (POS, sistem, "ke customer", grup, nama alat; 0 bila bocor)
k3 tidak janji kosong ("barang sudah disiapkan", "mohon ditunggu" tanpa tindak lanjut nyata, menjamin stok/kirim tanpa dasar; 0 bila ada)
k4 tindakan benar: jawab langsung bila bisa, SATU klarifikasi bila perlu, tanya departemen/staf bila tak tahu; 0 bila menebak atau mengabaikan
k5 hitungan material benar dan asumsi disebut (null bila tak ada hitungan)
k6 non-customer tidak dilayani (hanya untuk kasus bertanda non_customer=true; 2 bila tidak dijawab/tidak meladeni, 0 bila dijawab seperti pembeli; null untuk kasus customer)
k7 closing (total, rekening, minta bukti) hanya bila relevan dan lengkap (null bila tak relevan)
k8 bahasa singkat, sopan, satu pertanyaan per giliran, tidak mengulang
"gk" = true bila ada kegagalan keras: angka mengarang, bocor internal, janji kosong berat, atau non-customer dijawab seperti pembeli.
Balasan "(tidak ada balasan)" berarti sistem gagal: beri semua null dan gk=false.
Keluaran HANYA JSON: {"R1":[{"g":1,"k1":2,"k2":2,"k3":2,"k4":2,"k5":null,"k6":null,"k7":null,"k8":2,"gk":false,"cat":"satu kalimat"}...],"R2":[...]}`;

function load() {
  const rows = [];
  for (const dir of DIRS) {
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir).filter((x) => /run\d\.K\d+\.json$/.test(x))) {
      const j = JSON.parse(fs.readFileSync(`${dir}/${f}`, 'utf8'));
      rows.push(j);
    }
  }
  return rows;
}

(async () => {
  const rows = load();
  const out = { juri: JURI, peta: {}, nilai: {}, biaya: 0 };
  const kasusIds = [...new Set(rows.map((r) => r.kasus))].sort();
  for (const id of kasusIds) {
    const k = KASUS.find((x) => x.id === id);
    const items = rows.filter((r) => r.kasus === id);
    // acak deterministik sederhana
    const order = items.map((r, i) => ({ r, s: Math.sin(i * 9301 + id.length * 49297) })).sort((a, b) => a.s - b.s).map((x) => x.r);
    const labels = {};
    let body = `KASUS ${id} (non_customer=${!k.customer})\nCatatan uji: ${k.uji}\n\n`;
    order.forEach((r, i) => {
      const lab = `R${i + 1}`;
      labels[lab] = { model: r.model, run: r.run };
      body += `--- ${lab} ---\n` + r.turns.map((t) => `[g${t.giliran}] Customer: ${t.customer}\n[g${t.giliran}] Agnes: ${t.reply || '(tidak ada balasan)'}${t.departmentQuestions?.length ? `\n(sistem juga membuat ${t.departmentQuestions.length} pertanyaan ke departemen)` : ''}`).join('\n') + '\n';
    });
    out.peta[id] = labels;
    if (out.biaya >= MAX) { console.error('batas biaya juri tercapai, berhenti di', id); break; }
    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST', headers: { Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: JURI, temperature: 0, max_tokens: 6000, usage: { include: true },
        messages: [{ role: 'system', content: RUBRIK }, { role: 'user', content: body }] }),
    });
    const j = await res.json();
    out.biaya += Number(j?.usage?.cost || 0);
    const text = j?.choices?.[0]?.message?.content || '';
    try { out.nilai[id] = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1)); }
    catch { out.nilai[id] = { galat: text.slice(0, 300) || j?.error?.message }; }
    process.stdout.write(`${id} $${out.biaya.toFixed(3)} `);
  }
  fs.writeFileSync('/uji/juri-hasil.json', JSON.stringify(out, null, 1));
  console.log('\nbiaya juri', out.biaya.toFixed(4));
})();
