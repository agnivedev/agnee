'use strict';

/**
 * Pemeriksaan bukti transfer di chat. Model penglihat hanya MEMBACA foto
 * (angka, tanggal, rekening tujuan); semua penilaian cocok/tidak dilakukan di
 * sini, di kode, terhadap rekening dan total yang kita pegang. Hasilnya tidak
 * pernah berarti "lunas": bukti bisa dipalsukan dan screenshot tidak menjamin
 * dana masuk, jadi keputusan akhir tetap di staf yang melihat mutasi bank.
 */

const { matchAccount } = require('./payment-accounts.js');

const MAX_IMAGE_BYTES = 6 * 1024 * 1024;
const MAX_AGE_DAYS = 3;
const VERDICTS = ['cocok', 'perlu_dicek', 'tidak_cocok', 'bukan_bukti'];

const SYSTEM_PROMPT = `Kamu membaca foto yang dikirim customer di chat toko. Tugasmu hanya MEMBACA, bukan menilai.
Jawab HANYA dengan satu objek JSON, tanpa teks lain, dengan field:
{"isTransferProof": boolean, // true jika ini bukti/struk transfer bank, e-wallet, atau QRIS
 "status": "success"|"pending"|"failed"|"unknown", // status transaksi yang tertulis
 "amount": number|null, // nominal dalam Rupiah, angka bulat tanpa titik
 "date": "YYYY-MM-DD"|null, "time": "HH:MM"|null,
 "recipientName": string|null, "recipientBank": string|null,
 "recipientAccount": string|null, // nomor rekening tujuan persis seperti tertulis, termasuk tanda * bila disamarkan
 "senderName": string|null, "referenceNo": string|null,
 "looksEdited": boolean, // ada tanda diedit: font berbeda, angka tidak sejajar, potongan tempelan
 "notes": string}
Jangan menebak: field yang tidak terbaca diisi null. Kalau foto bukan bukti transfer (produk, KTP, chat, dll) isi isTransferProof=false.`;

function stripFence(text) {
  return String(text || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
}

/** JSON dari model -> bentuk terjamin. Tidak pernah melempar. */
function parseReading(raw) {
  let data;
  try { data = JSON.parse(stripFence(raw)); } catch { return null; }
  if (!data || typeof data !== 'object') return null;
  const str = (v) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, 120) : null);
  const amount = Number(data.amount);
  return {
    isTransferProof: data.isTransferProof === true,
    status: ['success', 'pending', 'failed'].includes(data.status) ? data.status : 'unknown',
    amount: Number.isFinite(amount) && amount > 0 ? Math.round(amount) : null,
    date: /^\d{4}-\d{2}-\d{2}$/.test(data.date || '') ? data.date : null,
    time: /^\d{2}:\d{2}$/.test(data.time || '') ? data.time : null,
    recipientName: str(data.recipientName),
    recipientBank: str(data.recipientBank),
    recipientAccount: str(data.recipientAccount),
    senderName: str(data.senderName),
    referenceNo: str(data.referenceNo),
    looksEdited: data.looksEdited === true,
    notes: str(data.notes) || '',
  };
}

const normName = (s) => String(s || '').toUpperCase().replace(/\b(PT|CV|UD|TBK)\b\.?/g, '').replace(/[^A-Z0-9]/g, '');

/**
 * Menilai hasil baca terhadap rekening dan total yang diharapkan.
 * @param {object} reading hasil parseReading
 * @param {{accounts: object[], expectedAmount?: number|null, now?: Date, duplicateOf?: object|null}} ctx
 * @returns {{verdict: string, flags: string[]}}
 */
function evaluate(reading, { accounts = [], expectedAmount = null, now = new Date(), duplicateOf = null } = {}) {
  if (!reading || !reading.isTransferProof) return { verdict: 'bukan_bukti', flags: [] };
  const flags = [];
  let bad = false;

  if (reading.status === 'failed') { flags.push('transaksi_gagal'); bad = true; }
  else if (reading.status === 'pending') flags.push('transaksi_pending');

  if (reading.recipientAccount) {
    const m = matchAccount(reading.recipientAccount, accounts);
    if (m.retired) { flags.push('rekening_lama'); bad = true; }
    else if (!m.account) { flags.push('rekening_tidak_dikenal'); bad = true; }
    else {
      if (!m.exact) flags.push('rekening_tersamar');
      if (reading.recipientName && m.account.accountHolder
        && !normName(m.account.accountHolder).includes(normName(reading.recipientName))
        && !normName(reading.recipientName).includes(normName(m.account.accountHolder))) {
        flags.push('nama_penerima_berbeda');
      }
    }
  } else {
    flags.push('rekening_tak_terbaca');
  }

  if (reading.amount == null) flags.push('nominal_tak_terbaca');
  else if (expectedAmount) {
    if (reading.amount < expectedAmount) { flags.push('nominal_kurang'); bad = true; }
    else if (reading.amount > expectedAmount) flags.push('nominal_lebih');
  } else {
    flags.push('total_tak_diketahui');
  }

  if (reading.date) {
    const ageDays = (now.getTime() - new Date(`${reading.date}T12:00:00+07:00`).getTime()) / 86_400_000;
    if (ageDays > MAX_AGE_DAYS) flags.push('tanggal_lama');
    if (ageDays < -1) flags.push('tanggal_masa_depan');
  } else {
    flags.push('tanggal_tak_terbaca');
  }

  if (reading.looksEdited) flags.push('tampak_diedit');
  if (duplicateOf) { flags.push('bukti_dipakai_ulang'); bad = true; }

  const needsCheck = flags.some((f) => !['rekening_tersamar', 'nominal_lebih'].includes(f));
  return { verdict: bad ? 'tidak_cocok' : (needsCheck ? 'perlu_dicek' : 'cocok'), flags };
}

const FLAG_TEXT = {
  transaksi_gagal: 'status transaksi gagal',
  transaksi_pending: 'status transaksi masih pending',
  rekening_lama: 'transfer ke REKENING LAMA yang sudah tidak dipakai',
  rekening_tidak_dikenal: 'rekening tujuan bukan rekening toko',
  rekening_tersamar: 'nomor rekening tujuan disamarkan, cocok dengan akhiran rekening toko',
  rekening_tak_terbaca: 'rekening tujuan tidak terbaca',
  nama_penerima_berbeda: 'nama penerima berbeda dengan pemilik rekening toko',
  nominal_kurang: 'nominal KURANG dari total',
  nominal_lebih: 'nominal lebih dari total',
  nominal_tak_terbaca: 'nominal tidak terbaca',
  total_tak_diketahui: 'total tagihan belum diketahui sistem',
  tanggal_lama: `tanggal transfer lebih dari ${MAX_AGE_DAYS} hari lalu`,
  tanggal_masa_depan: 'tanggal transfer di masa depan',
  tanggal_tak_terbaca: 'tanggal tidak terbaca',
  tampak_diedit: 'foto tampak diedit',
  bukti_dipakai_ulang: 'bukti yang sama sudah pernah dikirim',
};

const VERDICT_TEXT = {
  cocok: 'tampak cocok (belum diverifikasi staf)',
  perlu_dicek: 'perlu dicek staf',
  tidak_cocok: 'TIDAK COCOK',
  bukan_bukti: 'foto ini bukan bukti transfer',
};

const rupiah = (n) => `Rp${Number(n).toLocaleString('id-ID')}`;

/** Satu baris ringkas untuk staf (inbox) dan untuk AI. */
function summarize({ verdict, flags = [], extracted = {}, expectedAmount = null }) {
  if (verdict === 'bukan_bukti') return VERDICT_TEXT.bukan_bukti;
  const parts = [VERDICT_TEXT[verdict] || verdict];
  const facts = [];
  if (extracted.amount) facts.push(rupiah(extracted.amount));
  if (expectedAmount) facts.push(`total ${rupiah(expectedAmount)}`);
  if (extracted.date) facts.push(extracted.date);
  if (facts.length) parts.push(facts.join(', '));
  const why = flags.map((f) => FLAG_TEXT[f]).filter(Boolean);
  if (why.length) parts.push(why.join('; '));
  return parts.join(' — ');
}

/** Catatan yang ditempel di belakang pesan customer supaya AI tahu hasilnya. */
function aiMarker(result) {
  return `[Pemeriksaan bukti transfer (otomatis, bukan keputusan akhir): ${summarize(result)}]`;
}

/**
 * Total yang diharapkan: angka "total/jumlah/tagihan ... Rp X" terbaru yang
 * ditulis kita (AI atau staf) di chat. Tebakan; null bila tidak ada, dan
 * hasilnya jadi "total belum diketahui", bukan dianggap cocok.
 */
function guessExpectedAmount(messages = []) {
  const pattern = /(?:total|jumlah|tagihan|dibayar|bayar)[^\n\d]{0,40}Rp\.?\s*([\d][\d.,]*)/i;
  for (let i = messages.length - 1; i >= 0 && i >= messages.length - 12; i -= 1) {
    const m = messages[i];
    if (!m?.fromMe) continue;
    const hit = pattern.exec(String(m.body || ''));
    if (!hit) continue;
    const amount = Number(hit[1].replace(/[.,](?=\d{3}\b)/g, '').replace(/[.,]\d{1,2}$/, ''));
    if (Number.isFinite(amount) && amount >= 1000) return amount;
  }
  return null;
}

module.exports = {
  guessExpectedAmount, MAX_IMAGE_BYTES, MAX_AGE_DAYS, VERDICTS, SYSTEM_PROMPT, parseReading, evaluate, summarize, aiMarker, FLAG_TEXT,
};
