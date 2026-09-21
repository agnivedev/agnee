'use strict';

/**
 * Plafon aliran SSE dihitung per company, bukan satu angka untuk seluruh
 * server.
 *
 * Dulu `SSE_MAX_CLIENTS = 50` berlaku global: company yang ramai menghabiskan
 * jatah company lain, jadi pelanggan yang tidak melakukan apa pun kehilangan
 * pembaruan realtime karena tetangganya membuka banyak tab. Yang kena batas
 * harus yang menyebabkannya.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { WhatsappManager } = require('../src/whatsapp-manager');

const A = 'company-a';
const B = 'company-b';

function isiAliran(manager, companyId, jumlah) {
  for (let i = 0; i < jumlah; i += 1) manager.addSseClient(companyId, { id: `${companyId}-${i}` });
}

test('company yang mencapai plafonnya sendiri tidak menutup company lain', () => {
  const manager = new WhatsappManager();
  isiAliran(manager, A, WhatsappManager.SSE_MAX_PER_COMPANY);

  const a = manager.canAcceptSseClient(A);
  assert.equal(a.ok, false);
  assert.equal(a.reason, 'company');

  // Inti perbaikannya: tetangganya tidak ikut kena.
  assert.equal(manager.canAcceptSseClient(B).ok, true);
  assert.equal(manager.sseClientCount(B), 0);
});

test('menutup satu tab mengembalikan jatahnya', () => {
  const manager = new WhatsappManager();
  const raw = { id: 'tab-terakhir' };
  isiAliran(manager, A, WhatsappManager.SSE_MAX_PER_COMPANY - 1);
  manager.addSseClient(A, raw);

  assert.equal(manager.canAcceptSseClient(A).ok, false);
  manager.removeSseClient(A, raw);
  assert.equal(manager.canAcceptSseClient(A).ok, true);
  assert.equal(manager.sseClientCount(A), WhatsappManager.SSE_MAX_PER_COMPANY - 1);
});

test('plafon global tetap ada di atasnya, dan tidak bisa dicapai satu company sendiri', () => {
  const manager = new WhatsappManager();
  const perCompany = WhatsappManager.SSE_MAX_PER_COMPANY;
  const jumlahCompany = Math.ceil(WhatsappManager.SSE_MAX_TOTAL / perCompany);

  for (let i = 0; i < jumlahCompany; i += 1) isiAliran(manager, `company-${i}`, perCompany);
  assert.equal(manager.totalSseClients() >= WhatsappManager.SSE_MAX_TOTAL, true);

  // Company ke-N+1 ditolak, tapi alasannya jujur: yang habis adalah kapasitas
  // proses, bukan jatah company itu.
  const baru = manager.canAcceptSseClient('company-baru');
  assert.equal(baru.ok, false);
  assert.equal(baru.reason, 'total');

  // Dan satu company sendiri tidak mungkin sampai ke plafon global.
  assert.equal(perCompany < WhatsappManager.SSE_MAX_TOTAL, true);
});
