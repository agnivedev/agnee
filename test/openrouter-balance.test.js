'use strict';

/**
 * 10–11 Nov 2026: saldo OpenRouter habis, semua model menolak, AI semua tenant
 * diam lebih dari sehari tanpa ada yang tahu. Pemantau kini membaca saldo,
 * mengabari saat rendah/habis, dan staf diberi tahu saat AI gagal membalas.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const costAlerts = require('../src/cost-alerts');
const handoffNotice = require('../src/handoff-notice');
const LlmService = require('../src/llm-service');

function monitor({ balance, channels, clock }) {
  return new costAlerts.CostAlertMonitor({
    database: { async listCostAlertCandidates() { return []; }, async clearCostAlerts() {}, async markCostAlertNotified() {} },
    channels,
    logger: { info() {}, warn() {} },
    rate: 16_500,
    thresholds: costAlerts.DEFAULT_THRESHOLDS_IDR,
    consoleUrl: 'https://x/superhuman',
    fetchBalance: async () => balance(),
    lowBalanceUsd: 10,
    now: () => clock.t,
  });
}

function channel() {
  const sent = [];
  return { sent, name: 'whatsapp', configured: true, async send(message) { sent.push(message); } };
}

test('galat kredit OpenRouter dikenali, galat lain tidak', () => {
  assert.ok(costAlerts.isCreditError('This request requires more credits, or fewer max_tokens.'));
  assert.ok(costAlerts.isCreditError('Prompt tokens limit exceeded: 19402 > 12474. To increase, visit https://openrouter.ai/settings/credits and add more credits'));
  assert.ok(!costAlerts.isCreditError('The operation was aborted due to timeout'));
  assert.ok(!costAlerts.isCreditError(''));
  assert.equal(costAlerts.remainingUsd({ totalCredits: 275, totalUsage: 275.19 }).toFixed(2), '-0.19');
  assert.equal(costAlerts.remainingUsd(null), null);
});

test('saldo rendah dikabari sekali per 6 jam, saldo cukup tidak', async () => {
  const clock = { t: 1_000_000 };
  const ch = channel();
  let remaining = 50;
  const m = monitor({ balance: () => ({ totalCredits: 275, totalUsage: 275 - remaining }), channels: [ch], clock });

  assert.equal((await m.checkBalance()).low, false);
  assert.equal(ch.sent.length, 0);

  remaining = -0.19;
  assert.equal((await m.checkBalance()).sent, true);
  assert.match(ch.sent[0].whatsapp, /saldo openrouter habis/i);
  assert.match(ch.sent[0].text, /openrouter\.ai\/settings\/credits/);

  clock.t += 60 * 60 * 1000;
  assert.equal((await m.checkBalance()).reason, 'cooldown');
  assert.equal(ch.sent.length, 1);

  clock.t += costAlerts.BALANCE_REMINDER_MS;
  await m.checkBalance();
  assert.equal(ch.sent.length, 2, 'pengingat setelah 6 jam');

  remaining = 100;
  await m.checkBalance();
  remaining = 3;
  await m.checkBalance();
  assert.equal(ch.sent.length, 3, 'turun lagi setelah diisi = dikabari lagi tanpa menunggu');
  assert.match(ch.sent[2].whatsapp, /menipis/);
});

test('galat kredit dari model memicu pemeriksaan langsung; galat lain diabaikan', async () => {
  const clock = { t: 5_000_000 };
  const ch = channel();
  const m = monitor({ balance: () => null, channels: [ch], clock });
  assert.equal(m.reportCreditFailure('timeout'), null);
  await m.reportCreditFailure('This request requires more credits');
  assert.equal(ch.sent.length, 1);
  assert.match(ch.sent[0].text, /Galat terakhir: This request requires more credits/);
});

test('pemeriksaan saldo ikut putaran per jam dan tidak menjatuhkannya', async () => {
  const clock = { t: 9_000_000 };
  const ch = channel();
  const m = monitor({ balance: () => { throw new Error('jaringan'); }, channels: [ch], clock });
  const out = await m.check();
  assert.equal(out.alerts, 0);
  assert.equal(ch.sent.length, 0);
});

test('pemberitahuan "AI gagal membalas" berbeda dari serah-terima biasa', () => {
  const text = handoffNotice.buildNotice({ chatId: '628123@c.us', customerText: 'kak mau tanya cat dinding putih', aiText: '', aiFailed: true });
  assert.match(text, /Perlu dibalas manual/);
  assert.match(text, /BELUM membalas/);
  assert.doesNotMatch(text, /sudah menjanjikan/);
});

test('LlmService memanggil onChainFailure saat semua model gagal', async (t) => {
  const failures = [];
  const llm = new LlmService({ apiKey: 'k', model: 'm/a', enabled: true, onChainFailure: (f) => failures.push(f) });
  const realFetch = global.fetch;
  global.fetch = async () => ({ ok: false, status: 402, async text() { return '{"error":{"message":"This request requires more credits"}}'; }, async json() { return { error: { message: 'This request requires more credits' } }; } });
  t.after(() => { global.fetch = realFetch; });
  const silence = console.error; console.error = () => {}; t.after(() => { console.error = silence; });
  const out = await llm.generateReply('halo', { purpose: 'auto_reply' });
  assert.equal(out, null);
  assert.equal(failures.length, 1);
  assert.match(failures[0].message, /credits/);
});
