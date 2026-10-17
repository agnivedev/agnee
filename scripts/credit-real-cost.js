'use strict';

/**
 * Biaya NYATA dari OpenRouter per tingkatan model untuk satu balasan otomatis
 * berukuran realistis (system prompt = playbook Beweix, ~8k token; riwayat
 * pendek). Dipakai untuk memeriksa angka COGS di docs/credit-system.md.
 *
 * Jalankan: node --env-file=/path/.env scripts/credit-real-cost.js
 * Biaya satu putaran kecil (beberapa sen USD). Tidak menulis ke database.
 */
const fs = require('node:fs');
const path = require('node:path');
const LlmService = require('../src/llm-service.js');
const { TIERS } = require('../src/model-tiers.js');

const RATE = Number(process.env.USD_IDR_RATE) || 16_500;
const dir = path.join(__dirname, '..', 'playbooks', 'beweix-digital');
const system = ['umum.md', 'beweix-ai-cgi.md', 'bewei-express.md']
  .map((f) => fs.readFileSync(path.join(dir, f), 'utf8')).join('\n\n');
const QUESTIONS = [
  'Halo kak, mau tanya layanan video AI untuk produk skincare saya, bisa?',
  'Kira-kira prosesnya gimana ya kak? Saya belum pernah pakai.',
  'Kalau untuk iklan Meta, apa bisa sekalian dibantu?',
];

(async () => {
  const rows = [];
  for (const tier of TIERS) {
    const usage = [];
    const llm = new LlmService({
      apiKey: process.env.OPENROUTER_API_KEY, model: tier.id, maxTokens: 300, enabled: true,
      onUsage: (u) => usage.push(u),
    });
    let ok = 0;
    for (const q of QUESTIONS) {
      try {
        const r = await llm.generateReply(q, { systemPrompt: system, modelChain: [tier.id], purpose: 'auto_reply', companyId: 'sim' });
        if (r?.text) ok += 1;
      } catch (e) { /* dicatat lewat ok */ }
    }
    const costs = usage.map((u) => Number(u.usage?.cost) || 0);
    const avg = costs.length ? costs.reduce((a, b) => a + b, 0) / costs.length : 0;
    const inTok = usage.length ? usage.reduce((a, u) => a + (u.usage?.prompt_tokens || 0), 0) / usage.length : 0;
    rows.push({ tier: tier.key, model: tier.id, ok, avgUsd: avg, avgIdr: avg * RATE, inTok: Math.round(inTok) });
    console.log(`${tier.key.padEnd(6)} ok=${ok}/${QUESTIONS.length}  masuk≈${Math.round(inTok)} tok  US$${avg.toFixed(6)}  ≈ Rp ${(avg * RATE).toFixed(1)} / balasan`);
  }
  fs.writeFileSync(path.join(__dirname, '..', 'tmp-credit-real-cost.json'), JSON.stringify(rows, null, 2));
})();
