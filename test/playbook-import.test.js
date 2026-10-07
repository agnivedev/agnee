'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { splitSections, kindFromHeading, composeDocs } = require('../src/playbook-import.js');

const SAMPLE = `# Brand X — Playbook

Versi draft, belum diterapkan.

## 1. Persona & tone

Nama: Asisten X.

### Contoh

“Halo kak!”

## 2. Prohibitions

Jangan mengarang harga.

## 3. Questions & answers

Q: Harga?
A: Tergantung scope.

## 7. Follow-up rules

Maksimal dua follow-up.

## 8. When to hand over

Saat minta manusia.

## Ringkasan brand

X adalah studio CGI.
`;

test('memotong di tingkat heading yang berulang; judul dokumen tidak jadi bagian', () => {
  const { title, sections } = splitSections(SAMPLE);
  assert.equal(title, 'Brand X — Playbook');
  assert.deepEqual(sections.map((s) => s.heading), [
    '', 'Persona & tone', 'Prohibitions', 'Questions & answers', 'Follow-up rules', 'When to hand over', 'Ringkasan brand',
  ]);
  // Sub-heading ### tetap menempel pada induknya.
  assert.match(sections[1].body, /### Contoh\n\n“Halo kak!”/);
  assert.equal(sections[0].body, 'Versi draft, belum diterapkan.');
});

test('judul dikenali dalam bahasa Inggris maupun Indonesia', () => {
  assert.equal(kindFromHeading('1. Persona & tone'), 'persona');
  assert.equal(kindFromHeading('Prohibitions'), 'compliance');
  assert.equal(kindFromHeading('Larangan saat closing'), 'compliance');
  assert.equal(kindFromHeading('Questions & answers'), 'qna');
  assert.equal(kindFromHeading('FAQ'), 'qna');
  assert.equal(kindFromHeading('Discovery'), 'discovery');
  assert.equal(kindFromHeading('Objection handling'), 'objection');
  assert.equal(kindFromHeading('Menangani keberatan'), 'objection');
  assert.equal(kindFromHeading('Closing'), 'closing');
  assert.equal(kindFromHeading('Follow-up rules'), 'followup');
  assert.equal(kindFromHeading('When to hand over'), 'handoff');
  assert.equal(kindFromHeading('Ringkasan brand'), null);
});

test('dokumen tanpa heading Markdown (PDF/teks) tetap terpecah lewat judul bernomor', () => {
  const plain = 'Pembuka.\n\n1. Persona & tone\nRamah.\n\n2. Prohibitions\nJangan janji.\n';
  const { sections } = splitSections(plain);
  assert.deepEqual(sections.map((s) => [s.heading, kindFromHeading(s.heading)]), [
    ['', null], ['Persona & tone', 'persona'], ['Prohibitions', 'compliance'],
  ]);
});

test('composeDocs: isi dipindah apa adanya, bagian tambahan tetap berjudul, skip dibuang', () => {
  const docs = composeDocs([
    { heading: '', body: 'Catatan penyusun.', kind: 'skip' },
    { heading: 'Persona & tone', body: 'Nama: Asisten X.\n\n### Contoh\nHalo', kind: 'persona' },
    { heading: 'Ringkasan brand', body: 'X adalah studio CGI.', kind: 'persona' },
    { heading: 'Prohibitions', body: 'Jangan mengarang harga.', kind: 'compliance' },
  ]);
  assert.deepEqual([...docs.keys()], ['persona', 'compliance']);
  // Judul yang memang nama jenisnya dibuang (konteks sudah memberinya judul),
  // heading di dalamnya diturunkan supaya tidak menyaingi judul konteks.
  assert.equal(docs.get('persona'), 'Nama: Asisten X.\n\n###### Contoh\nHalo\n\n#### Ringkasan brand\n\nX adalah studio CGI.');
  assert.equal(docs.get('compliance'), 'Jangan mengarang harga.');
  assert.ok(![...docs.values()].some((md) => md.includes('Catatan penyusun')));
});
