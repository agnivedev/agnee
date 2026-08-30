#!/usr/bin/env node

'use strict';

const LlmService = require('../src/llm-service.js');

// Cheap & decent models for testing
const MODELS_TO_TEST = [
  // xAI (very cheap, good quality)
  'grok-2-1212',
  'grok-3-20250115',

  // Qwen (affordable)
  'qwen-qwq-32b-preview',
  'qwen-2.5-72b-instruct',

  // Llama (budget-friendly)
  'meta-llama/llama-3.2-11b-vision-instruct',
  'meta-llama/llama-3.1-8b-instruct',

  // Mistral (good price-quality)
  'mistralai/mistral-7b-instruct',

  // Claude Haiku (pricey but reference)
  'anthropic/claude-3-5-haiku',
];

async function testModels() {
  const apiKey = process.env.OPENROUTER_API_KEY;

  if (!apiKey) {
    console.error('❌ OPENROUTER_API_KEY not set in environment');
    console.log('\nSetup:');
    console.log('1. Get API key from https://openrouter.ai/settings/keys');
    console.log('2. Export it: export OPENROUTER_API_KEY="sk-or-..."');
    console.log('3. Run this script again');
    process.exit(1);
  }

  console.log('🧪 Testing OpenRouter models for Agnee auto-reply...\n');
  console.log(`API Key: ${apiKey.substring(0, 10)}...`);
  console.log(`Models to test: ${MODELS_TO_TEST.length}\n`);

  const results = await LlmService.testModels(apiKey, MODELS_TO_TEST);

  console.log('═'.repeat(80));
  console.log('RESULTS\n');

  const successful = results.filter(r => r.status === 'ok');
  const failed = results.filter(r => r.status !== 'ok');

  if (successful.length > 0) {
    console.log(`✅ Working Models (${successful.length}):\n`);
    for (const result of successful) {
      console.log(`  ${result.model}`);
      console.log(`    Reply: "${result.reply}..."`);
      console.log(`    Tokens: input=${result.tokens?.prompt_tokens || '?'}, output=${result.tokens?.completion_tokens || '?'}`);
      console.log();
    }
  }

  if (failed.length > 0) {
    console.log(`⚠️  Failed/Unavailable Models (${failed.length}):\n`);
    for (const result of failed) {
      console.log(`  ${result.model}: ${result.error}`);
    }
    console.log();
  }

  console.log('═'.repeat(80));
  console.log('\nRECOMMENDATION:\n');
  console.log('For Agnee auto-reply (cheap + good quality):');
  console.log('  1. grok-2-1212 or grok-3-20250115 (xAI) — cheapest, good quality');
  console.log('  2. qwen-2.5-72b-instruct (Alibaba) — affordable, very capable');
  console.log('  3. meta-llama/llama-3.1-8b-instruct — budget-friendly, solid');
  console.log('\nTo use in production:');
  console.log('  Set OPENROUTER_MODEL=grok-2-1212 in .env');
  console.log('  Set LLM_ENABLED=true in .env');
  console.log('  Set OPENROUTER_API_KEY=sk-or-... in .env (production: .env only, not in git)');
}

testModels().catch(err => {
  console.error('Test failed:', err.message);
  process.exit(1);
});
