'use strict';

/**
 * Eskalasi model: model utama (murah) menjawab dulu; kalau penjaga menilai
 * jawabannya bermasalah, GILIRAN ITU diulang dengan model yang lebih kuat.
 * Beda dengan rantai cadangan (llm-service), yang hanya pindah model saat
 * panggilan error.
 *
 * Alasan yang bisa diperbaiki model lebih kuat: angka/klaim karangan, janji
 * kosong, hedging, bukti transfer. Alasan yang TIDAK bisa: alat tak menemukan
 * data (`tool_no_result`) — model sekuat apa pun tak punya data itu, jadi
 * tidak dieskalasi (menghemat biaya).
 */

// tool_no_result: model kuat pun tak punya datanya. empty_promise: terukur 4 Nov
// (22 giliran ESBEJE) memicu ~50% giliran dan model kuat tetap menghasilkannya
// (penjaga sudah menanganinya), jadi eskalasi hanya membuang biaya.
const NOT_FIXABLE_BY_MODEL = new Set(['tool_no_result', 'empty_promise']);

// Panggilan alat yang bocor sebagai teks ke customer (gpt-5.4-mini, 4 Nov).
const TOOL_LEAK = /\{\s*"tool"\s*:|"parameters"\s*:\s*\{|\bfunctions\.[a-z_]+\b/i;

/** Buang baris yang memuat panggilan alat mentah; `leaked` memicu eskalasi. */
function stripToolLeak(text) {
  const lines = String(text || '').split('\n');
  const kept = lines.filter((line) => !TOOL_LEAK.test(line));
  return { text: kept.join('\n').trim(), leaked: kept.length !== lines.length };
}

/**
 * @param {{ assessment?: {reasons?: Array<{code:string}>}, enforced?: {rewritten?: boolean, stripped?: boolean} }} input
 * @returns {{ escalate: boolean, why: string[] }}
 */
function shouldEscalate({ assessment, enforced, leaked = false } = {}) {
  const why = [];
  if (leaked) why.push('tool_leak');
  for (const reason of assessment?.reasons || []) {
    if (!NOT_FIXABLE_BY_MODEL.has(reason.code) && !why.includes(reason.code)) why.push(reason.code);
  }
  // Kontrak keluaran harus menulis ulang/membuang kalimat: model salah menulis.
  if (enforced?.rewritten) why.push('contract_rewritten');
  if (enforced?.stripped) why.push('contract_stripped');
  return { escalate: why.length > 0, why };
}

// Model eskalasi bawaan (riset ESBEJE 4 Nov, docs/HASIL-RISET-ESKALASI-MODEL.md).
// claude-haiku-5.5 paling sedikit masalah serius (7/50 vs gpt-5.4-mini 9/50,
// gemini-2.5-flash 10/50); gpt-5.4-mini jadi cadangan bila haiku error.
const DEFAULT_ESCALATION_CHAIN = 'anthropic/claude-haiku-5.5,openai/gpt-5.4-mini';

/**
 * Nilai AI_ESCALATION_CHAIN -> rantai yang dipakai. Tidak diset = bawaan
 * (eskalasi hidup); "off"/"none"/"false"/"" = mati; selain itu dipakai apa adanya.
 */
function chainFromEnv(value) {
  if (value === undefined || value === null) return DEFAULT_ESCALATION_CHAIN;
  return /^(?:off|none|false|0|)$/i.test(String(value).trim()) ? '' : String(value).trim();
}

/** Rantai eskalasi dari env/konfigurasi: "a/b, c/d" atau array. Tanpa model yang sama dengan utama. */
function parseChain(value) {
  const list = Array.isArray(value) ? value : String(value || '').split(',');
  return [...new Set(list.map((item) => String(item).trim()).filter(Boolean))];
}

/** Hanya model yang berbeda dari yang sudah dipakai giliran ini; kosong = tak ada eskalasi. */
function pickEscalationChain(escalationChain, usedModel) {
  return parseChain(escalationChain).filter((model) => model !== usedModel);
}

/**
 * Pilih hasil akhir: hasil eskalasi dipakai bila model kuat menghasilkan teks
 * dan jumlah masalahnya tidak lebih banyak daripada percobaan pertama.
 */
function chooseOutcome({ first, second }) {
  if (!second?.text) return 'first';
  const count = (x) => (x.why?.length || 0);
  return count(second) <= count(first) ? 'second' : 'first';
}

module.exports = { DEFAULT_ESCALATION_CHAIN, chainFromEnv, stripToolLeak, shouldEscalate, parseChain, pickEscalationChain, chooseOutcome, NOT_FIXABLE_BY_MODEL };
