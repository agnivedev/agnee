'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const KnowledgeBase = require('../src/knowledge-loader.js');
const { TEST_MESSAGES } = require('../scripts/test-auto-reply.js');
const { normalizeUsage, formatUsd, styleWarnings } = require('../src/reply-style.js');

test('system prompt asks for natural everyday WhatsApp prose', async () => {
  const kb = new KnowledgeBase({ clientId: 'bzone' });
  await kb.load();
  const prompt = kb.getSystemPrompt();
  assert.match(prompt, /bahasa Indonesia sehari-hari/i);
  assert.match(prompt, /KONTRAK OUTPUT WHATSAPP/i);
  assert.match(prompt, /Jangan pakai heading, tabel, atau \*\*bold ganda\*\*/i);
});

test('output contract is a floor the company playbook may override', async () => {
  const kb = new KnowledgeBase({ clientId: 'tradersmastermind' });
  await kb.load();
  const prompt = kb.getSystemPrompt();
  // A funnel may require an emoji opener, a two-option list, and a checkout
  // link. The contract must permit that instead of banning it outright.
  assert.match(prompt, /Playbook perusahaan yang menentukan isi dan bentuk balasan/i);
  assert.match(prompt, /Penanda daftar seperti 1️⃣, ✅, atau 👉 boleh dipakai/i);
  assert.match(prompt, /emoji secukupnya saja/i);
  assert.match(prompt, /\*tebal\* dengan satu asterisk/i);
});

test('auto-reply scenarios follow the configured knowledge tenant', () => {
  assert.match(TEST_MESSAGES.bzone[0].text, /Bengkel EA Gold/i);
  assert.match(TEST_MESSAGES.agnee[0].text, /Agnee/i);
});

test('OpenRouter usage is normalized and formatted as USD', () => {
  const usage = normalizeUsage({ usage: {
    prompt_tokens: 1453,
    completion_tokens: 177,
    total_tokens: 1630,
    cost: 0.00081234,
  } });
  assert.deepEqual(usage, {
    inputTokens: 1453,
    outputTokens: 177,
    totalTokens: 1630,
    costUsd: 0.00081234,
  });
  assert.equal(formatUsd(usage.costUsd), '$0.00081234');
});

test('AI-ish style checker flags common slop patterns', () => {
  assert.deepEqual(styleWarnings('Bisa. Saya cek dulu ke tim ya.'), []);
  const warnings = styleWarnings('Tentu saja! **Berikut langkahnya:**\n1. Cek dulu 😊😊😊😊\n2. Coba lagi. Ada yang lain? Bisa dibantu?');
  assert.ok(warnings.includes('4 emoji (max 3)'));
  assert.ok(warnings.includes('contains markdown WhatsApp cannot render'));
  assert.ok(warnings.includes('more than one question'));
  assert.ok(warnings.some((warning) => warning.includes('tentu saja')));
  assert.deepEqual(styleWarnings('Bisa. Saya teruskan ke tim sekarang.', { expectDirectHandoff: true }), []);
  // A playbook-shaped offer reply — emoji, a numbered list of two options and a
  // plain checkout URL — is what the funnel asks for, so it must pass clean.
  assert.deepEqual(styleWarnings([
    'Halo kak 👋 Aku Anya dari tim Trader\'s Mastermind.',
    '1. Ikut free signal kami di Telegram: https://t.me/bzonesyndicate',
    '2. Recovery Package Rp99.000 sudah termasuk copy trade, ebook, signal, dan pendampingan tim: https://tradersmastermind.myr.id/pl/trading-recovery-plan-checkout',
  ].join('\n')), []);
  assert.ok(styleWarnings('Bisa. Pair yang dipakai apa?', { expectDirectHandoff: true })
    .includes('asks a question after explicit handoff request'));
});
