'use strict';

/**
 * Katalog setelan yang boleh diusulkan asisten Latih AI.
 *
 * Satu entri = satu setelan yang sudah punya layar dan rute sendiri di Agnee.
 * Asisten tidak menyimpan apa pun: usulannya membawa permintaan HTTP ke rute
 * biasa itu, dan layar menjalankannya dengan sesi pemilik saat ia menekan
 * Terapkan. Jadi peran, plafon paket, validasi, dan jejak audit di rute itu
 * tetap berlaku tanpa disalin ke sini.
 *
 * Menambah setelan baru = menambah satu entri. Alat asisten, prompt, dan kartu
 * usulan tidak perlu diubah.
 *
 * Yang sengaja TIDAK ada di katalog: rekening dan link pembayaran, kunci
 * integrasi, anggota tim, dan nomor WhatsApp. Isi lampiran dan dokumen dibaca
 * asisten sebagai data; setelan yang memindahkan uang atau akses tidak boleh
 * bisa diusulkan dari teks yang ditulis orang lain.
 */

const agentModes = require('./agent-modes');

const ON_OFF = { true: 'Nyala', false: 'Mati' };

/** [kolom katalog, kunci tahap di follow-up-stage.js, label]. */
const FOLLOW_UP_STAGE_FIELDS = [
  ['stageInquiry', 'inquiry', 'Tindak lanjut: tanya barang/harga lalu diam'],
  ['stageSummary', 'summary', 'Tindak lanjut: rincian + grand total belum dijawab'],
  ['stageProforma', 'proforma', 'Tindak lanjut: proforma belum disetujui'],
  ['stageAwaitTransfer', 'payment', 'Tindak lanjut: menunggu pembayaran'],
];

/**
 * Bentuk kolom yang dipahami `normalizeSetting`:
 * boolean | integer (min, max) | enum (values: { nilai: label }) | text (max) |
 * int_list (min, max, minItems, maxItems).
 */
const CATALOG = [
  {
    key: 'reply_delay',
    title: 'Jeda balasan',
    hint: 'Berapa detik AI menunggu sebelum membalas, supaya terasa diketik orang. Untuk permintaan "balasnya jangan kecepetan / kelamaan".',
    fields: [
      { key: 'enabled', label: 'Jeda dipakai', type: 'boolean' },
      { key: 'minSeconds', label: 'Jeda tercepat (detik)', type: 'integer', min: 0, max: 120 },
      { key: 'maxSeconds', label: 'Jeda terlama (detik)', type: 'integer', min: 1, max: 300 },
    ],
    async read({ database, companyId }) {
      const row = await database.getReplyDelaySettings?.(companyId);
      return {
        enabled: row?.replyDelayEnabled !== false,
        minSeconds: row?.replyDelayMinSeconds ?? 5,
        maxSeconds: row?.replyDelayMaxSeconds ?? 60,
      };
    },
    check(next) {
      if (next.minSeconds > next.maxSeconds) throw new Error('Jeda tercepat tidak boleh lebih lama dari jeda terlama.');
    },
    request(next) {
      return {
        method: 'PATCH', path: '/v1/admin/company',
        body: { replyDelayEnabled: next.enabled, replyDelayMinSeconds: next.minSeconds, replyDelayMaxSeconds: next.maxSeconds },
      };
    },
  },
  {
    key: 'number_rotation',
    title: 'Rotasi nomor',
    hint: 'Chat baru dibagi bergiliran ke beberapa nomor WhatsApp milik company. Hanya berarti bila nomornya lebih dari satu.',
    fields: [{ key: 'enabled', label: 'Rotasi nomor', type: 'boolean' }],
    async read({ database, companyId }) {
      const config = await database.getCompanyConfig?.(companyId);
      return { enabled: config?.rotationEnabled !== false };
    },
    request(next) {
      return { method: 'PATCH', path: '/v1/admin/company', body: { rotationEnabled: next.enabled } };
    },
  },
  {
    key: 'ai_identity',
    title: 'Identitas AI',
    hint: 'AI mengaku anggota tim (pakai nama manusia) atau terang-terangan sebagai chatbot/asisten virtual.',
    fields: [{ key: 'identity', label: 'AI tampil sebagai', type: 'enum', values: { team_member: 'Anggota tim', chatbot: 'Chatbot / asisten virtual' } }],
    async read({ database, companyId }) {
      const settings = await database.getAiSettings?.(companyId);
      return { identity: settings?.identity === 'chatbot' ? 'chatbot' : 'team_member' };
    },
    request(next) {
      return { method: 'PATCH', path: '/v1/admin/ai-settings', body: { identity: next.identity } };
    },
  },
  {
    key: 'ai_replies',
    title: 'AI membalas customer',
    hint: 'Saklar utama: mematikan berarti AI berhenti membalas SEMUA chat customer sampai dinyalakan lagi.',
    risk: 'high',
    fields: [{ key: 'enabled', label: 'AI membalas otomatis', type: 'boolean' }],
    async read({ database, companyId }) {
      const settings = await database.getAiSettings?.(companyId);
      return { enabled: settings?.enabled !== false };
    },
    request(next) {
      return { method: 'PATCH', path: '/v1/admin/ai-settings', body: { enabled: next.enabled } };
    },
  },
  {
    key: 'follow_up',
    title: 'Follow-up otomatis',
    hint: 'AI menyapa ulang customer yang berhenti membalas, sesuai posisinya di funnel (tanya harga, rincian terkirim, proforma, menunggu pembayaran); berhenti sendiri saat customer membayar, menolak, atau chat dipegang agent. Jadwal tiap tahap bawaan Agnee; dayCaps = plafon pesan per hari ke-1, ke-2, dst. (bawaan 1,1,1); jam kirim memakai zona waktu company.',
    risk: 'high',
    fields: [
      { key: 'enabled', label: 'Follow-up otomatis', type: 'boolean' },
      { key: 'dayCaps', label: 'Plafon pesan per hari (hari 1, 2, …)', type: 'int_list', min: 0, max: 10, minItems: 1, maxItems: 7 },
      { key: 'minGapMinutes', label: 'Jarak minimal antarpesan (menit)', type: 'integer', min: 30, max: 1440 },
      { key: 'sendFromHour', label: 'Mulai kirim (jam)', type: 'integer', min: 0, max: 23 },
      { key: 'sendToHour', label: 'Berhenti kirim (jam)', type: 'integer', min: 0, max: 23 },
      { key: 'restartAfterDays', label: 'Boleh mulai lagi setelah (hari, 0 = tidak pernah)', type: 'integer', min: 0, max: 90 },
      ...FOLLOW_UP_STAGE_FIELDS.map(([key, , label]) => ({ key, label, type: 'boolean' })),
    ],
    async read({ database, companyId }) {
      const row = await database.getFollowUpSettings?.(companyId);
      return {
        enabled: row?.enabled === true,
        dayCaps: row?.dayCaps || [1, 1, 1],
        minGapMinutes: row?.minGapMinutes ?? 120,
        sendFromHour: row?.sendFromHour ?? 8,
        sendToHour: row?.sendToHour ?? 21,
        restartAfterDays: row?.restartAfterDays ?? 2,
        ...Object.fromEntries(FOLLOW_UP_STAGE_FIELDS.map(([key, stage]) => [key, row?.stages?.[stage] !== false])),
      };
    },
    request(next, changed) {
      // Saklar tahap dikirim sebagai satu objek `stages`, seperti kartu Pengaturan > AI.
      const stageKeys = new Map(FOLLOW_UP_STAGE_FIELDS.map(([key, stage]) => [key, stage]));
      const body = pick(next, changed.filter((key) => !stageKeys.has(key)));
      const stages = Object.fromEntries(changed.filter((key) => stageKeys.has(key)).map((key) => [stageKeys.get(key), next[key]]));
      if (Object.keys(stages).length) body.stages = stages;
      return { method: 'PATCH', path: '/v1/follow-up/settings', body };
    },
  },
  {
    key: 'delivery_quote',
    title: 'Ongkir otomatis Lalamove',
    hint: 'AI menghitung estimasi ongkir dari titik jemput ke lokasi customer. Titik jemput (toko/gudang) dipilih pemilik di Pengaturan > Lokasi, bukan lewat obrolan.',
    fields: [{ key: 'aiQuotesEnabled', label: 'AI menghitung ongkir', type: 'boolean' }],
    async available({ database, companyId }) {
      const conn = await database.getLalamoveConnection?.(companyId);
      return conn ? null : 'Lalamove belum dihubungkan. Pemilik harus memasang kuncinya di Pengaturan > Integrasi dulu.';
    },
    async read({ database, companyId }) {
      const conn = await database.getLalamoveConnection?.(companyId);
      return { aiQuotesEnabled: conn?.aiQuotesEnabled === true };
    },
    request(next) {
      // Titik jemput tidak ikut: rute itu memakai lokasi yang sudah dipilih.
      return { method: 'PUT', path: '/v1/integrations/lalamove/ai', body: { aiQuotesEnabled: next.aiQuotesEnabled } };
    },
  },
  ...agentModes.CONFIGURABLE_MODES.map((mode) => ({
    key: `mode_guide_${mode}`,
    title: `Panduan mode ${agentModes.META[mode].label}`,
    hint: `Instruksi tambahan untuk nomor WhatsApp yang memakai mode ${agentModes.META[mode].label}: ${agentModes.META[mode].description} Teks kosong = kembali ke bawaan Agnee.`,
    fields: [{ key: 'instructions', label: 'Panduan', type: 'text', max: agentModes.INSTRUCTIONS_MAX }],
    async read({ database, companyId }) {
      const all = await database.getAgentModeInstructions?.(companyId);
      return { instructions: all?.[mode] || '' };
    },
    request(next) {
      return { method: 'PUT', path: `/v1/agent-modes/${mode}/instructions`, body: { instructions: next.instructions } };
    },
  })),
];

const BY_KEY = new Map(CATALOG.map((entry) => [entry.key, entry]));

function pick(object, keys) {
  return Object.fromEntries(keys.map((key) => [key, object[key]]));
}

function findSetting(key) {
  const entry = BY_KEY.get(String(key || '').trim());
  if (!entry) throw new Error(`Setelan "${key}" tidak ada di katalog. Pilihan: ${CATALOG.map((e) => e.key).join(', ')}.`);
  return entry;
}

/** Satu nilai masukan model → nilai sah, atau error yang bisa ia perbaiki sendiri. */
function coerceField(field, raw) {
  const at = `"${field.key}"`;
  switch (field.type) {
    case 'boolean': {
      if (typeof raw === 'boolean') return raw;
      const word = String(raw).trim().toLowerCase();
      if (['true', 'nyala', 'on', 'ya', '1'].includes(word)) return true;
      if (['false', 'mati', 'off', 'tidak', '0'].includes(word)) return false;
      throw new Error(`${at} harus true atau false.`);
    }
    case 'integer': {
      const value = typeof raw === 'number' ? raw : Number(String(raw).trim());
      if (!Number.isInteger(value)) throw new Error(`${at} harus bilangan bulat.`);
      if (value < field.min || value > field.max) throw new Error(`${at} harus antara ${field.min} dan ${field.max}.`);
      return value;
    }
    case 'enum': {
      const value = String(raw).trim();
      if (Object.hasOwn(field.values, value)) return value;
      // Model sering mengirim kata pemilik ("asisten virtual", "virtual_assistant")
      // alih-alih kodenya; terima bila katanya menunjuk tepat satu pilihan.
      const words = value.toLowerCase().split(/[^a-z0-9]+/).filter((word) => word.length >= 4);
      const scored = Object.keys(field.values).map((key) => {
        const haystack = `${key} ${field.values[key]}`.toLowerCase();
        return { key, hits: words.filter((word) => haystack.includes(word)).length };
      });
      const best = Math.max(0, ...scored.map((s) => s.hits));
      const near = best ? scored.filter((s) => s.hits === best) : [];
      if (near.length === 1) return near[0].key;
      const options = Object.entries(field.values).map(([key, label]) => `${key} (${label})`).join(', ');
      throw new Error(`${at} harus salah satu dari: ${options}.`);
    }
    case 'text': {
      if (typeof raw !== 'string') throw new Error(`${at} harus teks.`);
      if (raw.length > field.max) throw new Error(`${at} maksimal ${field.max} karakter.`);
      return raw.trim();
    }
    case 'int_list': {
      if (!Array.isArray(raw)) throw new Error(`${at} harus daftar angka, mis. [5, 3, 2].`);
      if (raw.length < field.minItems || raw.length > field.maxItems) throw new Error(`${at} berisi ${field.minItems} sampai ${field.maxItems} angka.`);
      return raw.map((item) => coerceField({ ...field, type: 'integer' }, item));
    }
    default:
      throw new Error(`Jenis kolom ${field.type} tidak dikenal.`);
  }
}

function formatValue(field, value) {
  if (field.type === 'boolean') return ON_OFF[value];
  if (field.type === 'enum') return field.values[value] || String(value);
  if (field.type === 'int_list') return value.join(', ');
  if (field.type === 'text') return value || '(kosong)';
  return String(value);
}

/**
 * Menggabungkan perubahan ke nilai sekarang. Hanya kolom yang benar-benar
 * berubah yang dihitung; usulan tanpa perubahan ditolak.
 */
function normalizeSetting(entry, current, input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('"value" harus objek berisi kolom yang diubah.');
  const known = new Map(entry.fields.map((field) => [field.key, field]));
  const unknown = Object.keys(input).filter((key) => !known.has(key));
  if (unknown.length) throw new Error(`Kolom tidak dikenal: ${unknown.join(', ')}. Kolom ${entry.key}: ${[...known.keys()].join(', ')}.`);
  const next = { ...current };
  for (const [key, raw] of Object.entries(input)) next[key] = coerceField(known.get(key), raw);
  const changed = entry.fields.map((f) => f.key).filter((key) => JSON.stringify(next[key]) !== JSON.stringify(current[key]));
  if (!changed.length) throw new Error('Tidak ada yang berubah dari setelan sekarang.');
  entry.check?.(next);
  return {
    next,
    changed,
    changes: changed.map((key) => ({
      field: key,
      label: known.get(key).label,
      before: formatValue(known.get(key), current[key]),
      after: formatValue(known.get(key), next[key]),
    })),
  };
}

/** Bentuk ringkas katalog untuk prompt dan alat baca. */
function describeCatalog() {
  return CATALOG.map((entry) => ({
    key: entry.key,
    title: entry.title,
    hint: entry.hint,
    risk: entry.risk || 'normal',
    fields: entry.fields.map(({ key, label, type, min, max, values, minItems, maxItems }) => ({
      // Nilai beserta labelnya: tanpa label, model tidak tahu "chatbot" juga berarti "asisten virtual".
      key, label, type, min, max, values, minItems, maxItems,
    })),
  }));
}

module.exports = { CATALOG, findSetting, normalizeSetting, describeCatalog, coerceField };
