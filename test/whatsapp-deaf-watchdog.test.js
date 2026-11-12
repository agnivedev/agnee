'use strict';

const { test, mock } = require('node:test');
const assert = require('node:assert');
const { WhatsappManager, isDeafProbe, canReattach, repairListeners } = require('../src/whatsapp-manager.js');

const silentLog = { info() {}, warn() {}, error() {}, debug() {} };
const healthy = { helper: true, binding: true, addListeners: 1, changeListeners: 1 };
// Keadaan Beweix 12 Nov: helper dan binding ada, tidak ada satu pun Msg.on().
const stalled = { helper: true, binding: true, addListeners: 0, changeListeners: 0 };

const flush = async (n = 60) => { for (let i = 0; i < n; i += 1) await Promise.resolve(); };

test('isDeafProbe: sehat, tuli, dobel, dan versi tak dikenal', () => {
  assert.equal(isDeafProbe(healthy), false);
  assert.equal(isDeafProbe({ ...healthy, addListeners: null }), false, 'versi tak dikenal dianggap sehat');
  assert.equal(isDeafProbe(stalled), true);
  assert.equal(isDeafProbe({ ...healthy, addListeners: 2 }), true, 'pendengar dobel = balasan dobel');
  assert.equal(isDeafProbe({ ...healthy, binding: false }), true);
  assert.equal(isDeafProbe({ ...healthy, helper: false }), true);
  assert.equal(isDeafProbe(null), true);
});

test('canReattach hanya untuk pendengar yang hilang total', () => {
  assert.equal(canReattach(stalled), true);
  assert.equal(canReattach({ ...stalled, changeListeners: 1 }), false, 'terpasang sebagian');
  assert.equal(canReattach({ ...healthy, addListeners: 2 }), false);
  assert.equal(canReattach({ ...stalled, helper: false }), false);
  assert.equal(canReattach(null), false);
});

test('repairListeners memasang ulang di halaman yang sama', async () => {
  let state = stalled;
  let attachCalls = 0;
  const wa = {
    pupPage: { evaluate: async () => state },
    attachEventListeners: async () => { attachCalls += 1; state = healthy; },
  };
  const result = await repairListeners(wa, { log: silentLog });
  assert.equal(attachCalls, 1);
  assert.deepEqual(result, healthy);
  // Sudah sehat: tidak dipasang lagi.
  await repairListeners(wa, { log: silentLog });
  assert.equal(attachCalls, 1);
});

test('repairListeners tidak menyentuh pendengar dobel', async () => {
  let attachCalls = 0;
  const wa = {
    pupPage: { evaluate: async () => ({ ...healthy, addListeners: 2 }) },
    attachEventListeners: async () => { attachCalls += 1; },
  };
  await repairListeners(wa, { log: silentLog });
  assert.equal(attachCalls, 0);
});

async function setup(probes, { attach } = {}) {
  const manager = new WhatsappManager();
  const created = {};
  const attached = {};
  manager._createClient = (connectionId) => {
    const entry = manager._getEntry(connectionId);
    created[connectionId] = (created[connectionId] || 0) + 1;
    entry.client = {
      initialize: async () => {},
      destroy: async () => {},
      getState: async () => 'CONNECTED',
      info: { wid: { _serialized: 'x@c.us' } },
      attachEventListeners: async () => {
        attached[connectionId] = (attached[connectionId] || 0) + 1;
        if (attach) attach(connectionId);
      },
      pupPage: { evaluate: async (fn) => (typeof fn === 'function' && fn.name === 'deafProbeInPage' ? probes[connectionId]() : true), on() {}, once() {} },
      pupBrowser: { once() {} },
    };
  };
  for (const id of Object.keys(probes)) {
    await manager.startFor(id, { companyId: 'c1', clientId: `cl-${id}`, sessionPath: '/tmp/wa' }, { log: silentLog });
  }
  return { manager, created, attached };
}

test('watchdog: pendengar hilang dipasang ulang tanpa restart; nomor lain tidak disentuh', async () => {
  mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  try {
    const state = { deaf: stalled, ok: healthy };
    const { manager, created, attached } = await setup(
      { deaf: () => state.deaf, ok: () => state.ok },
      { attach: (id) => { state[id] = healthy; } },
    );
    for (const id of ['deaf', 'ok']) manager._getEntry(id).state.phase = 'ready';
    mock.timers.tick(60_000);
    await flush();
    assert.equal(attached.deaf || 0, 0, 'probe pertama belum cukup');
    mock.timers.tick(60_000);
    await flush(120);
    assert.equal(attached.deaf, 1, 'pendengar dipasang ulang');
    assert.equal(created.deaf, 1, 'tanpa restart');
    assert.equal(attached.ok || 0, 0, 'client sehat tidak disentuh');
    assert.equal(created.ok, 1);
    await manager.destroyAll();
  } finally {
    mock.timers.reset();
  }
});

test('watchdog: pendengar dobel membuat client dibuat ulang', async () => {
  mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  try {
    const { manager, created, attached } = await setup({ dup: () => ({ ...healthy, addListeners: 2 }) });
    manager._getEntry('dup').state.phase = 'ready';
    mock.timers.tick(60_000);
    await flush();
    mock.timers.tick(60_000);
    await flush(120);
    assert.equal(attached.dup || 0, 0, 'tidak dipasang lagi di atas duplikat');
    assert.equal(created.dup, 2, 'client dibuat ulang');
    await manager.destroyAll();
  } finally {
    mock.timers.reset();
  }
});

test('sesi dipulihkan: tidak dinyatakan ready selama pendengar belum terpasang', async () => {
  mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'] });
  try {
    const state = { s: stalled };
    const { manager, attached } = await setup(
      { s: () => state.s },
      { attach: () => { state.s = healthy; } },
    );
    const entry = manager._getEntry('s');
    entry.state.phase = 'authenticated';
    // Masa tenggang: whatsapp-web.js mungkin masih memasang sendiri.
    for (let i = 0; i < 4; i += 1) { mock.timers.tick(5_000); await flush(); }
    assert.notEqual(entry.state.phase, 'ready', 'belum ready tanpa pendengar');
    assert.equal(attached.s || 0, 0, 'belum turun tangan selama masa tenggang');
    // Lewat 30 detik tanpa pendengar: dipasang ulang, lalu ready.
    for (let i = 0; i < 6; i += 1) { mock.timers.tick(5_000); await flush(120); }
    assert.equal(attached.s, 1);
    assert.equal(entry.state.phase, 'ready');
    await manager.destroyAll();
  } finally {
    mock.timers.reset();
  }
});
