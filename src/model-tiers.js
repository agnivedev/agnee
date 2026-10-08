'use strict';

/**
 * Pelanggan tidak boleh melihat nama model, vendornya, atau harganya. Yang
 * mereka lihat dan kirim hanya KUNCI TINGKATAN di bawah; id OpenRouter asli
 * tinggal di server ini. Urutan dan kunci harus sama dengan
 * web/src/features/settings/models.ts (label ditulis di sana).
 *
 * Konsol /superhuman memang menampilkan id asli — itu untuk platform admin,
 * jadi rutenya dikecualikan dari penyaring respons di server.js.
 */

const TIERS = [
  { key: 'low-a', id: 'mistralai/mistral-nemo', label: 'Low-end AI model A' },
  { key: 'low-b', id: 'meta-llama/llama-3.1-8b-instruct', label: 'Low-end AI model B' },
  { key: 'low-c', id: 'google/gemini-2.5-flash-lite', label: 'Low-end AI model C' },
  { key: 'mid-a', id: 'meta-llama/llama-3.3-70b-instruct', label: 'Medium-end AI model A' },
  { key: 'mid-b', id: 'openai/gpt-4o-mini', label: 'Medium-end AI model B' },
  { key: 'mid-c', id: 'qwen/qwen-2.5-72b-instruct', label: 'Medium-end AI model C' },
  { key: 'mid-d', id: 'google/gemini-2.5-flash', label: 'Medium-end AI model D' },
  { key: 'high', id: 'anthropic/claude-haiku-4.5', label: 'High-end AI model' },
  { key: 'top', id: 'anthropic/claude-sonnet-5', label: 'Top-end AI model' },
];

const CUSTOM_KEY = 'custom';
const GENERIC_LABEL = 'AI model';

function tierOfId(id) {
  if (!id) return null;
  return TIERS.find((tier) => tier.id === id || id.endsWith(`/${tier.id.split('/').pop()}`)) || null;
}

/** id asli -> kunci tingkatan; id di luar daftar jadi 'custom'. */
function keyForId(id) {
  return tierOfId(id)?.key || CUSTOM_KEY;
}

/** Label aman tampil untuk id model apa pun (dipakai penyaring respons). */
function labelForId(id) {
  return tierOfId(id)?.label || GENERIC_LABEL;
}

/**
 * Rantai tersimpan (id asli) -> kunci untuk klien.
 */
function chainToKeys(chain) {
  return (chain || []).map(keyForId);
}

/**
 * Kunci dari klien -> id asli. 'custom' berarti "id lama di luar daftar yang
 * sudah tersimpan": diisi dari rantai tersimpan sesuai urutan kemunculan,
 * supaya membuka lalu menyimpan halaman tidak menulis ulang rantainya. Kalau
 * tidak ada lagi yang bisa dipulihkan, jatuh ke model bawaan platform.
 * String yang bukan kunci dibiarkan lewat (klien lama yang masih kirim id).
 */
function keysToChain(keys, { storedChain = [], defaultModel = '' } = {}) {
  const leftovers = (storedChain || []).filter((id) => !tierOfId(id));
  if (defaultModel && !tierOfId(defaultModel)) leftovers.push(defaultModel);
  const out = [];
  for (const key of keys || []) {
    if (!key) continue;
    if (key === CUSTOM_KEY) {
      const restored = leftovers.shift();
      if (restored) out.push(restored);
      continue;
    }
    out.push(TIERS.find((tier) => tier.key === key)?.id || key);
  }
  return out;
}

/**
 * Ganti nilai "model":"..." di JSON yang sudah diserialisasi. Dipakai di
 * onSend supaya field `model` yang ikut di banyak respons (coach, playbook,
 * insight, simulasi) tidak membawa id asli ke browser pelanggan. JSON yang
 * valid menulis tanda kutip di dalam string sebagai \", jadi pola ini tidak
 * kena isi teks percakapan.
 */
function maskModelFields(json) {
  if (typeof json !== 'string' || !json.includes('"model":"')) return json;
  return json.replace(/"model":"((?:[^"\\]|\\.)*)"/g, (_all, id) => `"model":${JSON.stringify(labelForId(id))}`);
}

module.exports = { TIERS, CUSTOM_KEY, keyForId, labelForId, chainToKeys, keysToChain, maskModelFields };
