'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  columnLetter, rangeAddress, blankRowCount, encodeShareLink,
  fetchAppToken, resolveWorkbook, syncRows,
} = require('../src/onedrive-sync.js');

test('huruf kolom Excel', () => {
  assert.equal(columnLetter(1), 'A');
  assert.equal(columnLetter(23), 'W');
  assert.equal(columnLetter(26), 'Z');
  assert.equal(columnLetter(27), 'AA');
  assert.equal(columnLetter(52), 'AZ');
  assert.equal(columnLetter(53), 'BA');
});

test('alamat range', () => {
  assert.equal(rangeAddress(1, 1, 23), 'A1:W1');
  assert.equal(rangeAddress(2, 10, 23), 'A2:W11');
  // Blok kosong tetap punya minimal satu baris; Graph menolak range nol baris.
  assert.equal(rangeAddress(2, 0, 3), 'A2:C2');
});

test('sisa baris lama dihitung untuk dikosongkan', () => {
  // Kontak berkurang: sisanya harus ditimpa, kalau tidak baris lama terlihat
  // seperti kontak yang masih ada.
  assert.equal(blankRowCount(40, 30), 10);
  assert.equal(blankRowCount(10, 30), 0);
  assert.equal(blankRowCount(0, 0), 0);
});

test('tautan berbagi di-encode sesuai aturan Graph', () => {
  const token = encodeShareLink('https://contoh-my.sharepoint.com/:x:/g/personal/a/EabcDEF');
  assert.ok(token.startsWith('u!'));
  assert.ok(!token.includes('='), 'padding harus dibuang');
  assert.ok(!token.includes('+') && !token.includes('/'), 'harus base64url');
});

test('token gagal memberi pesan dari Microsoft, bukan HTTP saja', async () => {
  const fakeFetch = async () => ({
    ok: false, status: 401,
    json: async () => ({ error_description: 'AADSTS7000215: Invalid client secret provided.' }),
  });
  await assert.rejects(
    () => fetchAppToken({ tenantId: 't', clientId: 'c', clientSecret: 'salah' }, fakeFetch),
    /Invalid client secret provided/,
  );
});

test('file non-xlsx ditolak sebelum menulis apa pun', async () => {
  const fakeFetch = async () => ({
    ok: true,
    json: async () => ({ id: 'item1', name: 'Kontak.docx', parentReference: { driveId: 'd1' } }),
  });
  await assert.rejects(
    () => resolveWorkbook('token', 'https://contoh/link', fakeFetch),
    /harus \.xlsx/,
  );
});

test('sync menulis header, baris, lalu mengosongkan sisa', async () => {
  const calls = [];
  const fakeFetch = async (url, options) => {
    calls.push({ url, body: JSON.parse(options.body) });
    return { ok: true, json: async () => ({}) };
  };
  const header = ['A', 'B'];
  const rows = [['1', '2'], ['3', '4']];

  const out = await syncRows('token', {
    driveId: 'd1', itemId: 'i1', worksheetName: 'Kontak',
    header, rows, previousRowCount: 5,
  }, fakeFetch);

  assert.equal(out.rowCount, 2);
  assert.equal(out.blanked, 3);
  assert.equal(calls.length, 3, 'header, data, lalu blok kosong');
  assert.match(calls[0].url, /address='A1:B1'/);
  assert.match(calls[1].url, /address='A2:B3'/);
  assert.match(calls[2].url, /address='A4:B6'/, 'blok kosong mulai tepat di bawah data');
  assert.deepEqual(calls[2].body.values, [['', ''], ['', ''], ['', '']]);
});

test('tanpa kontak, header tetap ditulis', async () => {
  const calls = [];
  const fakeFetch = async (url, options) => {
    calls.push({ url, body: JSON.parse(options.body) });
    return { ok: true, json: async () => ({}) };
  };
  const out = await syncRows('token', {
    driveId: 'd1', itemId: 'i1', worksheetName: 'Kontak',
    header: ['A'], rows: [], previousRowCount: 0,
  }, fakeFetch);
  assert.equal(out.rowCount, 0);
  assert.equal(calls.length, 1, 'hanya header; tidak ada blok data kosong yang sia-sia');
});
