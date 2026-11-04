'use strict';

/**
 * AI bertanya ke departemen: bila jawaban tidak ada di playbook/pengetahuan,
 * AI tidak boleh menebak. Ia memanggil alat `ask_department`, semua anggota
 * departemen diberi tahu, dan customer diberi kalimat tunggu yang jujur.
 */

const QUESTION_MAX = 600;

// Cadangan bila model lupa menulis kalimat tunggu setelah memanggil alat.
const HOLDING_FALLBACK = () =>
  'Baik kak, saya pastikan dulu ya supaya informasinya akurat. Mohon ditunggu sebentar, begitu sudah jelas langsung saya kabari kakak 🙏';

// Balasan ke customer HARUS memuat kabar tunggu. Model kadang lupa menulisnya
// setelah memanggil alat, dan customer yang ditinggal diam adalah kegagalan.
const WAITING = /\b(tunggu|menunggu|ditunggu|konfirmasi|konfirmasikan|kukonfirmasi|cek(?:kan)?|tanyakan|kabari|kabarin|kasih\s?kabar|hubungi)\b/i;
function mentionsWaiting(text) { return WAITING.test(String(text || '')); }

/**
 * Satu pesan tidak boleh berjanji "mohon ditunggu" sekaligus bertanya balik
 * ("mau 40KG atau 50KG?"): customer bingung harus menunggu atau menjawab.
 * Pertanyaan yang memang dibutuhkan sudah ada di pertanyaan departemen, jadi
 * kalimat tanya ke customer dibuang dan sisanya (fakta, kabar tunggu) dipertahankan.
 */
function dropQuestionsBesideHolding(text) {
  const parts = String(text).split(/(?<=[.!?])\s+|\n+/).map((x) => x.trim()).filter(Boolean);
  const kept = parts.filter((part) => !/\?\s*(?:\p{Extended_Pictographic}|\s)*$/u.test(part));
  return kept.length && kept.length !== parts.length && kept.some(mentionsWaiting) ? kept.join('\n') : String(text);
}

/** Pastikan balasan setelah ask_department memuat kabar tunggu; bila tidak, tambahkan. */
function ensureHolding(text) {
  const clean = String(text || '').trim();
  if (clean && mentionsWaiting(clean)) return dropQuestionsBesideHolding(clean);
  const hold = HOLDING_FALLBACK();
  return clean ? `${clean}\n\n${hold}` : hold;
}

// Jadwal pengingat ke departemen (menit sejak pertanyaan): sama dengan SQL
// claimDueDepartmentReminders. Yang ke-4 terakhir; setelah itu 'unresolved'.
const REMINDER_MINUTES = [5, 15, 120, 720];

/** Kode pendek pertanyaan (#ab12cd) untuk menjawab dari grup tanpa reply. */
function questionCode(id) { return String(id || '').replace(/-/g, '').slice(0, 6).toLowerCase(); }

/** Kode di teks jawaban grup, mis. "#ab12cd stok ada 40 sak". */
function codeInText(text) {
  const match = /#([0-9a-f]{6})\b/i.exec(String(text || ''));
  return match ? match[1].toLowerCase() : null;
}

/** Baris cara menjawab: dari grup (reply atau kode) atau dari Agnee. */
function answerHint({ code, group, dm = false }) {
  if (dm && !group) return `Balas pesan ini langsung dengan jawabannya. Kalau ada beberapa pertanyaan terbuka, tulis #${code} di jawabanmu. Bisa juga lewat Agnee (menu Pertanyaan AI).`;
  return group
    ? `Jawab dengan *reply* pesan ini di grup, atau tulis #${code} di jawabanmu. Bisa juga lewat Agnee (menu Pertanyaan AI).`
    : 'Mohon dijawab lewat Agnee (menu Pertanyaan AI).';
}

function buildReminderNotice({ department, question, customerLabel, reminderCount, final, code = null, group = false, dm = false }) {
  const cut = (v, n) => { const t = String(v || '').replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };
  return [
    final ? `*Pengingat terakhir — tim ${department}*` : `*Pengingat ${reminderCount}/4 — tim ${department}*`,
    `Customer: ${customerLabel}`,
    `Pertanyaan: "${cut(question, 650)}"`,
    '',
    final
      ? `Belum ada yang menjawab selama 12 jam. Customer ditandai belum terjawab. ${answerHint({ code, group, dm })}`
      : `Customer masih menunggu. ${answerHint({ code, group, dm })}`,
  ].join('\n');
}

function guide(departments) {
  const list = departments.map((d) => `- ${d.name}${d.description ? `: ${d.description}` : ''}`).join('\n');
  return `## BERTANYA KE DEPARTEMEN INTERNAL (alat ask_department)
Kalau customer menanyakan sesuatu yang jawabannya TIDAK ada di playbook, FAQ, atau pengetahuan di atas, JANGAN menebak, mengarang angka, stok, harga, jadwal, atau kebijakan. Panggil alat ask_department ke departemen yang paling berwenang, lalu beri tahu customer bahwa kamu sedang mengonfirmasi.

Departemen yang tersedia:
${list}

Aturan:
- Pilih SATU departemen yang paling relevan. Tulis pertanyaan yang singkat, lengkap, dan bisa dijawab tanpa membaca chat (sebut produk/hal yang dimaksud). Jangan menyertakan nomor telepon atau data pribadi customer.
- SATU pertanyaan = SATU keputusan, maksimal 2 kalimat, jawabannya cukup "ya/tidak" atau satu angka. DILARANG menumpuk beberapa pertanyaan bernomor (1)(2)(3) dalam satu panggilan. Kalau customer menanyakan banyak hal, tanyakan dulu yang paling menentukan (biasanya diskon/kebijakan harga), dan lanjutkan hal lain setelah jawabannya masuk.
- Cek data sendiri DULU, jangan tanyakan yang bisa dijawab alat: stok dan harga lewat cek_harga/katalog, ongkir lewat cek_ongkir, alamat/jam buka/toko lewat data Lokasi, promo lewat aturan Promo. Tanya departemen hanya untuk keputusan yang memang hanya manusia yang boleh memutuskan (diskon di luar aturan, termin DP/tempo, faktur pajak, pengecualian).
- Tulis angka dan fakta yang sudah kamu cek di pertanyaan (mis. "Semen PCC 50kg 20 zak @Rp57.500 — boleh diskon? berapa?") supaya tim tinggal menjawab dari HP.
- Setelah alat dipanggil, balas customer dengan 1–2 kalimat sesuai persona: katakan kamu memastikan dulu supaya informasinya akurat, minta ditunggu sebentar, dan kamu akan kabari begitu sudah jelas. Contoh nada: "Baik kak, saya pastikan dulu ya supaya informasinya akurat. Mohon ditunggu sebentar, begitu sudah jelas langsung saya kabari 🙏".
- JANGAN menyebut proses internal ke customer: tanpa kata "tim", "internal", "departemen", "bagian", "supplier", "pabrik", nama divisi, atau "saya tanyakan ke…". Customer cukup tahu kamu sedang memastikan. Jangan menyebut kata "AI", "alat", atau "sistem", dan jangan menjanjikan jam atau durasi tertentu.
- Jangan bertanya ke departemen untuk hal yang sudah ada jawabannya di pengetahuan, dan jangan memanggil alat dua kali untuk pertanyaan yang sama.
- Setelah alat dipanggil, jangan memberi jawaban tebakan sambil menunggu.`;
}

/**
 * Panduan alat untuk mode operasi antar-departemen. Penerimanya orang dalam,
 * jadi larangan menyebut "tim/departemen" di panduan customer tidak berlaku;
 * yang tetap berlaku: jangan menebak, jangan berbohong, jangan bocorkan data.
 */
function guideOps(departments) {
  const list = departments.map((d) => `- ${d.name}${d.description ? `: ${d.description}` : ''}`).join('\n');
  return `## BERTANYA KE DEPARTEMEN (alat ask_department)
Kalau pengirim menanyakan sesuatu yang jawabannya TIDAK ada di playbook atau pengetahuan di atas, JANGAN menebak. Panggil ask_department ke departemen yang paling berwenang.

Departemen yang tersedia:
${list}

Aturan:
- Pilih SATU departemen yang paling relevan. Tulis pertanyaan yang singkat dan lengkap (hal/barang yang dimaksud, jumlah atau ukuran, kapan dibutuhkan) sehingga bisa dijawab tanpa membaca chat.
- Setelah alat dipanggil, katakan kepada pengirim bahwa pertanyaannya sudah diteruskan ke departemen terkait dan kamu akan mengabari begitu ada jawaban. Jangan menjanjikan jam atau durasi.
- Jangan bertanya untuk hal yang sudah ada jawabannya, dan jangan memanggil alat dua kali untuk pertanyaan yang sama.
- Jangan menebak sambil menunggu, dan jangan mengaku sudah mengecek sesuatu yang belum.`;
}

function guideThirdPartiesOps(parties) {
  const list = parties.map((p) => `- ${p.name} [${p.tags.join(', ')}]${p.notes ? `: ${p.notes}` : ''}`).join('\n');
  return `## BERTANYA KE PIHAK LUAR (alat ask_third_party)
Untuk hal yang hanya diketahui pihak luar (stok bahan, kapasitas, jadwal kirim dari supplier) dan tidak ada di pengetahuan. Hal internal ditanyakan ke departemen, bukan ke pihak luar.

Pihak luar yang tersedia (tag di dalam kurung):
${list}

Aturan:
- Pilih pihak yang tag dan catatannya paling cocok. Tulis pertanyaan singkat dan teknis.
- JANGAN menyebut nama, nomor, atau data customer, dan jangan membuka harga jual atau margin kita.
- Setelah alat dipanggil, katakan kepada pengirim bahwa pertanyaannya sudah diteruskan dan akan dikabari. Jangan menebak sambil menunggu.`;
}

function guideThirdParties(parties) {
  const list = parties.map((p) => `- ${p.name} [${p.tags.join(', ')}]${p.notes ? `: ${p.notes}` : ''}`).join('\n');
  return `## BERTANYA KE PIHAK KETIGA (alat ask_third_party)
Untuk hal yang hanya diketahui pihak LUAR perusahaan (stok atau harga bahan dari supplier, kapasitas pabrik, dsb.) dan tidak ada di pengetahuan, kamu boleh bertanya ke pihak ketiga yang tersedia lewat WhatsApp. Departemen internal diutamakan untuk hal internal; pihak ketiga untuk hal yang jelas ada di luar.

Pihak ketiga yang tersedia (tag di dalam kurung):
${list}

Aturan:
- Pilih pihak yang tag dan catatannya paling cocok. Tulis pertanyaan singkat dan teknis (bahan, ukuran, jumlah). JANGAN menyebut nama, nomor, atau data pribadi customer, dan jangan membuka harga jual atau margin kita.
- Setelah alat dipanggil, beri tahu customer bahwa kamu sedang memastikan dulu dan akan mengabari. JANGAN menyebut pihak ketiga, supplier, atau pabrik itu ke customer.
- Jangan memberi jawaban tebakan sambil menunggu.
- Jangan berbohong: jangan mengaku sudah mengecek sesuatu yang belum kamu cek, dan jangan mengarang alasan penundaan. Cukup katakan kamu sedang memastikan.`;
}

function toolSpecThirdParty({ parties, run }) {
  return {
    name: 'ask_third_party',
    description: 'Tanya ke pihak ketiga (supplier/pabrik) lewat WhatsApp saat jawaban untuk customer hanya diketahui pihak luar. Balasan ditinjau staf dulu sebelum diteruskan; balas customer dengan kalimat tunggu.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['party', 'question'],
      properties: {
        party: { type: 'string', enum: parties.map((p) => p.name), description: 'Nama pihak ketiga yang paling cocok dengan tag-nya.' },
        question: { type: 'string', maxLength: QUESTION_MAX, description: 'Pertanyaan singkat tanpa data customer.' },
      },
    },
    run,
  };
}

/** Pesan WhatsApp ke pihak ketiga. Tidak memuat data customer. */
function buildThirdPartyMessage({ companyName, partyName, question }) {
  return `Halo ${partyName}, kami dari ${companyName || 'tim kami'}. Mau menanyakan: ${String(question).replace(/\s+/g, ' ').trim()}\n\nMohon dibalas di chat ini ya. Terima kasih 🙏`;
}

function toolSpec({ departments, run }) {
  const names = departments.map((d) => d.name);
  return {
    name: 'ask_department',
    description: 'Tanya ke departemen internal (semua anggotanya diberi tahu) saat jawaban untuk customer tidak ada di pengetahuan dan tidak bisa dicek lewat alat lain. SATU keputusan per pertanyaan, maksimal 2 kalimat, tanpa daftar bernomor. Jawaban datang belakangan; balas customer dengan kalimat tunggu.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['department', 'question'],
      properties: {
        department: { type: 'string', enum: names, description: 'Nama departemen yang paling berwenang.' },
        question: { type: 'string', maxLength: QUESTION_MAX, description: 'Satu keputusan, maksimal 2 kalimat, bisa dijawab ya/tidak atau satu angka; sebut produk, jumlah, dan harga yang sudah dicek.' },
      },
    },
    run,
  };
}

const CANCEL_RE = /\b(?:ga|gak|nggak|ngga|enggak|tidak|tak|ndak)\s+jadi\b|\bbatal(?:kan|nya)?\b|\bdibatalkan\b|\bcancel(?:ed|led)?\b/i;
const CLOSE_RE = /^(?:batal|dibatalkan|cancel|tutup|selesai)[.!\s]*$/i;
const QUESTION_RE = /\?\s*$/;

/**
 * Isi balasan staf di grup, setelah kode #xxxxxx dibuang:
 *  close    perintah menutup ("batal", "tutup"): pertanyaan ditutup tanpa diteruskan
 *  cancel   kabar pesanan batal dalam kalimat ("ini kan ga jadi yah"): bukan jawaban
 *  question pertanyaan balik / komentar berakhir tanda tanya: bukan jawaban
 *  answer   selain itu
 * Kalimat panjang yang kebetulan memuat "batal" tetap dianggap jawaban.
 */
function classifyGroupReply(text) {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  if (CLOSE_RE.test(t)) return 'close';
  if (t.length <= 60 && CANCEL_RE.test(t)) return 'cancel';
  if (t.length <= 60 && QUESTION_RE.test(t)) return 'question';
  return 'answer';
}

/** Balasan bot di grup untuk pesan yang bukan jawaban. Pertanyaan tetap terbuka. */
function nonAnswerNotice(kind, code) {
  const tag = code ? ` #${code}` : '';
  if (kind === 'cancel') {
    return `Dicatat, tetapi pesan itu belum dianggap jawaban, jadi pertanyaan masih terbuka dan pengingat tetap jalan. Kalau pesanan memang dibatalkan, balas pesan pertanyaan dengan kata "batal" (atau tulis${tag} batal): pertanyaan ditutup dan tidak ada yang dikirim ke customer. Kalau ada jawaban untuk customer, balas dengan jawabannya.`;
  }
  return `Pesan itu berupa pertanyaan, bukan jawaban, jadi pertanyaan masih terbuka. Mohon balas pesan pertanyaan dengan jawabannya (atau "batal" bila tidak jadi).`;
}

/** Kabar jujur ke customer saat pertanyaan 12 jam tak terjawab. Tanpa menyebut proses internal. */
function unresolvedCustomerNotice() {
  return 'Mohon maaf kak, informasi ini belum bisa kami pastikan sampai sekarang. Kami masih menindaklanjutinya dan akan mengabari kakak begitu sudah jelas ya 🙏';
}

/** Daftar pertanyaan terbuka untuk anggota yang membalas DM tanpa kode. */
function ambiguousDmNotice(items) {
  const cut = (v, n) => { const t = String(v || '').replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };
  const list = items.slice(0, 5).map((q) => `#${questionCode(q.id)} — ${cut(q.question, 80)}`).join('\n');
  return `Ada ${items.length} pertanyaan yang masih terbuka, jadi jawabanmu belum bisa dicocokkan. Tulis kodenya di jawabanmu, mis. "#${questionCode(items[0].id)} jawaban":\n${list}`;
}

const COMPOUND_MAX = 400;

/**
 * Pertanyaan majemuk (3+ butir bernomor atau terlalu panjang) tidak bisa
 * dijawab dari HP dan membuat jawaban setengah-setengah. Mengembalikan pesan
 * penolakan untuk model, atau null bila pertanyaan layak.
 */
function compoundProblem(question) {
  const text = String(question || '');
  const numbered = (text.match(/(?:^|[\s;:])\(?\d{1,2}[).]\s*\S/g) || []).length;
  if (numbered >= 3 || text.length > COMPOUND_MAX) {
    return 'Pertanyaan terlalu majemuk atau panjang. Tanyakan SATU keputusan saja (maksimal 2 kalimat, tanpa daftar bernomor), yang paling menentukan; hal yang bisa dicek lewat alat (stok, harga, ongkir, Lokasi, Promo) cek sendiri dulu. Lanjutkan hal lain setelah jawabannya masuk.';
  }
  return null;
}

/** Pesan WhatsApp ke anggota departemen. */
function buildQuestionNotice({ department, question, customerLabel, askerLabel = null, code = null, group = false, dm = false }) {
  const cut = (v, n) => { const t = String(v || '').replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };
  return [
    `*Pertanyaan dari asisten untuk tim ${department}*`,
    askerLabel ? `Penanya: ${askerLabel}` : `Customer: ${customerLabel}`,
    `Pertanyaan: "${cut(question, 650)}"`,
    '',
    `${answerHint({ code, group, dm })} Jawaban pertama yang masuk akan diteruskan ke ${askerLabel ? 'penanya' : 'customer'}.`,
  ].join('\n');
}

/** Pesan WhatsApp ke anggota departemen yang di-mention di komentar samping chat. */
function buildMentionNotice({ department, authorName, customerLabel, body }) {
  const cut = (v, n) => { const t = String(v || '').replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };
  return [
    `*${authorName || 'Rekan tim'} menyebut tim ${department} di catatan chat*`,
    `Customer: ${customerLabel}`,
    `Catatan: "${cut(body, 500)}"`,
    '',
    'Buka Agnee untuk membaca dan membalas di catatan. Pesan ini tidak dikirim ke customer.',
  ].join('\n');
}

const UNSURE_TOKEN = '[BELUM_PASTI]';

/** Kata yang membuka proses internal. Dipakai sebagai pagar setelah model menulis. */
const INTERNAL_LEAK = /\b(internal|departemen|divisi|supplier|vendor|pemasok|tim\s+(?:product|produk|procurement|management|manajemen|kami\s+di\s+dalam)|saya\s+(?:tanyakan|tanya)\s+(?:ke|kepada)|sudah\s+(?:kami\s+)?(?:bahas|tanyakan)|dibahas)\b/i;

function leaksInternal(text) { return INTERNAL_LEAK.test(String(text || '')); }

const RELAY_RULES = `Aturan keras:
- Pakai HANYA isi jawaban yang diberikan. Jangan menambah fakta, angka, janji, atau kepastian yang tidak ada di sana.
- Kalau jawabannya belum pasti (mengandung "kurang tahu", "belum tahu", "mungkin", "sepertinya", "nanti dicek", atau tidak menjawab pertanyaan), JANGAN menyampaikannya sebagai fakta. Keluarkan HANYA tulisan ${UNSURE_TOKEN} dan tidak ada yang lain.
- Jangan menceritakan apa yang terjadi di dalam: tanpa kata "tim", "internal", "departemen", "divisi", "bagian", "supplier", "pabrik", "vendor", tanpa nama orang atau divisi, tanpa "sudah kami tanyakan/bahas". Sampaikan hasilnya saja. Menahan detail proses itu boleh; memalsukannya tidak.
- JANGAN berbohong: jangan mengaku melakukan hal yang tidak kamu lakukan (mis. "sudah saya cek langsung ke gudang"), jangan mengarang sumber, angka, atau kepastian. Hanya katakan apa yang memang ada di hasil di atas.
- Nada santun, hangat, dan rendah hati. Tidak menggurui, tidak sombong, tidak menyalahkan, tidak membesar-besarkan, tidak berlebihan memohon maaf. Singkat (1–3 kalimat), sesuai persona.
- Keluarkan HANYA pesannya.`;

/** Perintah ke model untuk menyusun balasan ke customer dari jawaban yang sudah ditinjau. */
function relayPrompt({ customerText, question, answer, strict = false }) {
  return `Customer sebelumnya menulis: "${customerText}"\nKamu memastikan hal ini: "${question}"\nHasil yang sudah dipastikan: "${answer}"\n\nTulis balasan ke customer berdasarkan hasil itu.\n\n${RELAY_RULES}${strict ? '\n\nPERHATIAN: percobaan sebelumnya menyebut proses internal. Ulangi tanpa menyebut siapa pun atau proses apa pun, hanya hasilnya.' : ''}`;
}

/** Bacaan model: pasti / belum pasti / bocor. */
function judgeRelay(text) {
  const clean = String(text || '').trim();
  if (!clean) return { kind: 'empty' };
  if (clean.includes(UNSURE_TOKEN)) return { kind: 'unsure' };
  if (leaksInternal(clean)) return { kind: 'leak' };
  return { kind: 'ok', text: clean };
}

module.exports = {
  unresolvedCustomerNotice, ambiguousDmNotice,
  classifyGroupReply, nonAnswerNotice, compoundProblem, questionCode, codeInText, buildMentionNotice, guideOps, guideThirdPartiesOps, judgeRelay, leaksInternal, UNSURE_TOKEN, guideThirdParties, toolSpecThirdParty, buildThirdPartyMessage, mentionsWaiting, ensureHolding, buildReminderNotice, REMINDER_MINUTES, guide, toolSpec, buildQuestionNotice, relayPrompt, HOLDING_FALLBACK, QUESTION_MAX };
