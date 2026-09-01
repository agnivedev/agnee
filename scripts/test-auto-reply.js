#!/usr/bin/env node
'use strict';

const KnowledgeBase = require('../src/knowledge-loader.js');
const LlmService = require('../src/llm-service.js');
const { normalizeUsage, formatUsd, styleWarnings } = require('../src/reply-style.js');

const TEST_MESSAGES = {
  bzone: [
    { label: 'Product FAQ', text: 'Bengkel EA Gold itu apa sih?' },
    { label: 'Pricing (jangan boleh ngarang angka)', text: 'Berapa harganya per bulan?' },
    { label: 'Demo request', text: 'Bisa lihat demo dulu ga?' },
    { label: 'Support/troubleshooting', text: 'EA-nya sudah dipasang tapi belum buka posisi, harus cek apa dulu?' },
    { label: 'Hard handoff trigger', text: 'Saya sudah punya strategi dan mau lanjut bulan ini, bisa bicara sama timnya?', expectDirectHandoff: true },
    { label: 'Off-topic (Agnee tidak ada di knowledge bZone)', text: 'Agnee itu sebenarnya produk apa?' },
  ],
  agnee: [
    { label: 'Product FAQ', text: 'Agnee itu apa sih?' },
    { label: 'Pricing (jangan boleh ngarang angka)', text: 'Berapa harganya per bulan?' },
    { label: 'Demo request', text: 'Bisa lihat demo dulu ga?' },
    { label: 'Support/troubleshooting', text: 'QR code-nya kok belum muncul ya?' },
    { label: 'Hard handoff trigger', text: 'Kami ada 12 cabang dan butuh proposal bulan ini, bisa bicara sama sales?', expectDirectHandoff: true },
    { label: 'Off-topic (bZone tidak ada di knowledge Agnee)', text: 'bZone EA itu masih worth it dipakai sekarang?' },
  ],
};

async function main() {
  const apiKey = process.env.OPENROUTER_API_KEY;
  const model = process.env.OPENROUTER_MODEL || 'qwen-2.5-72b-instruct';
  const clientId = process.env.KNOWLEDGE_CLIENT || 'bzone';

  if (!apiKey) {
    console.error('❌ OPENROUTER_API_KEY not set');
    process.exit(1);
  }

  console.log('🧪 Testing auto-reply pipeline (knowledge retrieval + LLM)\n');
  console.log(`Model: ${model}`);
  console.log(`Knowledge client: ${clientId}\n`);
  console.log('═'.repeat(80));

  const kb = new KnowledgeBase({ clientId });
  await kb.load();

  const llm = new LlmService({ apiKey, model, enabled: true });
  const allTests = TEST_MESSAGES[clientId] || TEST_MESSAGES.bzone;
  const filter = String(process.env.AUTO_REPLY_TEST_FILTER || '').trim().toLowerCase();
  const tests = filter
    ? allTests.filter((test) => `${test.label} ${test.text}`.toLowerCase().includes(filter))
    : allTests;
  if (tests.length === 0) throw new Error(`No auto-reply test matches AUTO_REPLY_TEST_FILTER="${filter}"`);
  const totals = { inputTokens: 0, outputTokens: 0, totalTokens: 0, costUsd: 0, successful: 0, failed: 0, stylePassed: 0, styleWarned: 0 };
  const startedAt = Date.now();

  for (const test of tests) {
    console.log(`\n📩 [${test.label}]`);
    console.log(`   Customer: "${test.text}"`);

    const relevantFaqs = kb.findRelevantFaq(test.text);
    console.log(`   Matched FAQ: ${relevantFaqs.length > 0 ? relevantFaqs.map(f => f.id).join(', ') : '(none)'}`);

    const result = await llm.generateReply(test.text, {
      systemPrompt: kb.getSystemPrompt(),
      relevantFaqs,
    });

    if (result) {
      const usage = normalizeUsage(result);
      totals.inputTokens += usage.inputTokens;
      totals.outputTokens += usage.outputTokens;
      totals.totalTokens += usage.totalTokens;
      totals.costUsd += usage.costUsd;
      totals.successful += 1;
      const warnings = styleWarnings(result.text, test);
      if (warnings.length === 0) totals.stylePassed += 1;
      else totals.styleWarned += 1;
      console.log(`   Bot: "${result.text}"`);
      console.log(`   Usage: input=${usage.inputTokens}, output=${usage.outputTokens}, total=${usage.totalTokens}, cost=${formatUsd(usage.costUsd)}`);
      console.log(`   Style: ${warnings.length === 0 ? 'PASS' : `WARN — ${warnings.join('; ')}`}`);
    } else {
      totals.failed += 1;
      console.log('   Bot: (no reply generated — error, see log above)');
    }
  }

  console.log('\n' + '═'.repeat(80));
  console.log('TOTAL USAGE');
  console.log(`Requests: ${totals.successful} successful, ${totals.failed} failed`);
  console.log(`Tokens: input=${totals.inputTokens}, output=${totals.outputTokens}, total=${totals.totalTokens}`);
  console.log(`OpenRouter cost: ${formatUsd(totals.costUsd)} USD`);
  console.log(`Style: ${totals.stylePassed} passed, ${totals.styleWarned} warned`);
  console.log(`Elapsed: ${((Date.now() - startedAt) / 1000).toFixed(1)}s`);
}

if (require.main === module) {
  main().catch(err => {
    console.error('Test failed:', err);
    process.exit(1);
  });
}

module.exports = { TEST_MESSAGES };
