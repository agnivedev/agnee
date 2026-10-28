'use strict';

/**
 * Posisi customer di funnel closing, untuk tindak lanjut otomatis.
 *
 * Tindak lanjut dulu hanya tahu "customer diam" dan menyapa dengan cara yang
 * sama apa pun yang terjadi sebelumnya: orang yang baru tanya harga, orang
 * yang sudah menerima grand total, dan orang yang tinggal transfer dikirimi
 * pesan yang sama. Modul ini membaca data yang tersimpan (rincian yang
 * terkirim, proforma/invoice DealPOS, bukti transfer, pertanyaan ke
 * departemen, pesan customer) dan memutuskan tahapnya, jadwalnya, dan kapan
 * harus berhenti. Semua angka yang boleh disebut follow-up berasal dari sini,
 * bukan dari hitungan model.
 *
 * Fungsi di sini murni (tanpa database) supaya tiap tahap bisa dites sendiri.
 */

const HOUR_MS = 60 * 60 * 1000;

/** Data funnel yang lebih tua dari ini tidak dipakai: percakapannya sudah bergeser. */
const FUNNEL_LOOKBACK_DAYS = 7;

/**
 * Jadwal per tahap, dalam jam sejak pesan terakhir KITA (awal rangkaian).
 * Pesan ke-n rangkaian paling cepat keluar di offsetsHours[n]; setelah yang
 * terakhir rangkaian habis.
 *
 * Kenapa angkanya begini:
 * - Rincian, proforma, dan pembayaran adalah saat paling panas: customer sudah
 *   memegang angka. Pengingat pertama 3 jam kemudian (sering cuma lupa
 *   membalas), lalu besok, lalu lusa. Tiga pesan, satu per hari.
 * - Orang yang baru tanya barang/harga belum memegang apa pun; dua pesan
 *   cukup: satu pertanyaan konkret di hari yang sama, satu penutup di hari
 *   ketiga. Lebih dari itu ke orang yang belum berniat beli terbaca sebagai
 *   spam, dan laporan spam mematikan nomor WhatsApp seluruh company.
 * - Semua jatuh di dalam 3 hari, sehingga cocok dengan plafon bawaan 1,1,1.
 */
const STAGES = {
  inquiry: {
    offsetsHours: [6, 48],
    label: 'tanya barang/harga lalu diam',
  },
  summary: {
    offsetsHours: [3, 24, 48],
    label: 'rincian + grand total terkirim, belum dijawab',
  },
  proforma: {
    offsetsHours: [3, 24, 48],
    label: 'proforma menunggu persetujuan',
  },
  payment: {
    offsetsHours: [3, 24, 48],
    label: 'menunggu pembayaran',
  },
  // Kita yang berutang jawaban (pertanyaan ke departemen/pihak ketiga belum
  // dijawab): menagih customer di sini terbaca seperti tidak membaca
  // percakapan sendiri. Ditahan, bukan dikirimi.
  waiting_internal: {
    hold: true,
    label: 'menunggu jawaban tim',
  },
};

/** Tahap yang bisa dimatikan supervisor. waiting_internal selalu ditahan. */
const TOGGLEABLE_STAGES = ['inquiry', 'summary', 'proforma', 'payment'];

/** Penundaan customer tanpa waktu jelas ("nanti dulu", "besok"): pengingat pertama tidak sebelum ini. */
const DEFERRAL_MIN_HOURS = 24;

/**
 * Penundaan terjauh yang masih diingatkan. Di atas ini ("tahun depan")
 * rangkaian berhenti dengan alasan 'deferred': kebutuhan dan harganya sudah
 * pasti berubah, dan satu pesan setelah berbulan-bulan lebih mirip broadcast
 * daripada tindak lanjut.
 */
const DEFERRAL_MAX_HOURS = 30 * 24;

/**
 * Rincian/proforma yang lebih tua dari ini tidak dikutip angkanya lagi
 * (harga bisa sudah berubah); hanya terjadi pada pengingat yang ditunda.
 */
const STALE_FIGURES_HOURS = 72;

/** Kosong atau sebagian -> semua tahap punya nilai; yang tidak disebut menyala. */
function normalizeStageToggles(raw) {
  const source = raw && typeof raw === 'object' ? raw : {};
  return Object.fromEntries(TOGGLEABLE_STAGES.map((key) => [key, source[key] !== false]));
}

// Customer menolak atau minta berhenti. Hanya pesan TERAKHIR customer yang
// dibaca: "gak jadi" lalu "eh jadi deh" bukan penolakan. Sengaja agak lebar —
// salah berhenti merugikan satu pesan, salah menagih orang yang sudah menolak
// merugikan reputasi nomor.
const DECLINE = new RegExp([
  // "gak jadi masalah" = tidak apa-apa, bukan batal.
  String.raw`\b(?:gak|ga|gk|g|nggak|ngga|enggak|engga|tidak|tdk|ndak)\s+jadi\b(?!\s+(?:masalah|soal|apa|kendala|beban))`,
  String.raw`\bbatal(?:kan|in)?\b`,
  String.raw`\b(?:gak|ga|gk|nggak|ngga|enggak|tidak|tdk)\s+(?:minat|berminat|butuh|tertarik)\b`,
  String.raw`\b(?:sudah|udah|sdh|udh)\s+(?:beli|dapat|dapet|ambil|order)\b[^.?!\n]*\b(?:lain|sebelah)\b`,
  String.raw`\bjangan\s+(?:di)?(?:chat|hubungi|kirim|wa|spam)\b`,
  String.raw`\b(?:berhenti|stop)\s+(?:kirim|chat|hubungi)`,
  String.raw`^\s*(?:stop|berhenti|unsubscribe)\s*[.!]*\s*$`,
].join('|'), 'i');

// Customer menunda sendiri. Bukan penolakan; pengingat pertama digeser ke
// hari berikutnya, karena menagih orang yang baru bilang "nanti saya kabari"
// beberapa jam kemudian terasa tidak mendengarkan.
const DEFERRAL = new RegExp([
  String.raw`\bnanti\b`,
  String.raw`\b(?:pikir|pikir-pikir|diskusi(?:kan)?|rundingan|cek)\s+dulu\b`,
  String.raw`\b(?:tanya|bilang|izin|ijin|tanyakan)\b[^.?!\n]{0,30}\bdulu\b`,
  String.raw`\bbesok\b`,
  String.raw`\b(?:minggu|bulan)\s+depan\b`,
  String.raw`\bkabar(?:i|in)\b`,
  String.raw`\bbelum\s+(?:sekarang|dulu|sempat)\b`,
].join('|'), 'i');

// Customer bilang sudah membayar. Tidak diverifikasi di sini — itu urusan
// staf — tapi follow-up penagihan ke orang yang bilang sudah transfer adalah
// kesalahan paling memalukan di tahap ini.
const PAYMENT_CLAIM = new RegExp([
  String.raw`\b(?:sudah|udah|sdh|udh|dah|telah)\s+(?:saya\s+|aku\s+|sy\s+)?(?:transfer|tf|trf|bayar|dibayar|lunas|ditransfer|dilunasi|lunasi)\b`,
  String.raw`\bbukti\s+(?:transfer|tf|trf|bayar|pembayaran)\b`,
].join('|'), 'i');

// Foto/berkas dari customer sesudah rincian atau tagihan hampir selalu bukti
// transfer; isinya tidak dibaca di sini (lihat payment-proof.js).
const MEDIA_TYPES = new Set(['image', 'document']);

function isDecline(text) { return DECLINE.test(String(text || '')); }
function isDeferral(text) { return DEFERRAL.test(String(text || '')) || deferralHours(text) !== null; }

const NUMBER_WORDS = { satu: 1, dua: 2, tiga: 3, empat: 4, lima: 5, enam: 6, tujuh: 7, beberapa: 3 };
const countOf = (raw) => NUMBER_WORDS[String(raw).toLowerCase()] ?? Number(raw);

/**
 * Berapa jam customer minta ditunggu, dari kata-katanya sendiri. Yang terjauh
 * menang ("besok saya cek, minggu depan baru mulai" = minggu depan).
 * Infinity = terlalu jauh untuk diingatkan (tahun depan); null = tidak menunda.
 */
function deferralHours(text) {
  const t = String(text || '');
  const found = [];
  if (/\btahun\s+depan\b/i.test(t)) found.push(Infinity);
  if (/\bbulan\s+depan\b/i.test(t)) found.push(30 * 24);
  if (/\b(?:minggu|pekan)\s+depan\b/i.test(t)) found.push(7 * 24);
  for (const m of t.matchAll(/\b(\d{1,2}|satu|dua|tiga|empat|lima|enam|tujuh|beberapa)\s+(hari|minggu|pekan|bulan)\s+(?:lagi|ke\s*depan)\b/gi)) {
    const unit = { hari: 24, minggu: 168, pekan: 168, bulan: 720 }[m[2].toLowerCase()];
    found.push(countOf(m[1]) * unit);
  }
  if (/\blusa\b/i.test(t)) found.push(48);
  if (!found.length && DEFERRAL.test(t)) found.push(DEFERRAL_MIN_HOURS);
  if (!found.length) return null;
  const hours = Math.max(...found);
  return hours > DEFERRAL_MAX_HOURS ? Infinity : hours;
}

// ── Waktu relatif ──────────────────────────────────────────────────────────
// Model tidak tahu jam; tanpa diberi tahu ia mengarang ("minggu lalu ada
// rincian" untuk rincian lima jam lalu). Waktu dihitung di sini dari data,
// dalam zona company, dan hanya itu yang boleh disebut.

const DEFAULT_TZ = 'Asia/Jakarta';

function localParts(date, timeZone) {
  const fmt = (zone) => new Intl.DateTimeFormat('en-CA', {
    timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hour12: false,
  }).formatToParts(date);
  let parts;
  try { parts = fmt(timeZone || DEFAULT_TZ); } catch { parts = fmt(DEFAULT_TZ); }
  const get = (type) => parts.find((p) => p.type === type)?.value;
  return { day: Date.UTC(Number(get('year')), Number(get('month')) - 1, Number(get('day'))), hour: Number(get('hour')) % 24 };
}

/** Bagian hari yang wajar disebut untuk jam ini (rentangnya sengaja tumpang tindih). */
function partsOfDay(hour) {
  const parts = [];
  if (hour >= 4 && hour < 11) parts.push('pagi');
  if (hour >= 10 && hour < 15) parts.push('siang');
  if (hour >= 14 && hour < 19) parts.push('sore');
  if (hour >= 18 || hour < 4) parts.push('malam');
  return parts;
}

/**
 * @returns {{label: string, cats: string[]}} label untuk prompt; cats = frasa
 *   waktu yang cocok (dipakai checkWording).
 */
function relativeTime(at, now = new Date(), timeZone = DEFAULT_TZ) {
  const then = new Date(at);
  const a = localParts(then, timeZone);
  const b = localParts(now, timeZone);
  const days = Math.round((b.day - a.day) / (24 * HOUR_MS));
  const hours = Math.max(0, (now - then) / HOUR_MS);
  if (days <= 0) {
    const parts = partsOfDay(a.hour);
    return {
      label: hours < 1 ? 'kurang dari sejam lalu' : `hari ini, ${parts[0]} (±${Math.round(hours)} jam lalu)`,
      cats: ['tadi', 'hari_ini', ...parts.map((p) => `tadi_${p}`), ...(a.hour < 4 ? ['semalam'] : [])],
    };
  }
  if (days === 1) return { label: 'kemarin', cats: ['kemarin', ...(a.hour >= 18 ? ['semalam'] : [])] };
  if (days < 7) return { label: `${days} hari lalu`, cats: ['hari_lalu'] };
  if (days < 28) return { label: `${days} hari lalu`, cats: ['hari_lalu', 'minggu_lalu'] };
  return { label: `${days} hari lalu`, cats: ['hari_lalu', 'minggu_lalu', 'bulan_lalu'] };
}

// Frasa waktu lampau di teks follow-up -> kategori. Urutan penting: frasa
// panjang dibuang dulu supaya "minggu kemarin" tidak terbaca juga "kemarin".
const TIME_PHRASES = [
  [/\btadi\s+(pagi|siang|sore|malam)\b/gi, (m) => `tadi_${m[1].toLowerCase()}`],
  [/\bkemarin\s+lusa\b/gi, () => 'hari_lalu'],
  [/\b(?:minggu|pekan)\s+(?:lalu|kemarin|kemaren)\b/gi, () => 'minggu_lalu'],
  [/\bbulan\s+(?:lalu|kemarin|kemaren)\b/gi, () => 'bulan_lalu'],
  [/\b(?:\d{1,2}|dua|tiga|empat|lima|enam|beberapa)\s+hari\s+(?:yang\s+)?(?:lalu|kemarin|kemaren)\b/gi, () => 'hari_lalu'],
  [/\b(?:kemarin|kemaren|kmrn|kmarin)\b/gi, () => 'kemarin'],
  [/\bsemalam\b/gi, () => 'semalam'],
  [/\b(?:tadi|barusan)\b/gi, () => 'tadi'],
];

function claimsPayment(text) { return PAYMENT_CLAIM.test(String(text || '')); }

const time = (value) => (value ? new Date(value).getTime() : NaN);

/**
 * Rincian pesanan dari teks yang terkirim (bentuk `order-summary.buildSummary`
 * atau rincian yang disusun model dengan bentuk yang sama, aturan 16).
 * Angka diambil persis sebagai teks, tidak dihitung ulang.
 *
 * @returns {{items: {name: string, qty: string, unit: string}[], grandTotal: string,
 *            shippingPending: boolean} | null}
 */
function parseOrderSummary(body) {
  const text = String(body || '');
  const total = text.match(/GRAND\s+TOTAL\s*:?\s*\**\s*(Rp\.?\s?[\d.,]+)/i);
  if (!total) return null;
  const lines = text.split('\n');
  const items = [];
  for (let i = 0; i < lines.length; i += 1) {
    const head = lines[i].match(/^\s*\d+\.\s+(.+?)\s*$/);
    if (!head) continue;
    const next = lines[i + 1] || '';
    const qty = next.match(/^\s*([\d.,]+)\s*([^\dx×=]*?)\s*[x×]\s*Rp/i)
      || head[1].match(/\(([\d.,]+)\s*([^)]*)\)\s*$/);
    items.push({
      name: head[1].replace(/\s*\([\d.,]+\s*[^)]*\)\s*$/, '').trim(),
      qty: qty ? qty[1] : '',
      unit: qty ? String(qty[2] || '').trim() : '',
    });
  }
  return {
    items,
    grandTotal: total[1].replace(/\s+/g, ' ').replace(/^Rp\.?\s?/i, 'Rp '),
    shippingPending: /belum\s+termasuk\s+ongkir|ongkir[^\n]*menyusul/i.test(text),
  };
}

/** Teks rincian pesanan (bukan proforma; proforma dibaca dari tabelnya sendiri). */
function isOrderSummaryText(body) {
  const text = String(body || '');
  return /GRAND\s+TOTAL/i.test(text) && !/proforma/i.test(text);
}

const digitsOnly = (value) => String(value || '').replace(/\D/g, '');

/** Pesan keluar ini memuat rekening aktif atau link pembayaran company? */
function carriesPaymentInfo(body, { accountNumbers = [], paymentLink = '' } = {}) {
  const text = String(body || '');
  if (paymentLink && text.includes(paymentLink)) return true;
  const digits = digitsOnly(text);
  return accountNumbers.some((acc) => {
    const d = digitsOnly(acc);
    return d.length >= 6 && digits.includes(d);
  });
}

const rupiahText = (value) => `Rp ${Math.round(Number(value)).toLocaleString('id-ID')}`;

function linesFromDocument(payload) {
  return (Array.isArray(payload?.lines) ? payload.lines : []).map((l) => ({
    name: String(l.name || '').trim(),
    qty: l.qty == null ? '' : String(l.qty),
    unit: String(l.unit || '').trim(),
  })).filter((l) => l.name);
}

/**
 * Memutuskan tahap dari data tersimpan.
 *
 * @param {object} facts
 *   inbound: [{body, messageType, at}] pesan customer, lama ke baru
 *   outbound: [{body, at}] pesan kita, lama ke baru
 *   proforma: {number, total, payload, at} proforma open terbaru | null
 *   invoice: {number, total, payload, at} invoice terbaru | null
 *   proof: {at, verdict} bukti transfer terbaru yang tidak ditolak | null
 *   pendingQuestion: {department, at} pertanyaan internal yang belum dijawab | null
 *   paymentMarkers: {accountNumbers, paymentLink}
 * @param {object} opts toggles (normalizeStageToggles), now
 * @returns {{stage, stop?, hold?, disabled?, offsetsHours?, deferred?, data}}
 */
function resolveStage(facts = {}, { toggles = {}, now = new Date(), anchor = null, timezone = DEFAULT_TZ } = {}) {
  // Jendela data dihitung dari awal rangkaian (pesan terakhir kita), bukan
  // dari sekarang: pengingat yang ditunda seminggu harus tetap melihat
  // percakapan yang menundanya.
  const lookback = (anchor ? time(anchor) : now.getTime()) - FUNNEL_LOOKBACK_DAYS * 24 * HOUR_MS;
  const recent = (row) => row && time(row.at) >= lookback;
  const inbound = (facts.inbound || []).filter(recent);
  const outbound = (facts.outbound || []).filter(recent);
  const lastInbound = inbound[inbound.length - 1] || null;

  if (lastInbound && isDecline(lastInbound.body)) {
    return { stage: 'declined', stop: 'declined', data: { lastInbound: lastInbound.body } };
  }

  // Peristiwa funnel terbaru menentukan tahap: rincian baru sesudah invoice
  // lama berarti pesanan baru, bukan tagihan lama.
  const summaryMsg = [...outbound].reverse().find((row) => isOrderSummaryText(row.body)) || null;
  const summary = summaryMsg ? parseOrderSummary(summaryMsg.body) : null;
  const paymentMsg = facts.paymentMarkers
    ? [...outbound].reverse().find((row) => carriesPaymentInfo(row.body, facts.paymentMarkers)) || null
    : null;
  const events = [
    summary && { kind: 'summary', at: summaryMsg.at },
    recent(facts.proforma) && { kind: 'proforma', at: facts.proforma.at },
    recent(facts.invoice) && { kind: 'invoice', at: facts.invoice.at },
    paymentMsg && { kind: 'payment_info', at: paymentMsg.at },
  ].filter(Boolean).sort((a, b) => time(a.at) - time(b.at));
  const latest = events[events.length - 1] || null;
  const since = latest ? time(latest.at) : lookback;

  // Pembayaran masuk atau diklaim sesudah peristiwa terakhir: selesai.
  if (facts.proof && time(facts.proof.at) > since) {
    return { stage: 'paid', stop: 'payment_sent', data: { proof: facts.proof.verdict } };
  }
  const after = inbound.filter((row) => time(row.at) > since);
  if (after.some((row) => claimsPayment(row.body))
    || (latest && after.some((row) => MEDIA_TYPES.has(String(row.messageType || ''))))) {
    return { stage: 'paid', stop: 'payment_sent', data: {} };
  }

  if (facts.pendingQuestion && recent(facts.pendingQuestion)) {
    return { stage: 'waiting_internal', hold: true, data: { department: facts.pendingQuestion.department || '' } };
  }

  const data = {
    recentInbound: inbound.slice(-3).map((row) => row.body).filter(Boolean),
  };
  let stage = 'inquiry';
  if (latest?.kind === 'invoice' || latest?.kind === 'payment_info') {
    stage = 'payment';
    if (latest.kind === 'invoice') {
      data.documentNumber = facts.invoice.number;
      data.grandTotal = rupiahText(facts.invoice.total);
      data.items = linesFromDocument(facts.invoice.payload);
    } else if (recent(facts.proforma) && (!summaryMsg || time(facts.proforma.at) > time(summaryMsg.at))) {
      data.documentNumber = facts.proforma.number;
      data.grandTotal = rupiahText(facts.proforma.total);
      data.items = linesFromDocument(facts.proforma.payload);
    } else if (summary) {
      data.grandTotal = summary.grandTotal;
      data.items = summary.items;
      data.shippingPending = summary.shippingPending;
    }
    data.paymentInfoSent = Boolean(paymentMsg);
  } else if (latest?.kind === 'proforma') {
    stage = 'proforma';
    data.documentNumber = facts.proforma.number;
    data.grandTotal = rupiahText(facts.proforma.total);
    data.items = linesFromDocument(facts.proforma.payload);
  } else if (latest?.kind === 'summary') {
    stage = 'summary';
    data.grandTotal = summary.grandTotal;
    data.items = summary.items;
    data.shippingPending = summary.shippingPending;
  }

  // Waktu yang boleh disebut follow-up, dihitung dari data.
  const times = [];
  const addTime = (what, at) => { if (at) times.push({ what, ...relativeTime(at, now, timezone) }); };
  const eventLabel = { summary: 'rincian pesanan dikirim', proforma: 'proforma dikirim', invoice: 'invoice dibuat', payment_info: 'info pembayaran dikirim' };
  if (latest) addTime(eventLabel[latest.kind], latest.at);
  if (lastInbound) addTime('pesan terakhir customer', lastInbound.at);
  if (anchor) addTime('pesan terakhir kami', anchor);
  data.times = times;

  if (toggles[stage] === false) return { stage, disabled: true, data };

  let offsetsHours = STAGES[stage].offsetsHours;
  const deferHours = lastInbound ? deferralHours(lastInbound.body) : null;
  if (deferHours === Infinity) {
    return { stage: 'deferred', stop: 'deferred', data: { lastInbound: lastInbound.body } };
  }
  let deferUntil = null;
  let beyondCaps = false;
  if (deferHours !== null) {
    // Dihitung dari pesan customer, lalu dinyatakan sebagai jam sejak awal rangkaian.
    deferUntil = new Date(time(lastInbound.at) + deferHours * HOUR_MS);
    const fromStart = anchor ? (deferUntil.getTime() - time(anchor)) / HOUR_MS : deferHours;
    const last = offsetsHours[offsetsHours.length - 1];
    if (fromStart <= last) {
      // Masih di dalam rangkaian biasa: langkah sebelum tanggalnya dilewati.
      // Langkah yang tinggal beberapa jam sesudahnya ikut dilewati (jarak <12 jam).
      offsetsHours = [fromStart, ...offsetsHours.filter((h) => h >= fromStart + 12)];
    } else {
      // Lebih jauh dari rangkaian biasa: SATU pengingat di waktu yang dia
      // sebut, melewati batas hari plafon (plafon absolut tetap berlaku).
      offsetsHours = [fromStart];
      beyondCaps = true;
    }
    data.deferral = { label: deferralLabel(deferHours), requested: relativeTime(lastInbound.at, now, timezone).label, single: beyondCaps };
    if (latest && now - time(latest.at) > STALE_FIGURES_HOURS * HOUR_MS) {
      // Rincian lama: angka dan nomor dokumen tidak dikutip lagi.
      data.stale = true;
      delete data.grandTotal;
      delete data.documentNumber;
    }
  }
  return { stage, offsetsHours, deferred: deferHours !== null, deferUntil, beyondCaps, data };
}

function deferralLabel(hours) {
  if (hours >= 30 * 24) return 'bulan depan';
  if (hours >= 7 * 24) return hours >= 14 * 24 ? `${Math.round(hours / 168)} minggu lagi` : 'minggu depan';
  if (hours >= 48) return hours === 48 ? 'lusa' : `${Math.round(hours / 24)} hari lagi`;
  return 'nanti/besok';
}

/** "Rp 1.250.000" / "Rp1,250,000" -> "1250000". */
const amountKey = (text) => digitsOnly(text).replace(/^0+/, '');

/**
 * Angka rupiah dan nomor dokumen yang boleh muncul di follow-up: hanya yang
 * ada di data tahap atau sudah pernah KITA tulis di percakapan.
 */
function allowedFigures(plan, outbound = []) {
  const amounts = new Set();
  const numbers = new Set();
  const take = (text) => {
    for (const m of String(text || '').matchAll(/Rp\.?\s?([\d.,]+)/gi)) amounts.add(amountKey(m[1]));
    for (const m of String(text || '').matchAll(/\b(?:PF|INV)-[A-Z0-9]+\b/g)) numbers.add(m[0]);
  };
  // Rincian yang sudah basi (pengingat yang ditunda lama): tidak ada angka
  // atau nomor dokumen yang boleh dikutip, termasuk dari pesan kita dulu.
  if (plan?.data?.stale) return { amounts, numbers };
  for (const row of outbound) take(row?.body);
  if (plan?.data?.grandTotal) take(plan.data.grandTotal);
  if (plan?.data?.documentNumber) numbers.add(plan.data.documentNumber);
  return { amounts, numbers };
}

// Perkenalan diri: "saya Agnes dari ESBEJE", "Halo kak, Agnes dari ESBEJE",
// "perkenalkan". Follow-up selalu datang sesudah pesan kita sendiri, jadi
// percakapannya sudah berjalan dan aturan bawaan 3 melarangnya.
const SELF_INTRO = new RegExp([
  String.raw`\b(?:saya|aku|sy|ini|dengan)\s+(?:adalah\s+)?[A-Z][\w'-]+\s+dari\s+\S`,
  String.raw`(?:^|[,.!?]\s*)[A-Z][a-z][\w'-]*\s+dari\s+[A-Z0-9]`,
  String.raw`\b(?:[Pp]erkenalkan|[Kk]enalkan|[Kk]enalin)\b`,
].join('|'));

/**
 * Pemeriksaan bahasa: perkenalan diri ulang, dan frasa waktu lampau yang
 * tidak cocok dengan data (plan.data.times).
 * @returns {string|null} alasan penolakan, null kalau lolos.
 */
function checkWording(text, plan) {
  const body = String(text || '');
  if (SELF_INTRO.test(body)) return 'memperkenalkan diri lagi padahal percakapan sudah berjalan';
  const times = plan?.data?.times;
  if (!Array.isArray(times)) return null;
  const allowed = new Set(times.flatMap((t) => t.cats || []));
  let rest = body;
  for (const [pattern, category] of TIME_PHRASES) {
    for (const m of rest.matchAll(pattern)) {
      const cat = category(m);
      const ok = allowed.has(cat)
        // "semalam" boleh untuk kemarin malam maupun dini hari tadi.
        || (cat === 'semalam' && (allowed.has('kemarin') || allowed.has('tadi_malam')));
      if (!ok) return `menyebut waktu "${m[0]}" yang tidak sesuai data`;
    }
    rest = rest.replace(pattern, ' ');
  }
  return null;
}

/**
 * Memeriksa teks follow-up hasil model. Angka atau nomor dokumen yang tidak
 * ada di data berarti model mengarang atau menghitung ulang: teksnya ditolak.
 * @returns {string|null} alasan penolakan, null kalau lolos.
 */
function checkFigures(text, allowed) {
  for (const m of String(text || '').matchAll(/Rp\.?\s?([\d.,]+)/gi)) {
    const key = amountKey(m[1]);
    if (key && !allowed.amounts.has(key)) return `angka ${m[0].trim()} tidak ada di data`;
  }
  for (const m of String(text || '').matchAll(/\b(?:PF|INV)-[A-Z0-9]+\b/g)) {
    if (!allowed.numbers.has(m[0])) return `nomor dokumen ${m[0]} tidak ada di data`;
  }
  return null;
}

const words = (text) => new Set(String(text || '').toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter((w) => w.length > 2));

/** Follow-up yang hampir sama dengan kiriman sebelumnya (Jaccard kata >= 0,7). */
function repeatsPrevious(text, previousSends = []) {
  const mine = words(text);
  if (!mine.size) return false;
  return previousSends.some((prev) => {
    const theirs = words(prev?.body);
    if (!theirs.size) return false;
    let shared = 0;
    for (const w of mine) if (theirs.has(w)) shared += 1;
    return shared / (mine.size + theirs.size - shared) >= 0.7;
  });
}

function itemsLine(items = []) {
  return items.slice(0, 6).map((item) => {
    const qty = item.qty ? ` (${item.qty}${item.unit ? ` ${item.unit}` : ''})` : '';
    return `${item.name}${qty}`;
  }).join(', ') + (items.length > 6 ? `, dan ${items.length - 6} barang lain` : '');
}

/**
 * Blok prompt untuk satu tahap: posisi customer, data persis yang boleh
 * dipakai, dan SATU tujuan pesan ini.
 */
function stageBrief(plan, { step = 1, totalSteps = 1 } = {}) {
  if (!plan?.stage || !STAGES[plan.stage] || STAGES[plan.stage].hold) return '';
  const d = plan.data || {};
  const facts = [];
  if (d.items?.length) facts.push(`- Barang: ${itemsLine(d.items)}`);
  if (d.grandTotal) facts.push(`- Grand total: ${d.grandTotal}${d.shippingPending ? ' (belum termasuk ongkir)' : ''}`);
  if (d.documentNumber) facts.push(`- Nomor dokumen: ${d.documentNumber}`);
  if (d.recentInbound?.length) facts.push(`- Pesan terakhir customer: ${d.recentInbound.map((t) => `"${String(t).slice(0, 200)}"`).join(' / ')}`);
  const timeLines = (d.times || []).map((t) => `- ${t.what}: ${t.label}`);

  const first = step === 1;
  const goals = {
    inquiry: first
      ? 'Sebut barang yang dia tanyakan, lalu ajukan SATU pertanyaan konkret yang membawa ke rincian pesanan (jumlah yang dibutuhkan, atau lokasi kirim kalau jumlahnya sudah jelas).'
      : 'Bawa satu hal berguna tentang barang yang dia tanyakan (stok, pilihan ukuran, waktu kirim) dari playbook/katalog, lalu tawarkan menyusun rinciannya.',
    summary: first
      ? 'Tanyakan apakah rincian pesanan itu sudah sesuai dan boleh diproses. Sebut barang utamanya dan grand totalnya persis seperti di data.'
      : 'Tawarkan satu kemudahan untuk lanjut (mengubah jumlah, ganti barang, atau ambil di toko) lalu ajak konfirmasi rinciannya. Jangan menyalin ulang rinciannya.',
    proforma: first
      ? 'Ingatkan proforma yang menunggu persetujuannya dengan menyebut nomor dan grand totalnya, lalu minta konfirmasi setuju.'
      : 'Tanyakan apakah ada yang perlu diubah di proforma itu sebelum disetujui; sebut nomornya.',
    payment: first
      ? `Ingatkan pembayaran dengan sopan${d.documentNumber ? ' (sebut nomor dokumennya)' : ''}${d.grandTotal ? ' dan totalnya' : ''}, lalu tanyakan apakah sudah sempat transfer atau ada kendala.`
      : 'Tanyakan apakah ada kendala pembayaran yang bisa dibantu. Jangan menyalin ulang nomor rekening; tawarkan untuk mengirimkannya lagi hanya kalau memang ditanya.',
  };

  let deferralNote = '';
  if (d.deferral?.single) {
    deferralNote = `Customer sendiri minta dihubungi lagi ${d.deferral.label} (pesannya ${d.deferral.requested}). Ini SATU-SATUNYA pengingat yang dia minta: sapa ringan, sebut barangnya, ${d.stale ? 'lalu tawarkan menyusun rincian baru dengan harga terkini (jangan mengajak memproses rincian lama)' : 'lalu tanyakan apakah sudah siap lanjut'}. Abaikan TUJUAN di atas kalau bertentangan.`;
  } else if (plan.deferred) {
    deferralNote = 'Customer sebelumnya bilang akan menunda/mengabari. Hormati itu: tanya ringan apakah sudah ada keputusan, jangan mendesak.';
  }

  return [
    `POSISI CUSTOMER: ${STAGES[plan.stage].label}.`,
    facts.length ? `DATA TERSIMPAN (tulis nama dan angka PERSIS, jangan dihitung ulang, jangan menambah angka lain):\n${facts.join('\n')}` : '',
    d.stale ? 'Rinciannya sudah lebih dari 3 hari: harga dan ongkir bisa berubah. JANGAN menyebut total, harga, atau nomor dokumen lama; tawarkan menyusun rincian baru.' : '',
    timeLines.length ? `WAKTU (dihitung dari data; kalau menyebut waktu, pakai HANYA ini. Jangan menulis "minggu lalu", "kemarin", "tadi pagi", atau waktu lain yang tidak tertulis di sini):\n${timeLines.join('\n')}` : '',
    `TUJUAN pesan ini (langkah ${step} dari ${totalSteps}): ${goals[plan.stage]}`,
    deferralNote,
  ].filter(Boolean).join('\n');
}

module.exports = {
  STAGES, TOGGLEABLE_STAGES, FUNNEL_LOOKBACK_DAYS, DEFERRAL_MIN_HOURS, DEFERRAL_MAX_HOURS, STALE_FIGURES_HOURS,
  normalizeStageToggles, resolveStage, parseOrderSummary, isOrderSummaryText, carriesPaymentInfo,
  isDecline, isDeferral, deferralHours, claimsPayment, allowedFigures, checkFigures, checkWording, repeatsPrevious,
  relativeTime, stageBrief,
};
