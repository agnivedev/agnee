'use strict';

/**
 * Penjaga klaim stok.
 * Audit DealPOS-Agnes (ESBEJE, 16 Nov): celah yang terbukti dari balasan AI dan kueri customer nyata.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const guard = require('../src/uncertainty-guard.js');

const assess = (over = {}) => guard.assess({
  customerText: '', rawText: '', finalText: '', priceSource: '', factSource: '', toolText: '', toolOutputs: [], ...over,
});
const codes = (a) => a.reasons.map((r) => r.code);

// ---- Stok: katalog/POS tidak punya data stok --------------------------------------------------

const HARGA_NOTE = '{"status":"ok","hasil":[{"nama":"SEMEN JAKARTA Type PCC 40KG","harga":"Rp 45.000 per zak"}],"catatan":"Harga jual dari POS saat ini. Bukan informasi stok."}';

test('stok: catatan "Bukan informasi stok" di hasil cek_harga tidak mematikan penjaga klaim stok', () => {
  const finalText = 'Stoknya masih ready kak, Semen Jakarta 40KG Rp 45.000 per zak.';
  const a = assess({ customerText: 'Semen jakarta ready ga?', finalText, rawText: finalText, priceSource: finalText, toolText: HARGA_NOTE });
  assert.deepEqual(codes(a), ['stock_claim']);
  // Data stok sungguhan di hasil alat tetap sah.
  const real = assess({ customerText: 'Semen jakarta ready ga?', finalText, rawText: finalText, priceSource: finalText, toolText: '{"nama":"SEMEN JAKARTA","stok":40}' });
  assert.deepEqual(codes(real), []);
});

test('stok: "Kami ready <barang>" tanpa ditanya tetap klaim stok (ESBEJE 6 dan 8 Nov)', () => {
  for (const finalText of [
    'Ada kak. Kami ready Semen Jakarta 40KG seharga Rp 45.000 per zak. Kakak butuh berapa zak?',
    'Ada kak. Kami ready triplek dengan berbagai ukuran, mulai Rp 75.600 per lbr.',
  ]) {
    const a = assess({ customerText: 'Ada zak semen mba', finalText, rawText: finalText, priceSource: finalText, toolText: HARGA_NOTE });
    assert.deepEqual(codes(a), ['stock_claim'], finalText);
  }
});

test('stok: syarat dan ajakan cek ketersediaan bukan klaim', () => {
  for (const finalText of [
    'Kalau ready saya proses ya kak, Rp 45.000 per zak.',
    'Saya cek ketersediaannya dulu ke tim ya kak.',
    'Untuk jenis semen yang tersedia: Semen Jakarta Rp 45.000 per zak.',
  ]) {
    assert.deepEqual(codes(assess({ customerText: 'ada semen?', finalText, rawText: finalText, priceSource: finalText })), [], finalText);
  }
});

