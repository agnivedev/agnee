'use strict';

/**
 * "Kalau tidak yakin, jangan menebak."
 *
 * Penjaga harga dan rekening (price-guard, account-guard) membuang ANGKA yang
 * dikarang. Yang belum tertutup: kalimat yang bukan angka tapi sama
 * berbahayanya — "stok ready", "transfer sudah masuk", "sampai besok",
 * "diskon 10%" — dan balasan yang mengambang ("sepertinya sekitar segitu")
 * atau alat yang gagal lalu model menutupinya dengan tebakan.
 *
 * Keputusan "yakin atau tidak" TIDAK diminta dari model (ia menilai dirinya
 * terlalu percaya diri). Ia dibaca dari sinyal yang bisa diperiksa kode:
 *   - harga/rekening yang dikarang (sumber sama dengan penjaga harga),
 *   - klaim stok, pembayaran, waktu kirim, diskon yang tak ada di prompt atau
 *     hasil alat giliran itu,
 *   - customer mengaku sudah transfer tetapi tak ada bukti yang diperiksa,
 *   - alat cek_harga/cek_ongkir/cek_alamat tidak menemukan apa-apa,
 *   - model sendiri berhedging di kalimat tentang uang/stok/kirim.
 *
 * Modul ini murni (tanpa I/O): menilai, memilih tindakan, menyusun kalimat.
 * Menjalankan tindakannya (bertanya ke departemen, menyerahkan chat) urusan
 * server.js, supaya balasan sungguhan dan simulator memakai penilaian yang
 * sama persis.
 */

const { findInventedPrices } = require('./price-guard');
const { findInventedAccounts } = require('./account-guard');

const MODES = ['off', 'on', 'handoff'];

/** Topik berisiko -> label untuk supervisor (bukan untuk customer). */
const TOPIC_LABELS = {
  harga: 'Harga/produk',
  stok: 'Stok',
  ongkir: 'Ongkir/alamat',
  transfer: 'Transfer/pembayaran',
  waktu_kirim: 'Janji waktu kirim',
  diskon: 'Diskon/promo',
  order: 'Pesanan',
};

const REASON_LABELS = {
  invented_price: 'Menyebut harga yang tak ada sumbernya',
  invented_account: 'Menyebut nomor rekening/telepon yang tak ada sumbernya',
  stock_claim: 'Menjanjikan stok tanpa data stok',
  payment_claim: 'Menyatakan pembayaran sudah masuk tanpa konfirmasi',
  transfer_claim_unverified: 'Customer mengaku sudah transfer, belum ada bukti yang diperiksa',
  delivery_promise: 'Menjanjikan waktu kirim yang tak ada sumbernya',
  discount_claim: 'Menyebut diskon/promo yang tak ada di pengetahuan',
  tool_no_result: 'Alat pencarian tidak menemukan hasil',
  hedge: 'Balasan memakai bahasa menebak tentang uang/stok/kirim',
};

// ── Topik dari pesan customer ───────────────────────────────────────────────

const CUSTOMER_TOPICS = [
  ['ongkir', /\b(ongkir|ongkos\s+kirim|biaya\s+(?:kirim|pengiriman|antar)|kirim\s+ke|dikirim\s+ke|lalamove|shipping|delivery\s+fee)\b/i],
  ['transfer', /\b(transfer|tf|bayar|pembayaran|bukti\s+(?:transfer|bayar)|rekening|lunas|dp|payment|paid)\b/i],
  ['stok', /\b(stok|stock|ready|tersedia|masih\s+ada|ada\s+(?:tidak|gak|ga|nggak)|kosong|available)\b/i],
  ['waktu_kirim', /\b(kapan\s+(?:sampai|tiba|dikirim|datang)|berapa\s+lama|estimasi|sampai\s+(?:kapan|besok|hari\s+ini)|how\s+long|arrive)\b/i],
  ['diskon', /\b(diskon|potongan|promo|nego|bonus|discount)\b/i],
  ['harga', /\b(harga|berapa|price|how\s+much)\b|\bRp\b/i],
  ['order', /\b(pesan|order|beli|checkout|invoice|proforma|po)\b/i],
];

function detectTopics(text) {
  const value = String(text || '');
  return CUSTOMER_TOPICS.filter(([, pattern]) => pattern.test(value)).map(([topic]) => topic);
}

const TRANSFER_CLAIM = /\b(?:sudah|udah|telah|barusan|baru\s+saja|tadi)\s+(?:di\s*)?(?:transfer|tf|bayar|lunas|kirim\s+(?:uang|dana|bukti))|\b(?:transfer|tf|pembayaran)(?:nya|an)?\s+(?:sudah|udah)\b|\bsudah\s+(?:saya|aku|kami)\s+(?:transfer|bayar)|\bi(?:'ve|\s+have)\s+(?:paid|transferred)\b/i;

/** Customer mengaku sudah membayar. */
function claimsTransfer(text) { return TRANSFER_CLAIM.test(String(text || '')); }

const PROOF_MARKER = /\[Pemeriksaan bukti transfer/i;

// ── Kalimat ─────────────────────────────────────────────────────────────────

function splitSentences(text) {
  return String(text || '')
    .split(/(?<=[.!?])\s+|\n+/)
    .map((part) => part.trim())
    .filter(Boolean);
}

const RISK_WORDS = /\b(?:harga|rp|stok|stock|ready|tersedia|ongkir|ongkos|kirim|dikirim|pengiriman|transfer|bayar|pembayaran|rekening|diskon|potongan|promo|lunas|sampai|tiba|estimasi|total)\w*/i;

/** Pola klaim per kalimat: [kode, topik, regex, butuh topik customer?]. */
const CLAIM_RULES = [
  ['stock_claim', 'stok',
    /\b(?:stok(?:nya)?\s+(?:masih\s+)?(?:ready|ada|tersedia|aman|banyak|cukup|kosong|habis)|(?:ready|tersedia)\s+(?:stok|kak|ya|nih)|barang(?:nya)?\s+(?:masih\s+)?(?:ready|ada|tersedia|kosong|habis)|masih\s+(?:ada|tersedia)|(?:sedang|lagi)\s+(?:kosong|habis)|in\s+stock|out\s+of\s+stock)\b/i, true],
  ['payment_claim', 'transfer',
    /\b(?:(?:pembayaran|transfer(?:an)?|dana|uang)(?:nya)?(?:\s+(?:kakak|kak|anda))?\s+(?:sudah\s+|telah\s+)?(?:kami\s+|saya\s+)?(?:terima|diterima|masuk|terkonfirmasi|lunas|berhasil|valid)|sudah\s+(?:kami\s+|saya\s+)?(?:terima|lunas)|(?:sudah|telah)\s+(?:masuk|lunas|terbayar)|status\s+lunas|payment\s+(?:received|confirmed))\b/i, false],
  ['delivery_promise', 'waktu_kirim',
    /\b(?:sampai|tiba|dikirim(?:kan)?|diantar|diterima|pengiriman)\b[^.!?\n]{0,30}?\b(hari\s+ini|besok|lusa|\d+\s*(?:-\s*\d+\s*)?(?:jam|hari|menit))\b|\bestimasi\b[^.!?\n]{0,30}?\b(\d+\s*(?:-\s*\d+\s*)?(?:jam|hari|menit)|besok|hari\s+ini)\b|\b(\d+\s*(?:jam|menit))\s+(?:sampai|tiba|lagi)\b/i, false],
  ['discount_claim', 'diskon',
    /\b(?:diskon|potongan(?:\s+harga)?|gratis\s+ongkir|free\s+ongkir|bonus|cashback)\b|\b\d+(?:[.,]\d+)?\s*%\s*(?:off|diskon|potongan)\b/i, false],
];

const HEDGE = /\b(sepertinya|kayaknya|kelihatannya|kira-kira|kemungkinan|mungkin|biasanya|seingat\s+(?:saya|aku)|setahu\s+(?:saya|aku)|perkiraan\s+(?:saya|aku)|saya\s+rasa|rasanya|probably|i\s+think|i\s+guess)\b/i;

function topicOfSentence(sentence) {
  if (/ongkir|ongkos|kirim|pengiriman|antar/i.test(sentence) && !/transfer|bayar/i.test(sentence)) return 'ongkir';
  if (/transfer|bayar|pembayaran|rekening|lunas/i.test(sentence)) return 'transfer';
  if (/stok|stock|ready|tersedia/i.test(sentence)) return 'stok';
  if (/diskon|potongan|promo/i.test(sentence)) return 'diskon';
  return 'harga';
}

/** Teks di `source` dalam jarak 60 huruf dari kata bertopik yang sama dengan `token`. */
function groundedNear(source, token, nearPattern) {
  const hay = String(source || '').toLowerCase();
  const needle = String(token || '').toLowerCase().replace(/\s+/g, ' ');
  if (!needle) return false;
  let from = 0;
  for (;;) {
    const at = hay.indexOf(needle, from);
    if (at < 0) return false;
    if (nearPattern.test(hay.slice(Math.max(0, at - 60), at + needle.length + 60))) return true;
    from = at + needle.length;
  }
}

// ── Hasil alat ──────────────────────────────────────────────────────────────

const NO_RESULT = new Set(['tidak_ketemu', 'gagal', 'lokasi_tidak_terbaca', 'jalan_ambigu', 'kueri_kosong']);

/** Hasil alat (JSON per panggilan) yang tidak menemukan apa-apa. */
function toolFailures(toolOutputs = []) {
  const out = [];
  for (const raw of toolOutputs || []) {
    let parsed = null;
    try { parsed = JSON.parse(raw); } catch { continue; }
    if (!parsed || typeof parsed !== 'object' || !NO_RESULT.has(parsed.status)) continue;
    const note = String(parsed.pesan || '');
    if (/daftar harga|barang/i.test(note)) out.push({ status: parsed.status, topic: 'harga', missing: parsed.status === 'kueri_kosong' });
    else if (/alamat|kota|kecamatan|lokasi/i.test(note)) out.push({ status: parsed.status, topic: 'ongkir', missing: true });
    else if (/ongkir|lalamove|kendaraan/i.test(note)) out.push({ status: parsed.status, topic: 'ongkir', missing: false });
  }
  return out;
}

// ── Penilaian ───────────────────────────────────────────────────────────────

/**
 * @param {object} input
 * @param {string} input.customerText   pesan customer giliran ini
 * @param {string} [input.rawText]      keluaran mentah model (sebelum kontrak)
 * @param {string} [input.finalText]    balasan setelah kontrak ('' bila dibuang)
 * @param {string} [input.priceSource]  prompt + hasil alat + kata customer (sumber penjaga harga)
 * @param {string} [input.factSource]   prompt + hasil alat saja (tanpa kata customer)
 * @param {string} [input.toolText]     hasil alat saja
 * @param {string[]} [input.toolOutputs]
 * @param {string} [input.quantityText]
 * @param {boolean} [input.departmentAsked]
 * @returns {{ unsure: boolean, topic: string|null, topics: string[], missingInfo: boolean, reasons: {code:string, topic:string, sentence?:string}[] }}
 */
function assess({
  customerText = '', rawText = '', finalText = '', priceSource = '', factSource = '', toolText = '',
  toolOutputs = [], quantityText = '', departmentAsked = false,
} = {}) {
  const reasons = [];
  const add = (code, topic, sentence) => {
    if (!reasons.some((r) => r.code === code && r.sentence === sentence)) reasons.push({ code, topic, ...(sentence ? { sentence } : {}) });
  };
  const customerTopics = detectTopics(customerText);
  const reply = String(finalText || '');
  const raw = String(rawText || reply);

  // 1. Angka yang dikarang (dinilai pada keluaran mentah: kontrak sudah membuangnya dari final).
  if (priceSource) {
    for (const hit of findInventedPrices(raw, priceSource, { quantityText })) {
      add('invented_price', /ongkir|ongkos|kirim/i.test(hit.sentence) ? 'ongkir' : 'harga', hit.sentence);
    }
    for (const hit of findInventedAccounts(raw, priceSource)) add('invented_account', 'transfer', hit.sentence);
  }

  // 2. Klaim bertopik yang tak ada sumbernya.
  for (const sentence of splitSentences(reply)) {
    for (const [code, topic, pattern, needsCustomerTopic] of CLAIM_RULES) {
      const m = pattern.exec(sentence);
      if (!m) continue;
      if (needsCustomerTopic && !customerTopics.includes(topic)) continue;
      if (code === 'stock_claim' && (/stok\s*[:=]?\s*\d|\bstock\b[^.\n]{0,20}\d/i.test(factSource) || /stok|stock|tersedia/i.test(toolText))) continue;
      if (code === 'payment_claim' && /lunas|paid|sudah\s+dibayar|terbayar/i.test(toolText)) continue;
      if (code === 'delivery_promise') {
        const token = (m[1] || m[2] || m[3] || '').trim();
        if (token && groundedNear(factSource, token, /kirim|antar|sampai|tiba|estimasi|pengiriman|delivery/)) continue;
      }
      if (code === 'discount_claim') {
        const percent = /(\d+(?:[.,]\d+)?)\s*%/.exec(sentence);
        const term = /gratis\s+ongkir|free\s+ongkir|cashback|bonus|diskon|potongan/i.exec(sentence)?.[0];
        if (percent ? factSource.includes(`${percent[1]}%`) || factSource.includes(`${percent[1]} %`) : (term && new RegExp(term.replace(/\s+/g, '\\s+'), 'i').test(factSource))) continue;
      }
      add(code, topic, sentence);
      break;
    }
  }

  // 3. Customer mengaku sudah transfer tetapi tak ada bukti yang diperiksa.
  if (claimsTransfer(customerText) && !PROOF_MARKER.test(customerText) && !departmentAsked) {
    const asksProof = /\b(bukti|struk|screenshot|tangkapan)\b/i.test(reply) && !reasons.some((r) => r.code === 'payment_claim');
    if (!asksProof) add('transfer_claim_unverified', 'transfer');
  }

  // 4. Alat tidak menemukan hasil.
  let missingInfo = false;
  for (const fail of toolFailures(toolOutputs)) {
    add('tool_no_result', fail.topic, fail.status);
    if (fail.missing) missingInfo = true;
  }

  // 5. Model sendiri berhedging di kalimat berisiko.
  for (const sentence of splitSentences(reply)) {
    if (HEDGE.test(sentence) && RISK_WORDS.test(sentence)) add('hedge', topicOfSentence(sentence), sentence);
  }

  // Topik utama: yang paling berisiko dulu; sinyal tanpa topik customer ikut customer.
  const order = ['transfer', 'ongkir', 'stok', 'waktu_kirim', 'diskon', 'harga', 'order'];
  const topics = [...new Set(reasons.map((r) => r.topic))].sort((a, b) => order.indexOf(a) - order.indexOf(b));
  const topic = topics[0] || (reasons.length ? (customerTopics[0] || 'harga') : null);
  return { unsure: reasons.length > 0, topic, topics, missingInfo, reasons };
}

// ── Tindakan ────────────────────────────────────────────────────────────────

const DEPARTMENT_PATTERNS = {
  transfer: [/finance|keuangan|kasir|accounting/i],
  stok: [/gudang|warehouse|stok|inventory/i, /management|manajemen|owner|pimpinan/i],
  default: [/management|manajemen|owner|pimpinan/i, /admin|sales|penjualan/i],
};

/** Nama departemen yang tepat untuk topik, atau null. */
function pickDepartment(topic, departmentNames = []) {
  const patterns = DEPARTMENT_PATTERNS[topic] || DEPARTMENT_PATTERNS.default;
  for (const pattern of patterns) {
    const found = departmentNames.find((name) => pattern.test(name));
    if (found) return found;
  }
  return null;
}

/**
 * Tindakan sesuai konteks:
 *   ask_customer   info yang kurang ada di customer (alamat, nama barang)
 *   ask_department departemen yang tepat ada dan boleh dibangunkan (chat nyata)
 *   handoff        mode 'handoff': chat diserahkan ke manusia
 *   notify_staff   selain itu: staf diberi kartu serah-terima, AI tetap membalas
 */
function chooseAction({ topic, missingInfo = false, departmentNames = [], canAsk = false, mode = 'on', proofCheck = false, proofGiven = false }) {
  if (missingInfo) return { action: 'ask_customer' };
  const department = canAsk ? pickDepartment(topic, departmentNames) : null;
  if (department) return { action: 'ask_department', department };
  // Simulator tidak boleh membangunkan siapa pun, tetapi tetap memperlihatkan tujuannya.
  if (topic === 'transfer' && proofCheck && !proofGiven && mode !== 'handoff') return { action: 'ask_customer' };
  return { action: mode === 'handoff' ? 'handoff' : 'notify_staff' };
}

// ── Kalimat untuk customer ──────────────────────────────────────────────────

const INTRO = {
  id: {
    harga: 'Untuk harga barang ini saya belum bisa memastikan angkanya, Kak.',
    stok: 'Untuk ketersediaan stoknya saya belum bisa memastikan, Kak.',
    ongkir: 'Untuk ongkirnya saya belum bisa memastikan angkanya, Kak.',
    transfer: 'Untuk transferannya saya belum bisa memastikan sudah masuk atau belum, Kak.',
    waktu_kirim: 'Untuk estimasi waktu pengirimannya saya belum bisa memastikan, Kak.',
    diskon: 'Untuk potongan harganya saya belum bisa memastikan, Kak.',
    order: 'Untuk detail pesanannya saya belum bisa memastikan, Kak.',
  },
  en: {
    harga: "I can't confirm the price for this item yet.",
    stok: "I can't confirm the stock yet.",
    ongkir: "I can't confirm the shipping cost yet.",
    transfer: "I can't confirm yet whether your transfer has arrived.",
    waktu_kirim: "I can't confirm the delivery time yet.",
    diskon: "I can't confirm the discount yet.",
    order: "I can't confirm the order details yet.",
  },
};

const FOLLOW = {
  id: {
    ask_department: 'Saya tanyakan ke tim kami dulu, nanti saya kabari di sini begitu sudah jelas ya.',
    notify_staff: 'Saya teruskan ke tim kami untuk memastikannya, dan kakak akan dikabari di sini.',
    handoff: 'Saya teruskan percakapan ini ke tim kami, sebentar lagi akan dilanjutkan di sini.',
    ask_customer: {
      ongkir: 'Boleh dikirim lokasi atau alamat lengkap tujuan pengirimannya (nama jalan, kecamatan, kota)?',
      transfer: 'Boleh dikirim foto bukti transfernya di sini supaya bisa kami periksa?',
      default: 'Boleh disebutkan nama barang lengkap dengan ukuran atau mereknya?',
    },
  },
  en: {
    ask_department: "I'll check with our team and get back to you here as soon as it's clear.",
    notify_staff: "I'll pass this to our team to confirm, and you'll hear back here.",
    handoff: "I'm handing this conversation to our team; they'll continue here shortly.",
    ask_customer: {
      ongkir: 'Could you send the delivery location or full address (street, district, city)?',
      transfer: 'Could you send a photo of the transfer receipt here so we can check it?',
      default: 'Could you tell me the full item name with size or brand?',
    },
  },
};

const looksEnglish = (text) => /\b(?:the|how much|price|stock|shipping|do you|can i|please|hello)\b/i.test(text)
  && !/\b(?:mau|ingin|boleh|bisa|tolong|berapa|harga|kak|ada|tidak)\b/i.test(text);

/** Kalimat menunda yang digantikan oleh tindakan nyata. */
const DELAY_SENTENCE = /\b(?:pastikan|cek|konfirmasi(?:kan)?|tanyakan)\s+dulu\b|\b(?:mohon|harap|silakan)\s+(?:ditunggu|menunggu|tunggu)\b|\bnanti\s+(?:saya|aku|kami)\s+(?:info|kabari|kasih\s+tahu|hubungi)/i;

/**
 * Susun balasan akhir: bagian balasan model yang aman + pengakuan wajar +
 * langkah nyata. Kalimat yang memicu ketidakyakinan dan kalimat menunda
 * kosong dibuang; kalimat lain (sapaan, info yang sah) dipertahankan.
 */
function compose({ finalText = '', customerText = '', assessment, plan }) {
  const lang = looksEnglish(customerText) ? 'en' : 'id';
  const flagged = new Set(assessment.reasons.map((r) => r.sentence).filter(Boolean));
  const kept = splitSentences(finalText).filter((sentence) => !flagged.has(sentence) && !DELAY_SENTENCE.test(sentence));
  const topic = assessment.topic || 'harga';
  const follow = plan.action === 'ask_customer'
    ? FOLLOW[lang].ask_customer[topic === 'ongkir' ? 'ongkir' : (topic === 'transfer' ? 'transfer' : 'default')]
    : FOLLOW[lang][plan.action];
  const intro = plan.action === 'handoff' ? '' : INTRO[lang][topic] || INTRO[lang].harga;
  return [...kept, intro, follow].filter(Boolean).join('\n');
}

/** Pertanyaan ke departemen: apa yang perlu dipastikan, dengan kutipan customer. */
function departmentQuestion({ topic, customerText = '', assessment }) {
  const quote = String(customerText || '').replace(/\s+/g, ' ').trim().slice(0, 300);
  const label = (TOPIC_LABELS[topic] || 'Pertanyaan').toLowerCase();
  const lead = topic === 'transfer'
    ? `Customer menyebut sudah membayar ("${quote}"). Mohon cek apakah dananya sudah masuk dan jumlahnya sesuai.`
    : `Customer menanyakan ${label}: "${quote}". AI tidak punya datanya dan tidak mau menebak; mohon dipastikan jawabannya.`;
  const detail = assessment?.reasons?.length ? ` (Sinyal: ${assessment.reasons.map((r) => REASON_LABELS[r.code]).filter(Boolean).slice(0, 2).join('; ')}.)` : '';
  return `${lead}${detail}`;
}

module.exports = {
  MODES, TOPIC_LABELS, REASON_LABELS, PROOF_MARKER,
  detectTopics, claimsTransfer, toolFailures, assess, pickDepartment, chooseAction, compose, departmentQuestion,
};
