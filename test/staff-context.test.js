'use strict';

/**
 * Konteks staf untuk AI (src/staff-context.js). Kasus ESBEJE 9 Nov: pesan staf
 * "kami bantu buatkan proforma invoice" dibaca AI sebagai kalimatnya sendiri.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const staff = require('../src/staff-context');

test('pesan keluar yang ditulis manusia diberi penanda; tulisan AI dan customer tidak', () => {
  const human = staff.historyTurn({ fromMe: true, authorKind: 'human', content: 'kami bantu buatkan proforma invoice yah' });
  assert.equal(human.role, 'assistant');
  assert.match(human.content, /^\[Staf tim, bukan kamu\] kami bantu/);
  assert.deepEqual(staff.historyTurn({ fromMe: true, authorKind: 'ai', content: 'Siap kak' }), { role: 'assistant', content: 'Siap kak' });
  assert.deepEqual(staff.historyTurn({ fromMe: true, authorKind: 'broadcast', content: 'Promo' }), { role: 'assistant', content: 'Promo' });
  assert.deepEqual(staff.historyTurn({ fromMe: false, content: 'Utk apa kak?' }), { role: 'user', content: 'Utk apa kak?' });
});

test('penanda tidak ditumpuk dan bisa dibuang lagi', () => {
  const once = staff.labelStaffContent('halo');
  assert.equal(staff.labelStaffContent(once), once);
  assert.equal(staff.stripStaffLabel(once), 'halo');
});

test('aturan staf masuk system prompt hanya bila riwayat memuat pesan staf', () => {
  const plain = [{ role: 'user', content: 'halo' }, { role: 'assistant', content: 'Siap kak' }];
  assert.equal(staff.withStaffContext('PROMPT', plain), 'PROMPT');
  const withStaff = [...plain, staff.historyTurn({ fromMe: true, authorKind: 'human', content: 'proforma sudah dibuat' })];
  const prompt = staff.withStaffContext('PROMPT', withStaff);
  assert.match(prompt, /Staf manusia sudah turun tangan/);
  assert.match(prompt, /Lawan bicaramu SELALU customer/);
  assert.match(prompt, /jangan menawarkan membuatkan/);
  // idempoten
  assert.equal(staff.withStaffContext(prompt, withStaff), prompt);
});
