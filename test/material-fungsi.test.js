'use strict';

/**
 * Rekomendasi material harus sesuai fungsi (kasus 4 Nov: Agnes menyarankan
 * triplek blockboard 18 mm untuk plafon). Perbaikannya dua lapis: aturan
 * bawaan Agnee (butir 21, semua tenant) dan panduan di playbook ESBEJE.
 * Perilaku model asli diuji manual lewat /v1/coach/simulate; di sini yang
 * dijaga adalah teks yang sampai ke model.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { conversationRules } = require('../src/reply-style');

const umum = fs.readFileSync(path.join(__dirname, '..', 'playbooks', 'esbeje', 'umum.md'), 'utf8');

test('aturan bawaan: material harus sesuai fungsi, hanya produk yang ada, jujur bila tak ada', () => {
  for (const identity of ['team_member', 'chatbot']) {
    const rules = conversationRules(identity);
    assert.match(rules, /21\. Rekomendasi material harus sesuai fungsi/);
    assert.match(rules, /benar-benar ada di katalog/);
    assert.match(rules, /jangan menggantinya dengan barang yang tidak cocok/);
  }
});

test('playbook ESBEJE: triplek tak lagi dipetakan ke plafon, panduan plafon memuat gypsum/GRC/PVC', () => {
  assert.doesNotMatch(umum, /Triplek: plafon/);
  assert.doesNotMatch(umum, /dipakai untuk apa \(plafon/);
  assert.doesNotMatch(umum, /Atap dan plafon: triplek/);
  const guide = umum.slice(umum.indexOf('### Panduan memilih material'));
  assert.ok(guide.length > 200);
  for (const word of [/gypsum/i, /GRC/, /PVC/, /metal furing/i, /Triplek untuk plafon hanya/]) assert.match(guide, word);
  assert.match(guide, /Luar ruangan/);
});

test('panduan material tetap bagian Tanya jawab umum (jenis qna), bukan judul baru yang tak dikenali', () => {
  const { splitSections, kindFromHeading } = require('../src/playbook-import');
  const { sections } = splitSections(umum);
  for (const s of sections) if (s.heading) assert.ok(kindFromHeading(s.heading), s.heading);
  const qna = sections.find((s) => kindFromHeading(s.heading) === 'qna');
  assert.match(qna.body || qna.content || JSON.stringify(qna), /Panduan memilih material/);
});
