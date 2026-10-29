'use strict';
// Tiga kasus customer + pembuat foto bukti transfer (gambar uji, bukan dokumen bank asli).
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const rp = (n) => `Rp ${Number(n).toLocaleString('id-ID')}`;

function proofMaker({ from, sender, ref }) {
  return async (amount, file) => {
    const html = `<!doctype html><meta charset="utf-8"><style>
body{margin:0;background:#eef2f7;font-family:-apple-system,Helvetica,Arial,sans-serif}
.c{width:330px;background:#fff;min-height:720px}
.h{background:#0a4ea3;color:#fff;padding:18px 20px;font-size:17px;font-weight:600}
.ok{margin:22px 20px 6px;color:#0a8a3a;font-weight:700;font-size:20px}
.t{margin:0 20px 18px;color:#555;font-size:13px}
.a{margin:0 20px 18px;font-size:30px;font-weight:700;color:#111}
.r{display:flex;justify-content:space-between;padding:10px 20px;border-top:1px solid #eee;font-size:14px}
.r span:first-child{color:#777}
</style><div class="c"><div class="h">m-Transfer</div>
<div class="ok">Transfer Berhasil</div><div class="t">29/10/2026 10:42:17 WIB</div>
<div class="a">${rp(amount)}</div>
<div class="r"><span>Dari</span><span>${from}</span></div>
<div class="r"><span>Nama Pengirim</span><span>${sender}</span></div>
<div class="r"><span>Bank Tujuan</span><span>BCA</span></div>
<div class="r"><span>Rekening Tujuan</span><span>1721726989</span></div>
<div class="r"><span>Nama Penerima</span><span>PT KARYA WARNA KEMENANGAN</span></div>
<div class="r"><span>Berita</span><span>bahan bangunan</span></div>
<div class="r"><span>No. Referensi</span><span>${ref}</span></div>
</div>`;
    const htmlFile = file.replace(/\.png$/, '.html');
    fs.writeFileSync(htmlFile, html);
    execFileSync(CHROME, ['--headless=new', '--disable-gpu', '--hide-scrollbars', `--screenshot=${path.resolve(file)}`, '--window-size=440,720', `file://${path.resolve(htmlFile)}`], { stdio: 'ignore' });
    return { file: path.basename(file), base64: fs.readFileSync(file).toString('base64'), amount };
  };
}

module.exports = {
  kasus1: {
    title: 'Kasus 1 — Plester dinding, customer MAU barang tambahan',
    nama: 'Pak Rudi',
    chatId: '6281390001111@c.us',
    opening: 'kak MU 301 brp ya? butuh 12 sak',
    persona: 'Kamu Pak Rudi, tukang yang merenovasi rumah klien di BSD. Kamu butuh MU 301 sebanyak 12 sak untuk plester dinding kamar. Kalau Agnes menawarkan barang pelengkap yang masuk akal (mis. acian/skimwall), kamu MAU dan minta dihitung sekalian (ambil 4 sak). Kalau Agnes minta alamat, isi formatnya persis begini (tiap baris): "Alamat lengkap: Jl. BSD Grand Boulevard No. 5\nKelurahan: Lengkong Gudang\nKabupaten: Tangerang\nKota: Tangerang Selatan\nProvinsi: Banten". Kalau diminta nama dan nomor penerima, jawab "Rudi, 081390001111". Setujui rincian dan proforma kalau angkanya masuk akal, lalu tanya transfer ke mana.',
    management: { kendaraan: 'pakai pick up', umum: 'Ada kak, stok aman.', finance: 'Sudah masuk, nominal sesuai. Silakan diproses.' },
    makeProof: proofMaker({ from: 'BCA 0123xxxx89', sender: 'RUDI HARTONO', ref: 'MT29102026A01' }),
  },
  kasus2: {
    title: 'Kasus 2 — Semen, customer MENOLAK tawaran, cuma mau 1 barang',
    nama: 'Bu Sari',
    chatId: '6281390002222@c.us',
    opening: 'semen jakarta 40kg ada kak? mau 10 sak',
    persona: 'Kamu Bu Sari, pemilik rumah di Kembangan, Jakarta Barat, mau bikin cor kecil di teras. Kamu HANYA butuh semen jakarta 40kg 10 sak. Kalau Agnes menawarkan barang lain apa pun, tolak tegas: "ga usah kak, semen aja, langsung totalnya aja ya". Kalau Agnes minta alamat, isi formatnya persis begini (tiap baris): "Alamat lengkap: Jl. Kembangan Raya No. 10\nKelurahan: Kembangan Selatan\nKabupaten: -\nKota: Jakarta Barat\nProvinsi: DKI Jakarta". Kalau diminta nama dan nomor penerima, jawab "Sari, 081390002222". Setujui rincian dan proforma kalau masuk akal, lalu tanya transfer ke mana.',
    management: { kendaraan: 'pick up aja', umum: 'Ada kak, stok aman.', finance: 'Sudah masuk, nominal sesuai. Silakan diproses.' },
    makeProof: proofMaker({ from: 'BCA 0456xxxx12', sender: 'SARI WULANDARI', ref: 'MT29102026B02' }),
  },
  kasus3: {
    title: 'Kasus 3 — Toren, customer menolak tawaran, bukti transfer KURANG',
    nama: 'Mas Andi',
    chatId: '6281390003333@c.us',
    opening: 'toren penguin 1050 liter brp kak',
    persona: 'Kamu Mas Andi, sedang membangun rumah 2 lantai di Tangerang, butuh 1 toren Penguin 1050 liter. Kalau Agnes menawarkan barang pelengkap, tolak: "ga dulu kak, torennya aja". Kalau Agnes minta alamat, isi formatnya persis begini (tiap baris): "Alamat lengkap: Jl. Kisamaun No. 20\nKelurahan: Sukasari\nKabupaten: Tangerang\nKota: Tangerang\nProvinsi: Banten". Kamu bingung memilih warna toren, jadi tanya "ada warna apa aja kak?" kalau Agnes belum menyebut pilihannya. Kalau diminta nama dan nomor penerima, jawab "Andi, 081390003333". Setujui rincian dan proforma, lalu tanya transfer ke mana.',
    management: { kendaraan: 'pick up', umum: 'Ada kak, stok aman.', finance: 'Dana masuk tapi kurang Rp 50.000 dari tagihan. Mohon customer transfer kekurangannya.' },
    buktiSelisih: -50000, // transfer kurang Rp 50.000 dari tagihan
    makeProof: proofMaker({ from: 'BCA 0789xxxx34', sender: 'ANDI PRATAMA', ref: 'MT29102026C03' }),
  },
};
