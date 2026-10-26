const test = require('node:test');
const assert = require('node:assert/strict');
const { WhatsappManager, maskCompanyName } = require('../src/whatsapp-manager');

test('maskCompanyName menyamarkan tiap kata', () => {
  assert.equal(maskCompanyName('Beweix Digital'), 'Be*** Di***');
  assert.equal(maskCompanyName('AL Gold FX'), 'A*** Go*** F***');
  assert.equal(maskCompanyName(''), '***');
});

test('nomor ganda di company lain ditolak dengan pesan bertopeng', async () => {
  const manager = new WhatsappManager();
  const entry = manager._getEntry('conn-1', 'co-1');
  let loggedOut = false;
  entry.client = { logout: async () => { loggedOut = true; }, destroy: async () => {} };
  const statuses = [];
  manager._markReady('conn-1', '6281@c.us', null, async (...a) => { statuses.push(a); },
    async () => ({ companyName: 'Citilux Indonesia', connectionId: 'conn-9' }));
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(loggedOut, true);
  assert.equal(entry.state.phase, 'error');
  assert.match(entry.state.lastError, /Ci\*\*\* In\*\*\*/);
  assert.doesNotMatch(entry.state.lastError, /Citilux/);
  assert.equal(statuses[0][1], 'disconnected');
});

test('tanpa duplikat nomor menjadi ready', async () => {
  const manager = new WhatsappManager();
  const entry = manager._getEntry('conn-2', 'co-2');
  manager._markReady('conn-2', '6282@c.us', null, async () => {}, async () => null);
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(entry.state.phase, 'ready');
});
