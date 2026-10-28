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

/** Penundaan customer ("nanti dulu"): pengingat pertama tidak sebelum ini. */
const DEFERRAL_MIN_HOURS = 24;

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
function isDeferral(text) { return DEFERRAL.test(String(text || '')); }
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
function resolveStage(facts = {}, { toggles = {}, now = new Date() } = {}) {
  const lookback = now.getTime() - FUNNEL_LOOKBACK_DAYS * 24 * HOUR_MS;
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

  if (toggles[stage] === false) return { stage, disabled: true, data };

  const deferred = Boolean(lastInbound && isDeferral(lastInbound.body));
  let offsetsHours = STAGES[stage].offsetsHours;
  if (deferred) offsetsHours = [...new Set(offsetsHours.map((h) => Math.max(h, DEFERRAL_MIN_HOURS)))];
  return { stage, offsetsHours, deferred, data };
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
  for (const row of outbound) take(row?.body);
  if (plan?.data?.grandTotal) take(plan.data.grandTotal);
  if (plan?.data?.documentNumber) numbers.add(plan.data.documentNumber);
  return { amounts, numbers };
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

  return [
    `POSISI CUSTOMER: ${STAGES[plan.stage].label}.`,
    facts.length ? `DATA TERSIMPAN (tulis nama dan angka PERSIS, jangan dihitung ulang, jangan menambah angka lain):\n${facts.join('\n')}` : '',
    `TUJUAN pesan ini (langkah ${step} dari ${totalSteps}): ${goals[plan.stage]}`,
    plan.deferred ? 'Customer sebelumnya bilang akan menunda/mengabari. Hormati itu: tanya ringan apakah sudah ada keputusan, jangan mendesak.' : '',
  ].filter(Boolean).join('\n');
}

module.exports = {
  STAGES, TOGGLEABLE_STAGES, FUNNEL_LOOKBACK_DAYS, DEFERRAL_MIN_HOURS,
  normalizeStageToggles, resolveStage, parseOrderSummary, isOrderSummaryText, carriesPaymentInfo,
  isDecline, isDeferral, claimsPayment, allowedFigures, checkFigures, repeatsPrevious, stageBrief,
};
