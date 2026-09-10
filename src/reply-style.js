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

/**
 * Rule checks for the reply coach.
 *
 * These follow the same floor as the WhatsApp output contract in
 * knowledge-loader: a company playbook may legitimately ask for emoji, a short
 * numbered list of options, and a checkout link, so those are no longer
 * warnings on their own. What still is: brochure length, emoji spam, markdown
 * that WhatsApp cannot render, interrogating the customer, and canned phrases.
 */
function styleWarnings(text, expectations = {}) {
  const value = String(text || '');
  const warnings = [];
  const maxWords = Number(expectations.maxWords) || 150;
  const wordCount = value.trim().split(/\s+/).filter(Boolean).length;
  if (wordCount > maxWords) warnings.push(`${wordCount} words (max ${maxWords})`);
  // List markers a playbook may legitimately use (1️⃣ 2️⃣ ✅ ✔️ 👉 at the start of
  // a line, or 👉 introducing a link) are structure, not decoration, so they do
  // not count against the emoji budget.
  const decorative = value
    .replace(/(^|\n)\s*(?:[0-9]\uFE0F?\u20E3|[\u2705\u2714\uFE0F]+|\u{1F449})\s*/gu, '$1')
    .replace(/\u{1F449}\s*(?=https?:\/\/)/gu, '');
  const emojiCount = (decorative.match(/\p{Extended_Pictographic}/gu) || []).length;
  if (emojiCount > 3) warnings.push(`${emojiCount} emoji (max 3)`);
  // *bold* is WhatsApp's own syntax; **bold**, headings and tables are not.
  if (/(^|\n)\s*#{1,6}\s+/.test(value) || /\*\*/.test(value) || /(^|\n)\s*\|.*\|/.test(value)) {
    warnings.push('contains markdown WhatsApp cannot render');
  }
  if (/\[[^\]]+\]\(https?:\/\/[^)]+\)/.test(value)) warnings.push('markdown link instead of plain URL');
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

  const hasContext = Boolean(context && context.trim());
  const systemPrompt = `Anda adalah quality assurance untuk tim customer service.
Nilai SATU balasan CS terhadap sumber kebenaran perusahaan di bawah.

${hasContext ? context : '(SUMBER KEBENARAN KOSONG — perusahaan belum mengisi fakta apa pun)'}

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
- tone: apakah terdengar seperti manusia yang ngobrol, bukan brosur atau AI, dan sesuai persona serta format yang diminta playbook.
- missingInfo: kosongkan jika playbook sudah cukup. Isi hanya kalau balasan butuh fakta yang tidak tersedia.

suggestedReply WAJIB memenuhi semua ini (jangan menyalin gaya buruk dari balasan yang dinilai):
- Ikuti template dan format yang ada di sumber kebenaran di atas kalau situasinya diatur di sana.
- Kalau tidak diatur: 2-4 kalimat, maksimal 150 kata, gaya chat WhatsApp.
- Emoji maksimal 2-3. Daftar bernomor pendek boleh untuk pilihan atau isi paket; heading, tabel, dan bold markdown tidak boleh.
- Link ditulis sebagai URL polos, bukan format markdown.
- Salam dan perkenalan diri hanya kalau ini balasan pertama ke customer baru.
- Tanpa kalimat template: "Terima kasih atas pertanyaannya", "Saya memahami", "Tentu saja", "Apakah ada hal lain yang bisa saya bantu".
- Maksimal satu pertanyaan, dan hanya kalau perlu untuk langkah berikutnya.
- JANGAN PERNAH menulis angka, harga, persentase, nama paket, nomor rekening, atau link
  yang tidak ada di sumber kebenaran di atas. Ini termasuk angka yang muncul di
  balasan yang sedang dinilai — balasan itu justru yang diduga salah, jadi
  angkanya tidak boleh dipercaya atau diulang.
- Kalau faktanya tidak tersedia, tulis kalimat yang menjanjikan pengecekan,
  misalnya "harga paketnya saya cek dulu ke tim ya" — jangan mengisi angka apa pun.${hasContext ? '' : `

PENTING: sumber kebenaran KOSONG. Berarti TIDAK ADA satu pun fakta produk yang
boleh Anda nyatakan. accuracy maksimal 2 jika balasan menyebut fakta spesifik,
dan suggestedReply tidak boleh memuat angka atau klaim produk sama sekali.`}`;

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
