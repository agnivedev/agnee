'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const {
  rangeA1, quoteSheetName, extractSpreadsheetId,
  fetchAccessToken, listSheetTabs, ensureTab, syncRows,
} = require('../src/gsheets-sync.js');

test('ID spreadsheet diambil dari tautan maupun ID telanjang', () => {
  const id = '1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms';
  assert.equal(extractSpreadsheetId(`https://docs.google.com/spreadsheets/d/${id}/edit#gid=0`), id);
  assert.equal(extractSpreadsheetId(`https://docs.google.com/spreadsheets/d/${id}`), id);
  assert.equal(extractSpreadsheetId(id), id);
  assert.throws(() => extractSpreadsheetId('https://contoh.com/bukan-sheet'), /bukan tautan Google Sheets/);
});

test('nama tab dikutip dengan benar', () => {
  assert.equal(quoteSheetName('Kontak'), "'Kontak'");
  assert.equal(quoteSheetName('Data Lead'), "'Data Lead'");
  // Kutip tunggal di nama tab digandakan, bukan di-escape backslash.
  assert.equal(quoteSheetName("Anya's"), "'Anya''s'");
});

test('range A1', () => {
  assert.equal(rangeA1('Kontak', 1, 1, 23), "'Kontak'!A1:W1");
  assert.equal(rangeA1('Kontak', 2, 10, 23), "'Kontak'!A2:W11");
});

test('private key rusak memberi pesan yang menjelaskan penyebabnya', async () => {
  await assert.rejects(
    () => fetchAccessToken({ clientEmail: 'a@b.iam.gserviceaccount.com', privateKey: 'bukan-pem' }),
    /Private key service account tidak valid/,
  );
});

test('JWT ditandatangani dan token ditukar', async () => {
  const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const pem = privateKey.export({ type: 'pkcs8', format: 'pem' });
  let sent = null;
  const fakeFetch = async (url, options) => {
    sent = { url, body: new URLSearchParams(options.body) };
    return { ok: true, json: async () => ({ access_token: 'tok', expires_in: 3600 }) };
  };
  const out = await fetchAccessToken(
    { clientEmail: 'a@b.iam.gserviceaccount.com', privateKey: pem }, fakeFetch,
  );
  assert.equal(out.accessToken, 'tok');
  assert.equal(sent.body.get('grant_type'), 'urn:ietf:params:oauth:grant-type:jwt-bearer');
  assert.equal(sent.body.get('assertion').split('.').length, 3, 'assertion harus JWT tiga bagian');
});

test('sheet belum dibagikan memberi instruksi, bukan kode HTTP', async () => {
  const fakeFetch = async () => ({
    ok: false, status: 403,
    json: async () => ({ error: { message: 'The caller does not have permission' } }),
  });
  await assert.rejects(
    () => listSheetTabs('tok', 'sheet1', fakeFetch),
    /dibagikan sebagai Editor ke email service account/,
  );
});

test('tab yang sudah ada tidak dibuat ulang', async () => {
  const calls = [];
  const fakeFetch = async (url, options) => {
    calls.push(url);
    if (options?.method === 'POST') return { ok: true, json: async () => ({}) };
    return { ok: true, json: async () => ({ properties: { title: 'Buku' }, sheets: [{ properties: { title: 'Kontak' } }] }) };
  };
  const out = await ensureTab('tok', 'sheet1', 'Kontak', fakeFetch);
  assert.equal(out.created, false);
  assert.equal(calls.length, 1, 'tidak ada batchUpdate kalau tab sudah ada');
});

test('sync menulis header, baris, lalu menghapus sisa baris lama', async () => {
  const calls = [];
  const fakeFetch = async (url, options) => {
    calls.push({ url: decodeURIComponent(url), method: options.method });
    return { ok: true, json: async () => ({}) };
  };
  const out = await syncRows('tok', {
    spreadsheetId: 's1', sheetName: 'Kontak',
    header: ['A', 'B'], rows: [['1', '2'], ['3', '4']], previousRowCount: 5,
  }, fakeFetch);

  assert.equal(out.rowCount, 2);
  assert.equal(out.cleared, 3);
  assert.equal(calls.length, 3);
  assert.match(calls[0].url, /'Kontak'!A1:B1/);
  assert.match(calls[1].url, /'Kontak'!A2:B3/);
  // :clear benar-benar mengosongkan sel, bukan mengisinya dengan string kosong,
  // supaya COUNTA dan filter di sheet tetap benar.
  assert.match(calls[2].url, /'Kontak'!A4:B6:clear/);
  assert.equal(calls[2].method, 'POST');
});

test('tanpa kontak, hanya header yang ditulis', async () => {
  const calls = [];
  const fakeFetch = async (url) => { calls.push(url); return { ok: true, json: async () => ({}) }; };
  const out = await syncRows('tok', {
    spreadsheetId: 's1', sheetName: 'Kontak', header: ['A'], rows: [], previousRowCount: 0,
  }, fakeFetch);
  assert.equal(out.rowCount, 0);
  assert.equal(calls.length, 1);
});
