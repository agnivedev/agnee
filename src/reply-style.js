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

/**
 * Ask the model to grade a reply against THIS company's own source of truth.
 *
 * The rule checks above catch style problems (too long, emoji, canned
 * phrases). They cannot tell whether the reply is actually correct, follows
 * the sales funnel, or invented a fact — that needs a judge that can read the
 * company's playbook. Scores are 1-5 so a supervisor can see movement.
 *
 * Returns null when the LLM is unavailable or returns unusable output, so the
 * caller can still show the rule-based result on its own.
 */
async function judgeReply(llmService, { customerMessage, reply, context, transcript = [] }) {
  if (!llmService?.enabled) return null;

  const history = transcript.length
    ? transcript.map((turn) => `${turn.role === 'customer' ? 'Customer' : 'CS'}: ${turn.text}`).join('\n')
    : '(belum ada riwayat)';

  const systemPrompt = `Anda adalah quality assurance untuk tim customer service.
Nilai SATU balasan CS terhadap sumber kebenaran perusahaan di bawah.

${context || '(belum ada playbook — nilai hanya dari kaidah umum CS dan tandai accuracy rendah jika balasan mengklaim fakta spesifik)'}

Balas HANYA JSON valid, tanpa penjelasan, tanpa markdown, dengan bentuk:
{
  "scores": {
    "accuracy": 1-5,
    "helpfulness": 1-5,
    "funnel": 1-5,
    "tone": 1-5
  },
  "verdict": "pass" | "revise",
  "strengths": ["..."],
  "issues": ["..."],
  "suggestedReply": "versi perbaikan yang sudah benar DAN sudah patuh gaya",
  "missingInfo": ["fakta yang tidak ada di playbook dan perlu ditanyakan ke pemilik bisnis"]
}

Panduan penilaian:
- accuracy: apakah setiap klaim didukung playbook di atas. Mengarang harga, fitur, atau link = 1.
- helpfulness: apakah pertanyaan customer benar-benar terjawab.
- funnel: apakah balasan memajukan percakapan ke tahap berikutnya (tanya kebutuhan → tawarkan → closing) tanpa memaksa.
- tone: apakah terdengar seperti manusia yang ngobrol, bukan brosur atau AI.
- missingInfo: kosongkan jika playbook sudah cukup. Isi hanya kalau balasan butuh fakta yang tidak tersedia.

suggestedReply WAJIB memenuhi semua ini (jangan menyalin gaya buruk dari balasan yang dinilai):
- 1-3 kalimat, maksimal 70 kata, satu paragraf plain text.
- Tanpa emoji, tanpa markdown, tanpa bullet.
- Tanpa salam pembuka dan tanpa memperkenalkan diri.
- Tanpa kalimat template: "Terima kasih atas pertanyaannya", "Saya memahami", "Tentu saja", "Apakah ada hal lain yang bisa saya bantu".
- Maksimal satu pertanyaan, dan hanya kalau perlu untuk langkah berikutnya.
- Hanya memakai fakta dari playbook di atas. Kalau faktanya tidak ada, katakan akan dicek ke tim.`;

  const userPrompt = `Riwayat percakapan:
${history}

Pesan customer terakhir:
${customerMessage}

Balasan CS yang dinilai:
${reply}`;

  const result = await llmService.generateReply(userPrompt, { systemPrompt }).catch(() => null);
  if (!result?.text) return null;

  const raw = String(result.text).replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    const start = raw.indexOf('{');
    const end = raw.lastIndexOf('}');
    if (start === -1 || end <= start) return null;
    try { parsed = JSON.parse(raw.slice(start, end + 1)); } catch { return null; }
  }

  const clamp = (value) => {
    const n = Number(value);
    if (!Number.isFinite(n)) return null;
    return Math.min(5, Math.max(1, Math.round(n)));
  };
  const scores = {
    accuracy: clamp(parsed?.scores?.accuracy),
    helpfulness: clamp(parsed?.scores?.helpfulness),
    funnel: clamp(parsed?.scores?.funnel),
    tone: clamp(parsed?.scores?.tone),
  };
  const present = Object.values(scores).filter((v) => v !== null);
  if (!present.length) return null;

  const asList = (value) => (Array.isArray(value)
    ? value.filter((item) => typeof item === 'string' && item.trim()).slice(0, 6).map((item) => item.trim())
    : []);

  return {
    scores,
    overall: Math.round((present.reduce((a, b) => a + b, 0) / present.length) * 10) / 10,
    verdict: parsed?.verdict === 'pass' ? 'pass' : 'revise',
    strengths: asList(parsed?.strengths),
    issues: asList(parsed?.issues),
    suggestedReply: typeof parsed?.suggestedReply === 'string' ? parsed.suggestedReply.trim().slice(0, 1000) : '',
    missingInfo: asList(parsed?.missingInfo),
    model: result.model || null,
    usage: normalizeUsage(result),
  };
}

module.exports = { normalizeUsage, formatUsd, styleWarnings, judgeReply };
