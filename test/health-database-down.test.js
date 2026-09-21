'use strict';

/**
 * `/health` harus ikut merah kalau database yang seharusnya hidup tidak
 * menjawab.
 *
 * Healthcheck di compose.yml hanya melihat status HTTP rute ini, dan rute ini
 * dulu selalu 200 — itulah sebabnya pada 21 Sep container dilaporkan `healthy`
 * selama 16 jam sementara app melayani tanpa database sama sekali, dan yang
 * pertama tahu adalah orang yang tidak bisa login.
 *
 * Dua hal yang dikunci di sini: (1) database mati = 503, database yang memang
 * sengaja tidak ada (demo/lokal) tetap 200; (2) login tidak lagi menjawab
 * "email atau password salah" untuk kerusakan kita sendiri.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildApp } = require('../src/server');

function dbYangMati() {
  return {
    enabled: true,
    connected: false,
    async connect() {}, async close() {},
    status() { return { driver: 'postgresql', connected: false }; },
    async ping() { return { driver: 'postgresql', connected: false, enabled: true }; },
    async setPresence() {},
  };
}

function dbYangHidup() {
  return {
    enabled: true,
    connected: true,
    async connect() {}, async close() {},
    status() { return { driver: 'postgresql', connected: true }; },
    async ping() { return { driver: 'postgresql', connected: true, enabled: true }; },
    async authenticateUser() { return null; },
    async getActiveSessionUser() { return null; },
    async setPresence() {},
  };
}

test('/health balas 503 kalau database aktif tapi putus', async (t) => {
  const app = await buildApp({
    logger: false, startupEnabled: false, demoMode: true,
    database: dbYangMati(), sessionSecret: 'health-1',
  });
  t.after(() => app.close());

  const health = await app.inject({ method: 'GET', url: '/health' });
  assert.equal(health.statusCode, 503);
  assert.equal(health.json().ok, false);
  assert.equal(health.json().database.connected, false);
});

test('/health tetap 200 kalau database memang sengaja tidak dipakai', async (t) => {
  const app = await buildApp({
    logger: false, startupEnabled: false, demoMode: true,
    databaseUrl: null, sessionSecret: 'health-2',
  });
  t.after(() => app.close());

  const health = await app.inject({ method: 'GET', url: '/health' });
  assert.equal(health.statusCode, 200);
  assert.equal(health.json().ok, true);
});

test('/health 200 kalau database hidup', async (t) => {
  const app = await buildApp({
    logger: false, startupEnabled: false, demoMode: true,
    database: dbYangHidup(), sessionSecret: 'health-3',
  });
  t.after(() => app.close());

  const health = await app.inject({ method: 'GET', url: '/health' });
  assert.equal(health.statusCode, 200);
  assert.equal(health.json().ok, true);
});

test('login saat database putus balas 503, bukan "email atau password salah"', async (t) => {
  const app = await buildApp({
    logger: false, startupEnabled: false, demoMode: true,
    database: dbYangMati(),
    adminEmail: 'owner@example.com', adminPassword: 'strong-pass',
    sessionSecret: 'health-4',
  });
  t.after(() => app.close());

  const pengguna = await app.inject({
    method: 'POST', url: '/v1/auth/login',
    payload: { email: 'agent@pelanggan.test', password: 'password-yang-benar' },
  });
  assert.equal(pengguna.statusCode, 503);
  assert.match(pengguna.json().error, /bukan password/i);

  // Dan fallback admin pun tidak boleh membuka pintu selama database yang
  // seharusnya ada sedang putus — persis jalur yang kemarin meloloskan admin
  // sementara semua pengguna asli ditolak.
  const admin = await app.inject({
    method: 'POST', url: '/v1/auth/login',
    payload: { email: 'owner@example.com', password: 'strong-pass' },
  });
  assert.equal(admin.statusCode, 503);
});
