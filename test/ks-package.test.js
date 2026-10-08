'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { loadPackage, validateSpecific, compileKsPrompt, parseAmounts } = require('../src/ks-package');

const DIR = path.join(__dirname, '..', 'knowledge', 'ks', 'funneling-closing');
const pkg = loadPackage(DIR);
const offer = (patch) => ({ name: 'A', kind: 'paid', price: 100, pitch: 'p', ...patch });

test('paket bawaan terbaca dan contoh isiannya lolos skema', () => {
  assert.equal(pkg.manifest.code, 'ks-funneling-closing');
  assert.equal(pkg.general.length, 3);
  assert.deepEqual(validateSpecific(pkg.specificSchema, pkg.example), []);
});

test('isian: tingkat berbayar yang makin mahal ke bawah ditolak', () => {
  const data = { offers: [offer({ price: 100 }), offer({ name: 'B', price: 900 })], order: { how: 'x' } };
  assert.match(validateSpecific(pkg.specificSchema, data).join(' '), /makin murah/);
});

test('isian: gratis bersyarat harus satu dan di tingkat terakhir', () => {
  const free = (name) => offer({ name, kind: 'free_conditional', price: 0, condition: 'c', how: 'h' });
  const duaGratis = { offers: [free('G1'), free('G2')], order: { how: 'x' } };
  assert.match(validateSpecific(pkg.specificSchema, duaGratis).join(' '), /hanya boleh satu/);
  const gratisDiAwal = { offers: [free('G1'), offer({ name: 'B' })], order: { how: 'x' } };
  assert.match(validateSpecific(pkg.specificSchema, gratisDiAwal).join(' '), /tingkat terakhir/);
});

test('isian: syarat wajib untuk gratis bersyarat, tipe salah dan jumlah kurang dilaporkan', () => {
  const noCondition = { offers: [offer(), offer({ name: 'G', kind: 'free_conditional', price: 0 })], order: { how: 'x' } };
  assert.match(validateSpecific(pkg.specificSchema, noCondition).join(' '), /condition: wajib diisi/);
  assert.match(validateSpecific(pkg.specificSchema, noCondition).join(' '), /how: wajib diisi/);
  const bad = { offers: [offer({ price: '100' })], order: {} };
  const problems = validateSpecific(pkg.specificSchema, bad).join(' ');
  assert.match(problems, /bilangan bulat rupiah/);
  assert.match(problems, /minimal 2/);
  assert.match(problems, /order.how: wajib diisi/);
});

test('prompt memuat dokumen umum dan data penawaran bernomor dari tingkat 1', () => {
  const prompt = compileKsPrompt(pkg, pkg.example);
  assert.match(prompt, /### Alur percakapan/);
  assert.match(prompt, /Tingkat 1 \(berbayar\): Paket Lengkap, Rp 2\.500\.000/);
  assert.match(prompt, /Tingkat 3 \(gratis bersyarat\): Panduan PDF Gratis/);
  assert.match(prompt, /Syarat: Follow Instagram/);
  assert.match(prompt, /Cara mengambil: Setelah syaratnya terpenuhi/);
  assert.match(prompt, /### Cara memesan/);
});

test('jumlah rupiah dibaca dari berbagai tulisan', () => {
  assert.deepEqual(parseAmounts('Rp 2.500.000'), [2500000]);
  assert.deepEqual(parseAmounts('2,5 juta atau 750rb'), [2500000, 750000]);
  assert.deepEqual(parseAmounts('Rp750.000 / 750 ribu'), [750000, 750000]);
  assert.deepEqual(parseAmounts('1.5 jt'), [1500000]);
  assert.deepEqual(parseAmounts('Hubungi 0812 dalam 3 hari'), []);
});

test('paket yang rusak menggagalkan pemuatan, tidak ditebak', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ks-'));
  fs.cpSync(DIR, tmp, { recursive: true });
  const manifestPath = path.join(tmp, 'ks.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

  fs.writeFileSync(manifestPath, JSON.stringify({ ...manifest, version: '1.0' }));
  assert.throws(() => loadPackage(tmp), /version harus x\.y\.z/);

  fs.writeFileSync(manifestPath, JSON.stringify({ ...manifest, general: ['../../package.json'] }));
  assert.throws(() => loadPackage(tmp), /di luar folder paket/);

  fs.writeFileSync(manifestPath, JSON.stringify(manifest));
  const scenarios = JSON.parse(fs.readFileSync(path.join(tmp, 'simulation/scenarios.json'), 'utf8'));
  scenarios.scenarios[0].checks.push({ type: 'cek-asing' });
  fs.writeFileSync(path.join(tmp, 'simulation/scenarios.json'), JSON.stringify(scenarios));
  assert.throws(() => loadPackage(tmp), /jenis cek tidak dikenal/);
});

test('link dan akun dikenali dari teks biasa', () => {
  const { extractReferences } = require('../src/ks-package');
  assert.deepEqual(
    extractReferences('Follow @contohusaha. Lalu buka https://contoh.example/a, atau *@lain_lagi*!'),
    ['https://contoh.example/a', '@contohusaha', '@lain_lagi'],
  );
  assert.deepEqual(extractReferences('Hubungi saya di nama@email.com'), []);
});
