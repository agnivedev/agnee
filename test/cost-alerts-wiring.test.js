'use strict';

/**
 * Penyambungan kanal alert di server.js: kanal WhatsApp harus melewati
 * resolusi company → normalisasi nomor → sendOutbound sungguhan. Tanpa nomor
 * WhatsApp yang tersambung (seperti di test ini) jalur itu berhenti di
 * pemeriksaan kesiapan nomor — penolakan YANG BENAR. Kalau penyambungannya
 * salah, errornya akan lain (TypeError, company tidak ditemukan, nomor tidak sah).
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildApp } = require('../src/server');

const COMPANY_ID = '11111111-2222-3333-4444-555555555555';

function fakeDatabase() {
  const marked = [];
  return {
    marked,
    enabled: true, connected: true,
    async connect() {}, async close() {},
    status() { return { driver: 'postgresql', connected: true }; },
    async resolveCompanyId(slug) { return slug === 'beweix-digital' ? COMPANY_ID : null; },
    async getCompanyConfig() { return { whatsappProvider: 'whatsapp_web' }; },
    async listCostAlertCandidates() {
      return [{ id: COMPANY_ID, slug: 'acme', name: 'Acme', plan: 'company', status: 'active', costUsd30d: 150, calls30d: 1, notifiedAt: null }];
    },
    async markCostAlertNotified(ids) { marked.push(...ids); },
    async clearCostAlerts() {},
  };
}

function withEnv(values, fn) {
  const saved = {};
  for (const key of Object.keys(values)) { saved[key] = process.env[key]; process.env[key] = values[key]; }
  return fn().finally(() => {
    for (const key of Object.keys(values)) {
      if (saved[key] === undefined) delete process.env[key]; else process.env[key] = saved[key];
    }
  });
}

test('server: dua kanal terpasang dan WhatsApp terkonfigurasi dari env', async (t) => {
  await withEnv({ COST_ALERT_WA_COMPANY: 'beweix-digital', COST_ALERT_WA_TO: '08121111111' }, async () => {
    const app = await buildApp({ logger: false, startupEnabled: false, demoMode: true, database: fakeDatabase(), sessionSecret: 'wiring-1' });
    t.after(() => app.close());
    const { channels } = app.costAlertMonitor;
    assert.deepEqual(channels.map((c) => [c.name, c.configured]), [['email', false], ['whatsapp', true]]);
  });
});

test('server: kirim WhatsApp sampai ke pemeriksaan nomor siap, bukan error penyambungan', async (t) => {
  await withEnv({ COST_ALERT_WA_COMPANY: 'beweix-digital', COST_ALERT_WA_TO: '08121111111' }, async () => {
    const app = await buildApp({ logger: false, startupEnabled: false, demoMode: true, database: fakeDatabase(), sessionSecret: 'wiring-2' });
    t.after(() => app.close());
    const wa = app.costAlertMonitor.channels.find((c) => c.name === 'whatsapp');
    await assert.rejects(wa.send({ whatsapp: 'x' }), /Belum ada nomor WhatsApp yang siap mengirim|tidak tersambung/);
  });
});

test('server: company pengirim yang salah ditolak dengan pesan yang jelas', async (t) => {
  await withEnv({ COST_ALERT_WA_COMPANY: 'tidak-ada', COST_ALERT_WA_TO: '08121111111' }, async () => {
    const app = await buildApp({ logger: false, startupEnabled: false, demoMode: true, database: fakeDatabase(), sessionSecret: 'wiring-3' });
    t.after(() => app.close());
    const wa = app.costAlertMonitor.channels.find((c) => c.name === 'whatsapp');
    await assert.rejects(wa.send({ whatsapp: 'x' }), /tidak ditemukan: tidak-ada/);
  });
});

test('server: WhatsApp gagal dan email belum ada berarti belum ditandai terkabari', async (t) => {
  await withEnv({ COST_ALERT_WA_COMPANY: 'beweix-digital', COST_ALERT_WA_TO: '08121111111' }, async () => {
    const database = fakeDatabase();
    const app = await buildApp({ logger: false, startupEnabled: false, demoMode: true, database, sessionSecret: 'wiring-4' });
    t.after(() => app.close());
    const result = await app.costAlertMonitor.check(new Date());
    assert.equal(result.sent, false);
    assert.equal(result.reason, 'send_failed');
    assert.deepEqual(result.failed, ['whatsapp']);
    assert.deepEqual(database.marked, [], 'dicoba lagi putaran berikutnya');
  });
});
