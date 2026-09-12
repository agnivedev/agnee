'use strict';

const { test, mock } = require('node:test');
const assert = require('node:assert');
const { WhatsappManager } = require('../src/whatsapp-manager.js');

const silentLog = { info() {}, warn() {}, error() {}, debug() {} };

/** Biarkan rantai promise di dalam satu tick watchdog selesai. */
async function flush(times = 6) {
  for (let i = 0; i < times; i += 1) await Promise.resolve();
}

/**
 * Memasang manager dengan client palsu, tanpa Chromium.
 * `overrides` boleh mengganti getState / evaluate untuk mensimulasikan
 * socket yang belum tersambung atau helper halaman yang gagal ter-inject.
 */
async function startWithFakeClient(overrides = {}) {
  const manager = new WhatsappManager();
  const created = [];

  manager._createClient = (connectionId) => {
    const entry = manager._getEntry(connectionId);
    const client = {
      initialize: async () => {},
      destroy: async () => {},
      getState: overrides.getState || (async () => 'CONNECTED'),
      info: { wid: { _serialized: '628111345938@c.us' } },
      pupPage: {
        evaluate: overrides.evaluate || (async () => true),
        on() {},
        once() {},
      },
      pupBrowser: { once() {} },
    };
    entry.client = client;
    created.push(client);
    return client;
  };

  // Kunci manager sekarang connectionId, dan companyId ikut di konfigurasi.
  await manager.startFor('conn-1', {
    companyId: 'c1', clientId: 'agnee-c1', sessionPath: '/tmp/wa',
  }, { log: silentLog });
  return { manager, entry: manager._getEntry('conn-1'), created };
}

test('watchdog tetap berjalan setelah fase berubah jadi syncing', async () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const { entry } = await startWithFakeClient();

    // Ini yang dulu mematikan pemulihan: begitu WhatsApp menembakkan
    // loading_screen, fase jadi 'syncing' dan watchdog lama langsung keluar.
    entry.state.phase = 'syncing';
    entry.state.syncPercent = 100;
    entry.state.lastProgressAt = Date.now(); // masih ada kemajuan

    mock.timers.tick(5_000);
    await flush();

    assert.equal(entry.state.phase, 'syncing', 'sync yang sehat tidak boleh dipaksa ready');
    assert.ok(entry.restoredSessionTimer, 'watchdog harus tetap terjadwal, bukan menyerah diam-diam');
  } finally {
    mock.timers.reset();
  }
});

test('watchdog memulihkan client yang macet di syncing 100%', async () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const { entry } = await startWithFakeClient();

    entry.state.phase = 'syncing';
    entry.state.syncPercent = 100;
    entry.state.qrDataUrl = 'data:image/png;base64,stale';
    // Persen berhenti bergerak lebih lama dari SYNC_STALL_MS: halamannya macet.
    entry.state.lastProgressAt = Date.now() - 120_000;

    mock.timers.tick(5_000);
    await flush();

    assert.equal(entry.state.phase, 'ready');
    assert.equal(entry.state.account, '628111345938@c.us');
    assert.equal(entry.state.qrDataUrl, null, 'QR basi harus dibersihkan saat ready');
    assert.equal(entry.state.syncPercent, 100);
  } finally {
    mock.timers.reset();
  }
});

test('watchdog memulai ulang sekali saat helper halaman tidak pernah dimuat', async () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const { entry, created } = await startWithFakeClient({ evaluate: async () => false });

    entry.state.phase = 'syncing';
    entry.state.lastProgressAt = Date.now() - 120_000;

    mock.timers.tick(5_000);
    await flush();

    assert.equal(created.length, 2, 'client harus dibuat ulang tepat sekali');
    assert.equal(entry.state.phase, 'starting');
  } finally {
    mock.timers.reset();
  }
});

test('entry di-key connectionId, SSE tetap per company', async () => {
  const manager = new WhatsappManager();
  manager.addSseClient('c1', { write() {} });
  manager.addSseClient('c1', { write() {} });
  manager.addSseClient('c2', { write() {} });

  // Dua nomor milik company yang sama.
  manager._getEntry('conn-a', 'c1');
  manager._getEntry('conn-b', 'c1');
  manager._getEntry('conn-c', 'c2');

  assert.deepEqual(manager.listConnectionIds('c1').sort(), ['conn-a', 'conn-b']);
  assert.equal(manager.totalSseClients(), 3, 'pendengar SSE dihitung per company, bukan per nomor');

  manager._entries.get('conn-a').client = {};
  manager._entries.get('conn-b').client = {};
  assert.equal(manager.activeCompanyCount(), 1, 'satu company dengan dua nomor tetap satu company');
  assert.deepEqual(manager.liveConnectionIds('c1').sort(), ['conn-a', 'conn-b']);
});
