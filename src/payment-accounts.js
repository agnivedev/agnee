'use strict';

/**
 * Rekening pembayaran per company. Dipakai dua tempat: AI menyebutkannya saat
 * closing, dan pemeriksa bukti transfer mencocokkan rekening tujuan di foto.
 *
 * Rekening berstatus 'retired' (rekening lama) tidak pernah diberikan ke
 * customer, tetapi tetap dikenali: customer yang membayar ke rekening lama
 * harus ditandai, bukan dianggap "rekening tidak dikenal".
 */

const STATUSES = ['active', 'retired'];
const MAX_ACCOUNTS = 10;

const digits = (value) => String(value ?? '').replace(/\D/g, '');

function normalizeAccount(input = {}) {
  const bank = String(input.bankName ?? '').trim().replace(/\s+/g, ' ');
  const number = String(input.accountNumber ?? '').trim().replace(/\s+/g, ' ');
  const holder = String(input.accountHolder ?? '').trim().replace(/\s+/g, ' ');
  const status = STATUSES.includes(input.status) ? input.status : 'active';
  if (!bank) return { error: 'Nama bank wajib diisi.' };
  if (!/^[0-9][0-9 .-]*$/.test(number) || digits(number).length < 5 || digits(number).length > 25) {
    return { error: 'Nomor rekening harus berupa angka (5–25 digit).' };
  }
  if (bank.length > 60 || holder.length > 100) return { error: 'Nama bank atau pemilik terlalu panjang.' };
  return {
    account: {
      bankName: bank, accountNumber: number, accountHolder: holder || null, status,
      note: String(input.note ?? '').trim().slice(0, 300) || null,
    },
  };
}

/**
 * Rekening yang dipakai: baris payment_accounts; bila company belum punya baris
 * (belum membuka layar baru), kolom bank_* lama menjadi satu rekening aktif.
 */
function effectiveAccounts(rows, legacy = {}) {
  const list = Array.isArray(rows) ? rows : [];
  if (list.length) return list;
  if (legacy.bankAccount) {
    return [{
      id: null, bankName: legacy.bankName || 'Bank', accountNumber: legacy.bankAccount,
      accountHolder: legacy.bankHolder || null, status: 'active', legacy: true,
    }];
  }
  return [];
}

const activeOf = (accounts) => accounts.filter((a) => a.status !== 'retired');
const retiredOf = (accounts) => accounts.filter((a) => a.status === 'retired');

const lastDigits = (value, n = 4) => digits(value).slice(-n);

/**
 * Bagian prompt: aturan closing yang menuntut rekening. Hanya rekening aktif
 * yang ditulis lengkap; rekening lama cukup sebagai peringatan bertopeng.
 */
function section(accounts, { proofCheck = false } = {}) {
  const active = activeOf(accounts);
  if (!active.length) return '';
  const lines = ['### Transfer bank (rekening resmi)'];
  active.forEach((a, i) => {
    if (active.length > 1) lines.push(`Rekening ${i + 1}:`);
    lines.push(`Bank: ${a.bankName}`, `No. Rekening: ${a.accountNumber}`);
    if (a.accountHolder) lines.push(`Atas nama: ${a.accountHolder}`);
    if (a.note) lines.push(`Catatan: ${a.note}`);
  });
  lines.push(
    'ATURAN CLOSING: saat customer sudah memilih produk dan siap membayar, WAJIB sebutkan rekening di atas lengkap (bank, nomor, atas nama) bersama total yang harus dibayar. Jangan menunggu customer menanyakan rekening. Jangan pernah memberi rekening selain daftar ini dan jangan mengarang atau mengubah satu digit pun.',
  );
  const retired = retiredOf(accounts);
  if (retired.length) {
    lines.push(`Rekening berikut SUDAH TIDAK DIPAKAI (jangan diberikan; jika customer menyebutnya, katakan sudah tidak berlaku dan arahkan ke rekening resmi di atas): ${retired.map((a) => `${a.bankName} berakhiran ${lastDigits(a.accountNumber)}`).join(', ')}.`);
  }
  lines.push(proofCheck
    ? 'Setelah customer mentransfer, minta bukti transfer berupa foto/screenshot di chat ini. Sistem akan membaca foto itu sendiri; hasilnya muncul sebagai catatan "[Pemeriksaan bukti transfer ...]" di pesan customer. Jangan pernah menyatakan pembayaran SUDAH DITERIMA atau pesanan lunas: katakan bukti sedang diverifikasi tim, dan sampaikan hasil pemeriksaan hanya sebagai kabar menunggu atau permintaan perbaikan.'
    : 'Setelah customer mentransfer, minta bukti transfer lalu serahkan ke supervisor untuk verifikasi. Jangan menyatakan pembayaran sudah diterima.');
  return lines.join('\n');
}

/** Cocokkan nomor rekening tujuan hasil baca foto. Foto sering menyamarkan sebagian digit. */
function matchAccount(recipientNumber, accounts) {
  const seen = digits(recipientNumber);
  if (seen.length < 4) return { account: null, exact: false };
  const hit = (list) => list.find((a) => {
    const full = digits(a.accountNumber);
    if (full === seen) return true;
    // Nomor tersamar ("****6989"): cocok bila potongan yang terlihat sama dengan akhiran.
    return seen.length >= 4 && seen.length < full.length && full.endsWith(seen);
  });
  const active = hit(activeOf(accounts));
  if (active) return { account: active, exact: digits(active.accountNumber) === seen };
  const retired = hit(retiredOf(accounts));
  return { account: retired || null, exact: false, retired: Boolean(retired) };
}

module.exports = {
  STATUSES, MAX_ACCOUNTS, digits, normalizeAccount, effectiveAccounts, activeOf, retiredOf, lastDigits, section, matchAccount,
};
