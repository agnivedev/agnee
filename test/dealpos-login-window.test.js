'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const dealposSync = require('../src/dealpos-sync.js');

test('jendela login 06.30–21.30 menurut zona waktu company', () => {
  const at = (iso) => new Date(iso);
  assert.equal(dealposSync.loginWindowOpen(at('2026-11-15T23:29:00Z'), 'Asia/Jakarta'), false); // 06.29
  assert.equal(dealposSync.loginWindowOpen(at('2026-11-15T23:30:00Z'), 'Asia/Jakarta'), true); // 06.30
  assert.equal(dealposSync.loginWindowOpen(at('2026-11-16T14:29:00Z'), 'Asia/Jakarta'), true); // 21.29
  assert.equal(dealposSync.loginWindowOpen(at('2026-11-16T14:30:00Z'), 'Asia/Jakarta'), false); // 21.30
  assert.equal(dealposSync.loginWindowOpen(at('2026-11-16T14:30:00Z'), 'Asia/Makassar'), false); // 22.30
  assert.equal(dealposSync.loginWindowOpen(at('2026-11-16T14:30:00Z'), 'Zona/Ngawur'), false); // jatuh ke Jakarta
});

test('penolakan jam login dikenali, error lain tidak', async () => {
  const body = { Message: 'You only allowed to login on Sunday, Monday between 06:30 until 21:30' };
  const fetchImpl = async () => ({ status: 400, ok: false, headers: new Headers(), text: async () => JSON.stringify(body) });
  await assert.rejects(
    dealposSync.fetchToken({ host: 'h.test', clientId: 'a', clientSecret: 'b' }, fetchImpl),
    (error) => dealposSync.isLoginWindowError(error) && /06\.30–21\.30/.test(error.message),
  );
  const other = async () => ({ status: 401, ok: false, headers: new Headers(), text: async () => JSON.stringify({ Message: 'Invalid client' }) });
  await assert.rejects(
    dealposSync.fetchToken({ host: 'h2.test', clientId: 'a', clientSecret: 'b' }, other),
    (error) => !dealposSync.isLoginWindowError(error) && /menolak permintaan: Invalid client/.test(error.message),
  );
});
