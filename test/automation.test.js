'use strict';

/**
 * Aturan otomasi: validasi masukan (model bisa salah), pencocokan kata utuh,
 * jeda ulang, dan jaminan bahwa kegagalan satu aksi tidak menggagalkan yang
 * lain atau pesan masuk.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const automation = require('../src/automation');

const STAGES = ['cold', 'warm', 'hot', 'closing', 'lost', 'on_hold'];
const BUDI = { id: 'u-budi', displayName: 'Pak Budi', email: 'budi@x.test', role: 'agent', status: 'active' };
const GONE = { id: 'u-gone', displayName: 'Mantan', email: 'm@x.test', role: 'agent', status: 'removed' };
const ctx = { stages: STAGES, members: [BUDI, GONE] };
const base = { name: 'Grosir ke Pak Budi', trigger: { type: 'keyword', words: ['Grosir'] }, actions: [{ type: 'assign_to_user', userId: 'u-budi' }] };

test('normalizeRule: merapikan masukan, memberi bawaan, dan menolak yang tidak sah dengan kalimat', () => {
  const rule = automation.normalizeRule({ ...base, trigger: { type: 'keyword', words: ['  Harga GROSIR ', 'harga grosir', 'reseller'] } }, ctx);
  assert.deepEqual(rule.trigger, { type: 'keyword', words: ['harga grosir', 'reseller'] });
  assert.deepEqual(rule.actions, [{ type: 'assign_to_user', userId: 'u-budi', priority: 'normal' }]);
  assert.equal(rule.cooldownHours, 24);

  const bad = (patch, pattern) => assert.throws(() => automation.normalizeRule({ ...base, ...patch }, ctx), pattern);
  bad({ name: 'x' }, /Beri nama/);
  bad({ trigger: { type: 'schedule' } }, /Pemicu harus/);
  bad({ trigger: { type: 'keyword', words: [] } }, /minimal satu kata/);
  bad({ trigger: { type: 'keyword', words: ['ya'] } }, /terlalu pendek/);
  bad({ trigger: { type: 'keyword', words: Array.from({ length: 11 }, (_, i) => `kata${i}x`) } }, /Maksimal 10 kata/);
  bad({ actions: [] }, /minimal satu aksi/);
  bad({ actions: [{ type: 'send_message', text: 'halo' }] }, /jenis harus salah satu/);
  bad({ actions: [{ type: 'assign_to_user', userId: 'u-gone' }] }, /userId tidak dikenal.*u-budi/);
  bad({ actions: [{ type: 'set_pipeline_stage', stage: 'vip' }] }, /stage harus salah satu/);
  bad({ actions: [{ type: 'notify_team', message: 'aaa' }, { type: 'notify_team', message: 'bbb' }] }, /dipakai dua kali/);
  bad({ cooldownHours: 9999 }, /0 sampai 720/);
});

test('kata dicocokkan utuh, tanpa peduli huruf besar dan tanda baca; frasa dan new_chat', () => {
  const kw = (...words) => ({ type: 'keyword', words });
  assert.ok(automation.matchesTrigger(kw('grosir'), { body: 'Kak, harga GROSIR berapa?' }));
  assert.ok(automation.matchesTrigger(kw('grosir'), { body: 'grosir.' }));
  assert.ok(!automation.matchesTrigger(kw('grosir'), { body: 'beli grosiran' }), 'bukan potongan kata');
  assert.ok(!automation.matchesTrigger(kw('grosir'), { body: 'agrosir' }));
  assert.ok(automation.matchesTrigger(kw('mau order', 'komplain'), { body: 'Saya  mau\norder 2' }), 'spasi dan baris baru dirapikan');
  assert.ok(!automation.matchesTrigger(kw('grosir'), { body: null }));
  assert.ok(automation.matchesTrigger({ type: 'new_chat' }, { isNewChat: true }));
  assert.ok(!automation.matchesTrigger({ type: 'new_chat' }, { isNewChat: false }));
  // Karakter regex di kata tidak merusak pencocokan.
  assert.ok(automation.matchesTrigger(kw('c++ (promo)'), { body: 'ada c++ (promo) ga' }));
});

function fakeDeps({ rules, failStage = false, routing = { mode: 'ai' } } = {}) {
  const calls = [];
  const claimed = new Set();
  const database = {
    async listAutomationRules() { return rules; },
    async claimAutomationRun(ruleId, companyId, chatId) {
      const key = `${ruleId}|${chatId}`;
      if (claimed.has(key)) return null;
      claimed.add(key);
      return { id: claimed.size };
    },
    async finishAutomationRun(id, results) { calls.push(['finish', id, results]); },
    async setPipelineStage(...args) { if (failStage) throw new Error('db down'); calls.push(['stage', ...args]); },
    async notifySupervisorsAbout(...args) { calls.push(['notify', ...args]); },
  };
  return {
    calls,
    deps: {
      database,
      getRouting: async () => routing,
      saveRouting: async (change, companyId) => { calls.push(['route', change, companyId]); },
      log: { warn() {} },
    },
  };
}

const rule = (patch) => ({ id: 'r1', name: 'Grosir', enabled: true, cooldownHours: 24, trigger: { type: 'keyword', words: ['grosir'] }, actions: [], ...patch });

test('runForInbound: hanya aturan aktif yang cocok, sekali per chat dalam masa jeda, tiga aksi berjalan', async () => {
  const { deps, calls } = fakeDeps({
    rules: [
      rule({ actions: [{ type: 'set_pipeline_stage', stage: 'hot' }, { type: 'notify_team', message: 'Ada calon grosir' }, { type: 'assign_to_user', userId: 'u-budi', priority: 'high' }] }),
      rule({ id: 'r2', enabled: false, actions: [{ type: 'notify_team', message: 'mati' }] }),
      rule({ id: 'r3', trigger: { type: 'keyword', words: ['komplain'] }, actions: [{ type: 'notify_team', message: 'tak cocok' }] }),
    ],
  });
  const event = { companyId: 'c1', chatId: '62811@c.us', body: 'harga grosir?', isNewChat: false };
  const first = await automation.runForInbound(event, deps);
  assert.deepEqual(first.map((r) => r.ruleId), ['r1']);
  assert.deepEqual(calls.filter(([k]) => k !== 'finish').map(([k]) => k), ['stage', 'notify', 'route']);
  const route = calls.find(([k]) => k === 'route')[1];
  assert.deepEqual(
    { mode: route.mode, assigneeUserId: route.assigneeUserId, priority: route.priority, note: route.note },
    { mode: 'human', assigneeUserId: 'u-budi', priority: 'high', note: 'Otomasi: Grosir' },
  );
  assert.deepEqual(calls.find(([k]) => k === 'notify')[1], { chatId: '62811@c.us', body: 'Grosir: Ada calon grosir' });

  const again = await automation.runForInbound(event, deps);
  assert.deepEqual(again, [], 'masa jeda: chat yang sama tidak memicu dua kali');
  const other = await automation.runForInbound({ ...event, chatId: '62899@c.us' }, deps);
  assert.equal(other.length, 1, 'chat lain tetap terpicu');
});

test('aksi yang gagal tidak menggagalkan aksi lain; chat yang sudah dipegang orang tidak dirampas', async () => {
  const failing = fakeDeps({ failStage: true, rules: [rule({ actions: [{ type: 'set_pipeline_stage', stage: 'hot' }, { type: 'notify_team', message: 'tetap jalan' }] })] });
  const [ran] = await automation.runForInbound({ companyId: 'c1', chatId: 'x@c.us', body: 'grosir' }, failing.deps);
  assert.deepEqual(ran.results.map((r) => [r.type, r.ok]), [['set_pipeline_stage', false], ['notify_team', true]]);
  assert.match(ran.results[0].error, /db down/);

  const held = fakeDeps({ routing: { mode: 'human', assigneeUserId: 'u-lain' }, rules: [rule({ actions: [{ type: 'assign_to_user', userId: 'u-budi' }] })] });
  const [skipped] = await automation.runForInbound({ companyId: 'c1', chatId: 'x@c.us', body: 'grosir' }, held.deps);
  assert.equal(skipped.results[0].skipped, 'sudah dipegang');
  assert.equal(held.calls.some(([k]) => k === 'route'), false);
});

test('runForInbound tidak pernah melempar, walau database rusak', async () => {
  const log = { warn() {} };
  assert.deepEqual(await automation.runForInbound({ companyId: 'c', chatId: 'x', body: 'grosir' }, { database: { async listAutomationRules() { throw new Error('mati'); } }, log }), []);
  assert.deepEqual(await automation.runForInbound({ companyId: 'c', chatId: 'x', body: 'grosir' }, { database: {}, log }), []);
});

test('describeRule: satu kalimat yang menyebut pemicu, aksi, dan siapa yang memegang chat', () => {
  const text = automation.describeRule(automation.normalizeRule({
    ...base, actions: [{ type: 'set_pipeline_stage', stage: 'hot' }, { type: 'assign_to_user', userId: 'u-budi', priority: 'high' }],
  }, ctx), [BUDI]);
  assert.equal(text, 'Pesan customer memuat "grosir" → pindahkan ke tahap Hot, lalu serahkan chat ke Pak Budi (prioritas tinggi), paling sering sekali per 24 jam per chat.');
});
