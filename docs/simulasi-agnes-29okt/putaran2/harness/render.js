'use strict';
// Render transkrip simulasi jadi tampilan chat + catatan "di balik layar", lalu screenshot penuh (puppeteer).
const fs = require('node:fs');
const path = require('node:path');
const WT = process.argv[2];
const OUT = process.argv[3];
const puppeteer = require(path.join(WT, 'node_modules/puppeteer'));
const D = require('./esbeje.json');
const groupName = Object.fromEntries(D.departments.filter((d) => d.whatsappGroupId).map((d) => [d.whatsappGroupId, d.name]));

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const wa = (s) => esc(s).replace(/\*([^*\n]+)\*/g, '<b>$1</b>').replace(/\n/g, '<br>');
const rp = (n) => `Rp ${Number(n).toLocaleString('id-ID')}`;
const short = (s, n = 140) => { const t = String(s || '').replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };

function notes(events, r) {
  const out = [];
  for (const e of events || []) {
    if (e.kind === 'alat') {
      const o = e.out || {};
      if (e.name === 'cek_harga') out.push(['harga', `Cek harga DealPOS “${esc(e.args.barang)}” → ${esc(o.hasil?.[0]?.nama || o.status)} ${esc(o.hasil?.[0]?.harga || '')}`]);
      else if (e.name === 'cek_alamat') out.push(['harga', `Cek alamat di peta → ${esc(o.status)}${o.terbaca ? `: ${esc(short(o.terbaca, 80))}` : ''}`]);
      else if (e.name === 'cek_ongkir') out.push(['ongkir', o.status === 'ok' ? `Cek ongkir Lalamove → ${esc(o.ongkir)} (${esc(o.layanan)})` : `Cek ongkir: menunggu Management memilih kendaraan`]);
      else if (e.name === 'susun_rincian') out.push(['hitung', o.status === 'koreksi' ? `Rincian dihitung alat: hitungan AI ${rp(e.args.grand_total_hitunganmu)} salah, dibetulkan jadi ${rp(o.grand_total)}` : `Rincian dihitung alat: grand total ${rp(o.grand_total)} (cocok dengan hitungan AI)`]);
      else if (e.name === 'buat_proforma') out.push([o.status === 'ok' ? 'dok' : 'gagal', o.status === 'ok' ? `Proforma DealPOS (Estimate) ${esc(o.nomor)} dibuat, grand total ${rp(o.grand_total)}` : `buat_proforma gagal: ${esc(o.status)} ${esc((o.kode || []).join(', '))}`]);
      else if (e.name === 'buat_invoice') out.push([o.status === 'ok' ? 'dok' : 'info', o.status === 'ok' ? `Invoice DealPOS ${esc(o.nomor_invoice)} dibuat (${esc(o.total)}) + kurir Lalamove dipesan` : `buat_invoice: ${esc(o.status)} (${esc(o.pesan)})`]);
      continue;
    }
    if (e.kind === 'tanya_departemen') out.push(['dept', `AI bertanya ke ${esc(e.department)}${e.jenis === 'lalamove_vehicle' ? ' (pilih kendaraan Lalamove)' : ''}: “${esc(short(e.question, 170))}”`]);
    if (e.kind === 'jawaban_departemen') out.push(['dept', `${esc(e.department)} menjawab di grup: “${esc(e.answer)}” → ${e.hasil?.relayed ? 'diteruskan AI ke customer' : `tidak diteruskan (${esc(e.hasil?.reason)})`}`]);
    if (e.kind === 'lalamove_quote') out.push(['ongkir', e.total ? `Tarif Lalamove sandbox (panggilan asli) ${esc(e.serviceType)}, ${e.km} km → ${rp(e.total)}` : `Lalamove sandbox: ${esc(e.serviceType)} tidak melayani area ini (${esc(e.error)}) → alat mencoba kendaraan yang lebih besar`]);
    if (e.kind === 'lalamove_place') out.push(['gagal', `Order kurir ke Lalamove sandbox ditolak (HTTP ${e.status}): ${esc(e.error)} → AI bilang tim memesan manual`]);
    if (e.kind === 'baca_gambar' && e.purpose === 'payment_proof') {
      const p = r.proofs[r.proofs.length - 1];
      if (p) out.push([p.verdict === 'cocok' ? 'ok' : 'gagal', `Cek bukti transfer otomatis: <b>${esc(p.verdict.toUpperCase())}</b>${p.flags.length ? ` (${esc(p.flags.join(', '))})` : ''} · terbaca ${rp(p.extracted.amount)} ke ${esc(p.extracted.recipientBank)} ${esc(p.extracted.recipientAccount)} · tagihan ${rp(p.expectedAmount)}`]);
    }
    if (e.kind === 'pesan_internal' && e.to.endsWith('@g.us')) out.push(['grup', `<b>Pesan ke grup WA ${esc(groupName[e.to] || e.to)}:</b><br>${wa(short(e.text, 420))}`]);
    if (e.kind === 'pesan_internal' && e.to === '6281100000001@c.us') out.push(['info', `Notifikasi serah-terima ke nomor staf: “${esc(short(e.text.split('\n').slice(0, 3).join(' · '), 150))}”`]);
  }
  // pesan yang sama ke grup bisa terulang (pertanyaan dibuka lagi); tampilkan sekali
  const seen = new Set();
  return out.filter(([, t]) => (seen.has(t) ? false : seen.add(t)));
}

function html(r) {
  const rows = [];
  for (const t of r.timeline) {
    const ns = notes(t.events, r);
    if (t.from === 'customer') {
      rows.push(t.image
        ? `<div class="b me img"><img src="${esc(t.image)}"><span class="cap">Foto bukti transfer</span></div>`
        : `<div class="b me">${wa(t.text)}</div>`);
    }
    if (t.from === 'agnes') rows.push(`<div class="b them">${wa(t.text)}</div>`);
    if (ns.length) rows.push(`<div class="sys">${ns.map(([k, x]) => `<div class="n ${k}">${x}</div>`).join('')}</div>`);
  }
  return `<!doctype html><meta charset="utf-8"><style>
*{box-sizing:border-box}body{margin:0;background:#d1d7db;font:14.5px/1.4 -apple-system,"Helvetica Neue",Arial,sans-serif;color:#111b21}
.wrap{width:560px;margin:0 auto;background:#efeae2;min-height:100vh}
.top{background:#008069;color:#fff;padding:14px 16px}
.top .t{font-weight:600;font-size:16px}.top .s{font-size:12.5px;opacity:.9;margin-top:2px}
.case{background:#fff8c5;color:#3b3200;font-size:12.5px;padding:8px 16px;border-bottom:1px solid #e6dca0}
.feed{padding:12px 12px 24px;display:flex;flex-direction:column;gap:6px}
.b{max-width:78%;padding:7px 10px;border-radius:8px;box-shadow:0 1px .5px rgba(0,0,0,.13);word-wrap:break-word}
.me{align-self:flex-end;background:#d9fdd3}.them{align-self:flex-start;background:#fff}
.img{padding:4px}.img img{width:200px;display:block;border-radius:6px}.cap{display:block;font-size:12px;color:#54656f;padding:4px 4px 0}
.sys{align-self:stretch;margin:4px 6px;display:flex;flex-direction:column;gap:4px}
.n{font-size:12px;line-height:1.35;padding:6px 9px;border-radius:6px;background:#f0f2f5;border-left:3px solid #8696a0;color:#3b4a54}
.n.harga{border-color:#1f7aec}.n.ongkir{border-color:#7a5af8}.n.hitung{border-color:#0e9384}.n.dok{border-color:#008069;background:#e7f6ee}
.n.dept{border-color:#dc6803}.n.grup{border-color:#dc6803;background:#fff4e5}.n.ok{border-color:#008069;background:#e7f6ee}.n.gagal{border-color:#d92d20;background:#fdecea}
.legend{font-size:11.5px;color:#54656f;padding:10px 16px 16px;background:#efeae2}
</style><div class="wrap"><div class="top"><div class="t">Agnes · ESBEJE</div><div class="s">Simulasi ${esc(r.nama)} (+${esc(r.chatId.split('@')[0])}) · 29 Okt 2026 · putaran 2 (setelah perbaikan)</div></div>
<div class="case"><b>${esc(r.title)}</b><br>Hijau = customer, putih = Agnes. Kotak abu-abu = yang terjadi di balik layar (tidak dilihat customer).</div>
<div class="feed">${rows.join('\n')}</div>
<div class="legend">Jalur pesan masuk WhatsApp yang sama dengan produksi, model AI asli, katalog &amp; harga DealPOS ESBEJE asli (10.902 barang), rekening BCA asli. Ditiru: WhatsApp, penulisan dokumen DealPOS, jawaban grup Management/Finance. ASLI: model AI, katalog &amp; harga DealPOS, tarif dan order ke Lalamove sandbox (kunci sandbox ESBEJE), pencarian alamat peta.</div></div>`;
}

(async () => {
  const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new' });
  for (const name of ['kasus1', 'kasus2', 'kasus3']) {
    const r = JSON.parse(fs.readFileSync(path.join(OUT, `${name}.json`), 'utf8'));
    const file = path.join(OUT, `${name}.html`);
    fs.writeFileSync(file, html(r));
    const page = await browser.newPage();
    await page.setViewport({ width: 560, height: 900, deviceScaleFactor: 2 });
    await page.goto(`file://${path.resolve(file)}`, { waitUntil: 'load' });
    const total = await page.evaluate(() => document.documentElement.scrollHeight);
    const PART = 1250;
    const n = Math.ceil(total / PART);
    for (let i = 0; i < n; i += 1) {
      const y = i * PART;
      await page.screenshot({ path: path.join(OUT, `${name}-${i + 1}.png`), clip: { x: 0, y, width: 560, height: Math.min(PART, total - y) }, captureBeyondViewport: true });
    }
    await page.close();
    console.log('png', name);
  }
  await browser.close();
})();
