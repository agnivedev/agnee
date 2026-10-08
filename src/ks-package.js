'use strict';

/**
 * Knowledge Source (KS): paket template percakapan yang bisa dipasang ke
 * company. Satu paket berisi General Knowledge (SOP yang sama untuk semua
 * pemakai: nada, alur, larangan), skema isian Specific Knowledge (data usaha
 * pemakai: tangga penawaran, cara memesan), dan skenario simulasi.
 *
 * Modul ini murni: membaca folder, memeriksa bentuknya, dan menyusun prompt.
 * Tidak menyentuh database dan tidak memanggil model, jadi sumbernya boleh
 * folder lokal atau paket yang diunduh dari Expertz, dan bisa diuji tanpa
 * keduanya.
 */

const fs = require('node:fs');
const path = require('node:path');

const RULES = {
  // Harga berbayar menurun dari tingkat 1 ke bawah.
  paid_descending(items) {
    const paid = items.filter((item) => item.kind === 'paid');
    for (let i = 1; i < paid.length; i += 1) {
      if (paid[i].price > paid[i - 1].price) {
        return `Tingkat berbayar harus makin murah ke bawah: "${paid[i].name}" lebih mahal dari "${paid[i - 1].name}".`;
      }
    }
    return null;
  },
  // Produk gratis bersyarat paling banyak satu, dan menempati tingkat terakhir.
  free_last(items) {
    const freeAt = items.map((item, index) => (item.kind === 'free_conditional' ? index : -1)).filter((i) => i >= 0);
    if (freeAt.length > 1) return 'Produk gratis bersyarat hanya boleh satu.';
    if (freeAt.length === 1 && freeAt[0] !== items.length - 1) return 'Produk gratis bersyarat harus di tingkat terakhir.';
    return null;
  },
};

function readText(base, relative) {
  const full = path.resolve(base, relative);
  if (!full.startsWith(path.resolve(base) + path.sep)) throw new Error(`Berkas di luar folder paket: ${relative}`);
  return fs.readFileSync(full, 'utf8');
}

function readJson(base, relative) {
  try {
    return JSON.parse(readText(base, relative));
  } catch (error) {
    throw new Error(`${relative}: ${error.message}`);
  }
}

/** Membaca satu folder paket dan memastikan bentuknya benar. */
function loadPackage(dir) {
  const manifest = readJson(dir, 'ks.json');
  for (const key of ['code', 'name', 'version', 'kind', 'general', 'specific', 'simulation']) {
    if (!manifest[key]) throw new Error(`ks.json: "${key}" wajib diisi`);
  }
  if (!/^ks-[a-z0-9-]+$/.test(manifest.code)) throw new Error('ks.json: code harus berpola ks-huruf-kecil-dan-strip');
  if (!/^\d+\.\d+\.\d+$/.test(manifest.version)) throw new Error('ks.json: version harus x.y.z');
  if (!Array.isArray(manifest.general) || !manifest.general.length) throw new Error('ks.json: general harus berisi minimal satu berkas');

  const general = manifest.general.map((file) => ({
    file,
    title: path.basename(file, path.extname(file)),
    content: readText(dir, file).trim(),
  }));
  for (const doc of general) if (!doc.content) throw new Error(`${doc.file}: kosong`);

  const specificSchema = readJson(dir, manifest.specific);
  checkSchema(specificSchema);
  const simulation = readJson(dir, manifest.simulation);
  checkSimulation(simulation);
  const example = manifest.example ? readJson(dir, manifest.example) : null;
  if (example) {
    const problems = validateSpecific(specificSchema, example);
    if (problems.length) throw new Error(`Contoh isian tidak lolos skemanya: ${problems.join('; ')}`);
  }
  return { manifest, general, specificSchema, simulation, example };
}

function checkSchema(schema) {
  if (!Array.isArray(schema.categories) || !schema.categories.length) throw new Error('specific: categories wajib');
  const keys = new Set();
  for (const category of schema.categories) {
    if (!category.key || keys.has(category.key)) throw new Error(`specific: key kategori kosong atau ganda (${category.key})`);
    keys.add(category.key);
    if (!['list', 'object'].includes(category.type)) throw new Error(`specific.${category.key}: type harus list atau object`);
    for (const rule of category.rules || []) {
      if (!RULES[rule]) throw new Error(`specific.${category.key}: aturan tidak dikenal (${rule})`);
    }
    if (!Array.isArray(category.fields) || !category.fields.length) throw new Error(`specific.${category.key}: fields wajib`);
  }
}

const CHECK_TYPES = new Set([
  'offer_mentioned_by', 'offer_not_mentioned', 'offer_order_ascending',
  'no_repeat_after_refusal', 'only_known_amounts', 'ends_without_chasing', 'rubric',
]);

function checkSimulation(simulation) {
  if (!Array.isArray(simulation.scenarios) || !simulation.scenarios.length) throw new Error('simulation: scenarios wajib');
  const ids = new Set();
  for (const scenario of simulation.scenarios) {
    if (!scenario.id || ids.has(scenario.id)) throw new Error(`simulation: id skenario kosong atau ganda (${scenario.id})`);
    ids.add(scenario.id);
    if (!Array.isArray(scenario.customer) || !scenario.customer.length) throw new Error(`simulation.${scenario.id}: customer wajib`);
    for (const check of scenario.checks || []) {
      if (!CHECK_TYPES.has(check.type)) throw new Error(`simulation.${scenario.id}: jenis cek tidak dikenal (${check.type})`);
    }
  }
}

function emptyValue(value) {
  return value === undefined || value === null || (typeof value === 'string' && !value.trim());
}

function validateField(field, value, where, problems) {
  if (emptyValue(value)) return;
  const label = `${where}.${field.key}`;
  if (field.type === 'text') {
    if (typeof value !== 'string') problems.push(`${label}: harus teks`);
    else if (field.max && value.length > field.max) problems.push(`${label}: maksimal ${field.max} karakter`);
  } else if (field.type === 'money') {
    if (!Number.isInteger(value) || value < 0) problems.push(`${label}: harus bilangan bulat rupiah, 0 atau lebih`);
  } else if (field.type === 'enum') {
    if (!field.values.includes(value)) problems.push(`${label}: pilihan harus salah satu dari ${field.values.join(', ')}`);
  } else if (field.type === 'url') {
    if (typeof value !== 'string' || !/^https?:\/\/\S+$/i.test(value)) problems.push(`${label}: harus link http(s)`);
  }
}

function validateRecord(fields, record, where, problems) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) {
    problems.push(`${where}: harus berupa isian`);
    return;
  }
  for (const field of fields) {
    const value = record[field.key];
    const required = field.required
      || (field.requiredWhen && Object.entries(field.requiredWhen).every(([key, expected]) => record[key] === expected));
    if (required && emptyValue(value)) problems.push(`${where}.${field.key}: wajib diisi`);
    validateField(field, value, where, problems);
  }
}

/** Mengembalikan daftar masalah; kosong berarti isian lolos. */
function validateSpecific(schema, data) {
  const problems = [];
  for (const category of schema.categories) {
    const value = data?.[category.key];
    if (category.type === 'list') {
      if (!Array.isArray(value)) {
        problems.push(`${category.key}: harus berupa daftar`);
        continue;
      }
      if (category.min && value.length < category.min) problems.push(`${category.key}: minimal ${category.min} isi`);
      if (category.max && value.length > category.max) problems.push(`${category.key}: maksimal ${category.max} isi`);
      value.forEach((item, index) => validateRecord(category.fields, item, `${category.key}[${index + 1}]`, problems));
      if (!problems.length) {
        for (const rule of category.rules || []) {
          const message = RULES[rule](value);
          if (message) problems.push(`${category.key}: ${message}`);
        }
      }
    } else {
      validateRecord(category.fields, value, category.key, problems);
    }
  }
  return problems;
}

function rupiah(amount) {
  return `Rp ${Number(amount).toLocaleString('id-ID')}`;
}

/**
 * Bagian prompt dari paket + isian pemakai. Tingkat dinomori dari 1 supaya
 * cocok dengan bahasa di dokumen alur ("tingkat 1", "tingkat berikutnya").
 */
function compileKsPrompt(pkg, specific) {
  const { manifest, general } = pkg;
  const parts = [`## TEMPLATE PERCAKAPAN: ${manifest.name} (${manifest.code} v${manifest.version})`];
  const headings = { tone: 'Nada dan gaya bicara', flow: 'Alur percakapan', guardrails: 'Batas yang tidak boleh dilanggar' };
  for (const doc of general) parts.push(`### ${headings[doc.title] || doc.title}\n${doc.content}`);

  const offers = specific?.offers || [];
  if (offers.length) {
    const lines = offers.map((offer, index) => {
      const head = offer.kind === 'free_conditional'
        ? `Tingkat ${index + 1} (gratis bersyarat): ${offer.name}`
        : `Tingkat ${index + 1} (berbayar): ${offer.name}, ${rupiah(offer.price)}`;
      const extra = [
        offer.pitch && `Alasan cocok: ${offer.pitch}`,
        offer.condition && `Syarat: ${offer.condition}`,
        offer.how && `Cara mengambil: ${offer.how}`,
        offer.link && `Link: ${offer.link}`,
      ].filter(Boolean);
      return [head, ...extra.map((line) => `  ${line}`)].join('\n');
    });
    parts.push(`### DATA PENAWARAN USAHA INI (fakta, bukan naskah)\n${lines.join('\n')}`);
  }
  if (specific?.order?.how) parts.push(`### Cara memesan\n${specific.order.how}`);
  return parts.join('\n\n');
}

/**
 * Jumlah rupiah yang disebut di sebuah teks. Memahami "Rp 2.500.000",
 * "2,5 juta", "750rb" dan "750 ribu".
 */
function parseAmounts(text) {
  const found = [];
  const source = String(text || '');
  const unitPattern = /(\d[\d.,]*)\s*(juta|jt|ribu|rb)\b/gi;
  let withoutUnits = source;
  for (const match of source.matchAll(unitPattern)) {
    const raw = match[1];
    const unit = match[2].toLowerCase();
    const factor = unit === 'juta' || unit === 'jt' ? 1_000_000 : 1_000;
    const hasDot = raw.includes('.');
    const hasComma = raw.includes(',');
    let number;
    if (hasDot && hasComma) {
      const decimalAt = Math.max(raw.lastIndexOf('.'), raw.lastIndexOf(','));
      number = parseFloat(raw.slice(0, decimalAt).replace(/[.,]/g, '') + '.' + raw.slice(decimalAt + 1));
    } else if (hasDot || hasComma) {
      const separator = hasDot ? '.' : ',';
      const tail = raw.split(separator).pop();
      number = tail.length <= 2 ? parseFloat(raw.replace(separator, '.')) : parseFloat(raw.replace(/[.,]/g, ''));
    } else {
      number = parseFloat(raw);
    }
    if (Number.isFinite(number)) found.push(Math.round(number * factor));
    withoutUnits = withoutUnits.replace(match[0], ' ');
  }
  for (const match of withoutUnits.matchAll(/Rp\.?\s*(\d[\d.,]*)/gi)) {
    const digits = match[1].replace(/[.,]/g, '');
    if (digits) found.push(Number(digits));
  }
  return found;
}

module.exports = { loadPackage, validateSpecific, compileKsPrompt, parseAmounts, rupiah, RULES, CHECK_TYPES };
