'use strict';

const { test, mock } = require('node:test');
const assert = require('node:assert');
const { WhatsappManager, isDeafProbe } = require('../src/whatsapp-manager.js');

const silentLog = { info() {}, warn() {}, error() {}, debug() {} };
const healthy = { helper: true, store: true, binding: true, addListeners: 1 };

test('isDeafProbe: sehat, tuli, dan versi tak dikenal', () => {
  assert.equal(isDeafProbe(healthy), false);
  assert.equal(isDeafProbe({ ...healthy, addListeners: null }), false);
  assert.equal(isDeafProbe({ ...healthy, addListeners: 0 }), true);
  assert.equal(isDeafProbe({ ...healthy, binding: false }), true);
  assert.equal(isDeafProbe({ ...healthy, helper: false }), true);
  assert.equal(isDeafProbe(null), true);
});

async function setup(probes) {
  const manager = new WhatsappManager();
  const created = {};
  manager._createClient = (connectionId) => {
    const entry = manager._getEntry(connectionId);
    created[connectionId] = (created[connectionId] || 0) + 1;
    entry.client = {
      initialize: async () => {},
      destroy: async () => {},
      getState: async () => 'CONNECTED',
      info: { wid: { _serialized: 'x@c.us' } },
      pupPage: { evaluate: async () => probes[connectionId](), on() {}, once() {} },
      pupBrowser: { once() {} },
    };
  };
  for (const id of Object.keys(probes)) {
    await manager.startFor(id, { companyId: 'c1', clientId: `cl-${id}`, sessionPath: '/tmp/wa' }, { log: silentLog });
    manager._getEntry(id).state.phase = 'ready';
  }
  return { manager, created };
}

test('client tuli dibuat ulang setelah dua probe gagal; nomor lain tidak disentuh', async () => {
  mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  try {
    const { manager, created } = await setup({
      deaf: () => ({ ...healthy, addListeners: 0 }),
      ok: () => healthy,
    });
    mock.timers.tick(60_000);
    for (let i = 0; i < 40; i += 1) await Promise.resolve();
    assert.equal(created.deaf, 1, 'probe pertama belum cukup');
    mock.timers.tick(60_000);
    for (let i = 0; i < 60; i += 1) await Promise.resolve();
    assert.equal(created.deaf, 2, 'client tuli dibuat ulang');
    assert.equal(created.ok, 1, 'client sehat tidak disentuh');
    await manager.destroyAll();
  } finally {
    mock.timers.reset();
  }
});
