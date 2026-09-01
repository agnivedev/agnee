'use strict';

function normalizeUsage(result) {
  const usage = result?.usage || {};
  const inputTokens = Number(usage.prompt_tokens) || 0;
  const outputTokens = Number(usage.completion_tokens) || 0;
  return {
    inputTokens,
    outputTokens,
    totalTokens: Number(usage.total_tokens) || inputTokens + outputTokens,
    costUsd: Number(usage.cost) || 0,
  };
}

function formatUsd(value) {
  return `$${Number(value || 0).toFixed(8)}`;
}

function styleWarnings(text, expectations = {}) {
  const value = String(text || '');
  const warnings = [];
  const wordCount = value.trim().split(/\s+/).filter(Boolean).length;
  if (wordCount > 70) warnings.push(`${wordCount} words (max 70)`);
  if (/\p{Extended_Pictographic}/u.test(value)) warnings.push('contains emoji');
  if (/(^|\n)\s*(?:[-*]|\d+[.)])\s+/m.test(value) || /\*\*/.test(value)) warnings.push('contains list/markdown');
  if ((value.match(/\?/g) || []).length > 1) warnings.push('more than one question');
  if (expectations.expectDirectHandoff && value.includes('?')) warnings.push('asks a question after explicit handoff request');
  const canned = [
    'saya memahami',
    'terima kasih atas pertanyaannya',
    'tentu saja',
    'perlu diketahui',
    'kami berkomitmen',
    'senang bisa membantu',
    'apakah ada hal lain yang bisa saya bantu',
  ];
  const found = canned.find((phrase) => value.toLowerCase().includes(phrase));
  if (found) warnings.push(`canned phrase: "${found}"`);
  return warnings;
}

module.exports = { normalizeUsage, formatUsd, styleWarnings };
