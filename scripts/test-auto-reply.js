#!/usr/bin/env node
'use strict';

const KnowledgeBase = require('../src/knowledge-loader.js');
const LlmService = require('../src/llm-service.js');

const TEST_MESSAGES = [
  { label: 'Product FAQ', text: 'Agnee itu apa sih?' },
  { label: 'Pricing (jangan boleh ngarang angka)', text: 'Berapa harganya per bulan?' },
  { label: 'Demo request', text: 'Bisa lihat demo dulu ga?' },
  { label: 'Support/troubleshooting', text: 'QR code nya kok ga muncul-muncul ya' },
  { label: 'Hard handoff trigger', text: 'Kami ada 12 cabang dan butuh proposal bulan ini, boleh saya bicara sama sales?' },
  { label: 'Off-topic (bZone EA - TIDAK ADA di knowledge base)', text: 'Bang, bZone EA itu masih worth it ga buat dipakai sekarang?' },
];

async function main() {
  const apiKey = process.env.OPENROUTER_API_KEY;
  const model = process.env.OPENROUTER_MODEL || 'qwen-2.5-72b-instruct';

  if (!apiKey) {
    console.error('❌ OPENROUTER_API_KEY not set');
    process.exit(1);
  }

  console.log('🧪 Testing auto-reply pipeline (knowledge retrieval + LLM)\n');
  console.log(`Model: ${model}\n`);
  console.log('═'.repeat(80));

  const kb = new KnowledgeBase();
  await kb.load();

  const llm = new LlmService({ apiKey, model, enabled: true });

  for (const test of TEST_MESSAGES) {
    console.log(`\n📩 [${test.label}]`);
    console.log(`   Customer: "${test.text}"`);

    const relevantFaqs = kb.findRelevantFaq(test.text);
    console.log(`   Matched FAQ: ${relevantFaqs.length > 0 ? relevantFaqs.map(f => f.id).join(', ') : '(none)'}`);

    const result = await llm.generateReply(test.text, {
      systemPrompt: kb.getSystemPrompt(),
      relevantFaqs,
    });

    if (result) {
      console.log(`   Bot: "${result.text}"`);
      console.log(`   (tokens: in=${result.usage?.prompt_tokens}, out=${result.usage?.completion_tokens})`);
    } else {
      console.log('   Bot: (no reply generated — error, see log above)');
    }
  }

  console.log('\n' + '═'.repeat(80));
  console.log('Done.');
}

main().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
