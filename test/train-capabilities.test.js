'use strict';

/**
 * Katalog setelan Latih AI: setiap entri harus bisa dibaca, dinormalkan, dan
 * menghasilkan permintaan ke rute yang memang ada. Yang dijaga di sini adalah
 * bentuknya, supaya entri baru tidak diam-diam rusak.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { CATALOG, findSetting, normalizeSetting, coerceField } = require('../src/train-capabilities');

test('tiap entri katalog: kunci unik, kolom berjenis sah, rute /v1/, dan dibaca dari database kosong tanpa melempar', async () => {
  const keys = CATALOG.map((e) => e.key);
  assert.equal(new Set(keys).size, keys.length);
  for (const entry of CATALOG) {
    assert.ok(entry.title && entry.hint, entry.key);
    for (const field of entry.fields) assert.ok(['boolean', 'integer', 'enum', 'text', 'int_list'].includes(field.type), `${entry.key}.${field.key}`);
    const current = await entry.read({ database: {}, companyId: 'c' });
    assert.deepEqual(Object.keys(current).sort(), entry.fields.map((f) => f.key).sort(), entry.key);
    const req = entry.request(current, entry.fields.map((f) => f.key));
    assert.match(req.path, /^\/v1\//);
    assert.ok(['PATCH', 'PUT'].includes(req.method));
  }
});

test('katalog tidak memuat rekening, link pembayaran, kunci integrasi, atau anggota tim', () => {
  const blob = JSON.stringify(CATALOG.map((e) => [e.key, e.fields.map((f) => f.key), e.request({}, []).body]));
  assert.doesNotMatch(blob, /bank|payment|apiKey|apiSecret|member|password/i);
});

test('kolom: teks "nyala"/angka string diterima, di luar batas ditolak', () => {
  assert.equal(coerceField({ key: 'x', type: 'boolean' }, 'nyala'), true);
  assert.equal(coerceField({ key: 'x', type: 'integer', min: 0, max: 10 }, '7'), 7);
  const identity = { key: 'identity', type: 'enum', values: { team_member: 'Anggota tim', chatbot: 'Chatbot / asisten virtual' } };
  assert.equal(coerceField(identity, 'asisten virtual'), 'chatbot');
  assert.equal(coerceField(identity, 'virtual_assistant'), 'chatbot');
  assert.equal(coerceField(identity, 'anggota tim'), 'team_member');
  assert.throws(() => coerceField(identity, 'robot'), /team_member \(Anggota tim\), chatbot/);
  assert.throws(() => coerceField({ key: 'x', type: 'integer', min: 0, max: 10 }, 7.5), /bulat/);
  assert.deepEqual(coerceField({ key: 'x', type: 'int_list', min: 0, max: 10, minItems: 1, maxItems: 7 }, [3, '2']), [3, 2]);
  assert.throws(() => coerceField({ key: 'x', type: 'int_list', min: 0, max: 10, minItems: 1, maxItems: 7 }, [11]), /antara 0 dan 10/);
});

test('follow-up: saklar tahap dikirim sebagai objek stages', async () => {
  const entry = findSetting('follow_up');
  const current = await entry.read({ database: { getFollowUpSettings: async () => ({ enabled: true, stages: { inquiry: false } }) }, companyId: 'c' });
  assert.equal(current.stageInquiry, false);
  assert.equal(current.stageAwaitTransfer, true);
  const { next, changed } = normalizeSetting(entry, current, { stageAwaitTransfer: false, stageInquiry: true });
  assert.deepEqual(entry.request(next, changed).body, { stages: { inquiry: true, payment: false } });
});

test('follow-up: hanya kolom yang berubah dikirim; nilai lama tampil untuk dibandingkan', async () => {
  const entry = findSetting('follow_up');
  const current = await entry.read({ database: {}, companyId: 'c' });
  const { next, changed, changes } = normalizeSetting(entry, current, { enabled: true, dayCaps: [2, 1] });
  assert.deepEqual(changed, ['enabled', 'dayCaps']);
  assert.deepEqual(entry.request(next, changed), { method: 'PATCH', path: '/v1/follow-up/settings', body: { enabled: true, dayCaps: [2, 1] } });
  assert.deepEqual(changes.map((c) => [c.before, c.after]), [['Mati', 'Nyala'], ['1, 1, 1', '2, 1']]);
});
