'use strict';

/**
 * Klaim hasil dan klaim tingkat risiko.
 *
 * Sebelumnya tidak ada cek apa pun untuk ini — satu-satunya penjaga adalah
 * instruksi di system prompt. Uji funnel Anya membuktikan itu tidak cukup:
 * dengan prompt 52.000 karakter, model tetap menulis "risiko kakak nyaris
 * nggak ada" dan "rata-rata lihat perbaikan signifikan di 60 hari pertama".
 * Larangan yang terkubur di prompt panjang tidak dipatuhi konsisten, jadi
 * aturan ini ditegakkan di kode.
 *
 * Pola sengaja sempit supaya tidak berisik: hanya frasa yang menilai hasil
 * atau tingkat risiko. "jaminan uang kembali" dan "trading tetap berisiko"
 * harus lolos bersih.
 */
const CLAIM_PATTERNS = [
  [/\b(?:di)?jamin(?:kan)?\b/i, 'menjamin hasil'],
  [/\bpasti\s+(?:untung|profit|balik|cuan|naik|pulih)\b/i, 'menjanjikan hasil pasti'],
  [/\bgaransi\s+(?:untung|profit|cuan|hasil)\b/i, 'menjanjikan hasil pasti'],
  [/\b(?:tanpa|bebas)\s+risiko\b/i, 'mengklaim tanpa risiko'],
  [/\brisiko\w*\s+(?:(?:kakak|kamu|anda)\s+)?(?:nyaris|hampir)?\s*(?:nggak|tidak|ga|gak)\s+ada\b/i, 'mengklaim tanpa risiko'],
  [/\brisiko\w*\s+(?:nol|minim|kecil sekali)\b/i, 'mengecilkan risiko'],
  [/\b(?:sudah\s+)?(?:teruji|terbukti)\b/i, 'klaim "teruji/terbukti" tanpa bukti'],
  // Bentuk halus yang lolos dari pola di atas: tidak menyebut angka dan tidak
  // memakai kata "aman", tapi tetap menjanjikan risiko berkurang.
  [/\b(?:meminimalisir|meminimalkan|mengurangi|menekan|memperkecil)\s+(?:\w+\s+){0,2}?risiko/i, 'menjanjikan risiko berkurang'],
  [/\brisiko\w*\s+(?:jadi\s+|lebih\s+)*terkontrol\b/i, 'menjanjikan risiko terkontrol'],
  [/\brata-rata\s+\w*\s*(?:profit|untung|pulih|balik|perbaikan)/i, 'klaim hasil rata-rata'],
  // "aman" hanya dihitung klaim kalau menilai modal/akun/trading. Kalimat sah
  // seperti "link pembayarannya aman" harus lolos.
  [/\blebih\s+aman\b/i, 'menilai keamanan'],
  [/\baman\s+(?:buat|untuk)\s+(?:modal|akun|dana|pemula|trading)/i, 'menilai keamanan'],
  [/\b(?:modal|akun|dana)\w*\s+(?:kakak|kamu|anda)?\s*(?:jadi\s+)?aman\b/i, 'menilai keamanan'],
];

/**
 * Placeholder template yang belum diisi model — pola `{kata}` seperti `{jam}`
 * di panduan follow-up dan penawaran call TM. Ini bukan soal gaya: kalau bocor
 * ke customer, ia membaca instruksi internal kita mentah-mentah dan pesannya
 * jadi tidak masuk akal ("Anya atau Rizki akan telepon kakak jam {jam} WIB").
 *
 * Ditemukan di produksi 2026-09-16: 15 balasan menjanjikan jadwal call ke
 * delapan chat berbeda, satu di antaranya mengirim placeholder ini mentah.
 * Model biasanya mengganti `{jam}` dengan jam sungguhan seperti diminta
 * instruksinya — tapi "biasanya" tidak cukup untuk sesuatu yang langsung
 * dibaca customer, jadi ditegakkan di kode seperti klaim hasil/risiko di atas.
 */
const PLACEHOLDER_LEAK_PATTERNS = [
  [/\{[a-zA-Z_][a-zA-Z0-9_]{0,24}\}/, 'placeholder template belum diisi'],
];

/**
 * Menanyakan balik apa maksud customer — sudah dilarang eksplisit di aturan
 * prompt (lihat AGNEE_CONVERSATION_RULES butir 11, dengan contoh persis
 * "maksudnya yang mana ya kak"), tapi larangan prompt saja terbukti tidak
 * cukup: produksi 2026-09-16 menemukan giliran nyata "Gimana kak" (pertanyaan
 * lanjutan yang sah) dibalas "Maksudnya gimana apanya kak?" — persis pola
 * yang sudah lama dilarang, dari company dan playbook yang berbeda dari kasus
 * pertama. Ditegakkan di kode seperti klaim hasil/risiko dan placeholder di
 * atas, dengan alasan yang sama: customer merasa disalahkan dan diajak
 * berdebat, bukan dibantu.
 *
 * Sengaja hanya menangkap pola "maksud(nya) ... apa/gimana/yang mana", bukan
 * semua kalimat bertanya balik — "maksudnya" yang dipakai untuk menjelaskan
 * ("Maksudnya, paket ini sudah termasuk ebook") tidak diikuti kata tanya jadi
 * tetap lolos.
 */
const CLARIFICATION_QUESTION_PATTERNS = [
  [/\bmaksud(?:nya)?\b[^.!?\n]{0,20}\b(?:yang\s+mana|gimana|apa(?:nya)?|bagaimana)\b/i, 'menanyakan balik maksud customer'],
];

/**
 * Pelanggaran yang tidak boleh lolos sama sekali — bukan soal gaya (panjang,
 * emoji), tapi salah dengan cara yang berbahaya kalau sampai ke customer.
 */
const HARD_VIOLATION_PATTERNS = [...CLAIM_PATTERNS, ...PLACEHOLDER_LEAK_PATTERNS, ...CLARIFICATION_QUESTION_PATTERNS];

/** Pecah jadi kalimat, tetap menyimpan baris supaya daftar tidak hancur. */
function splitSentences(text) {
  return String(text || '')
    .split(/(?<=[.!?])\s+|\n+/)
    .map((part) => part.trim())
    .filter(Boolean);
}

/** @returns {{sentence: string, label: string, isPlaceholderLeak: boolean, isClarificationQuestion: boolean}[]} */
function findClaimViolations(text) {
  const found = [];
  for (const sentence of splitSentences(text)) {
    for (const [pattern, label] of HARD_VIOLATION_PATTERNS) {
      if (pattern.test(sentence)) {
        const isPlaceholderLeak = PLACEHOLDER_LEAK_PATTERNS.some(([p]) => p === pattern);
        const isClarificationQuestion = CLARIFICATION_QUESTION_PATTERNS.some(([p]) => p === pattern);
        found.push({ sentence, label, isPlaceholderLeak, isClarificationQuestion });
        break;
      }
    }
  }
  return found;
}

/**
 * Buang kalimat yang melanggar. Kasar, tapi deterministik — dipakai hanya
 * sebagai jaring terakhir setelah model gagal memperbaiki sendiri.
 */
function stripClaimSentences(text) {
  const kept = splitSentences(text).filter((sentence) => (
    !HARD_VIOLATION_PATTERNS.some(([pattern]) => pattern.test(sentence))
  ));
  return kept.join('\n').trim();
}

/**
 * Tegakkan kontrak keluaran SEBELUM balasan dikirim ke customer.
 *
 * Dipakai jalur balasan otomatis. Alurnya tiga tingkat, dari paling lunak:
 *   1. Tidak melanggar -> kirim apa adanya.
 *   2. Melanggar -> minta model menulis ulang SEKALI dengan pelanggarannya
 *      disebutkan eksplisit. Prompt pendek jadi aturannya tidak tenggelam.
 *   3. Masih melanggar klaim hasil/risiko -> buang kalimat yang melanggar.
 *      Kasar, tapi klaim hasil itu soal kepatuhan, bukan selera gaya, jadi
 *      lebih baik balasan pincang daripada janji yang tidak boleh dibuat.
 *
 * Kalau setelah dipangkas tidak tersisa isi yang berarti, kembalikan null —
 * pemanggil memperlakukannya seperti "tidak ada balasan otomatis", sehingga
 * percakapan jatuh ke manusia alih-alih mengirim potongan kalimat.
 *
 * @returns {Promise<{text: string, rewritten: boolean, stripped: boolean,
 *                    warnings: string[]} | null>}
 */
async function enforceReplyContract(llmService, { text, systemPrompt, userMessage, history = [], expectations = {} }) {
  const initial = String(text || '').trim();
  if (!initial) return null;

  let warnings = styleWarnings(initial, expectations);
  if (!warnings.length) return { text: initial, rewritten: false, stripped: false, warnings: [] };

  let current = initial;
  let rewritten = false;

  if (llmService?.enabled) {
    const fixPrompt = `Balasan di bawah melanggar aturan berikut:
${warnings.map((w) => `- ${w}`).join('\n')}

Tulis ulang balasan itu supaya patuh. Pertahankan isi dan fakta yang sudah
benar; jangan menambah fakta, angka, harga, atau link baru. Jangan menilai
hasil, keamanan, atau tingkat risiko. Keluarkan HANYA teks balasannya.

Balasan yang harus diperbaiki:
${current}`;
    const retry = await llmService.generateReply(fixPrompt, { systemPrompt, history }).catch(() => null);
    if (retry?.text?.trim()) {
      current = retry.text.trim();
      rewritten = true;
      warnings = styleWarnings(current, expectations);
    }
  }

  // Klaim hasil/risiko adalah satu-satunya pelanggaran yang tidak boleh lolos.
  // Sisanya (panjang, emoji) jelek tapi tidak berbahaya.
  if (!findClaimViolations(current).length) {
    return { text: current, rewritten, stripped: false, warnings };
  }

  const strippedText = stripClaimSentences(current);
  if (strippedText.split(/\s+/).filter(Boolean).length < 5) return null;
  return {
    text: strippedText,
    rewritten,
    stripped: true,
    warnings: styleWarnings(strippedText, expectations),
  };
}

/**
 * Menggolongkan balasan pendek customer ("ya", "oke", "siap", "1").
 *
 * Uji funnel Anya: customer membalas "ya" setelah CS menyebut isi paket (bukan
 * pertanyaan, bukan daftar bernomor). Model menafsirkannya sebagai "setuju
 * beli" dan langsung mengirim link checkout. Aturan di system prompt tidak
 * menghentikan ini, jadi keputusannya dibuat di kode.
 *
 * Penjaga itu semula memperlakukan SEMUA balasan pendek sesudah pesan tanpa
 * tanda tanya sebagai ambigu, dan itu merusak percakapan sungguhan: CS menutup
 * dengan "Anya atau Rizki akan telepon kakak jam 12 siang WIB", customer
 * membalas "Oke", dan CS bertanya "Maksudnya yang mana ya kak?" — customer
 * lalu menulis "Saya krng paham", bingung oleh pertanyaan kita sendiri. Yang
 * sudah disepakati ditanyakan ulang, dan percakapan berputar.
 *
 * Pembedanya bukan ada-tidaknya tanda tanya, melainkan apakah giliran CS
 * terakhir MENUTUP sesuatu yang sudah disepakati — berterima kasih, atau
 * menjanjikan tim yang akan menghubungi. Di situ "oke" berarti "saya mengerti".
 *
 * Selain itu tetap dianggap ambigu, seperti semula: CS yang baru menyebut isi
 * paket lalu dibalas "ya" bisa berarti "saya ambil", dan menebaknya salah
 * berarti mengirim link pembayaran ke orang yang belum memutuskan.
 *
 * @returns {'none'|'ambiguous'|'acknowledged'}
 */
const SHORT_ACKS = new Set([
  'ya', 'iya', 'yaa', 'y', 'ok', 'oke', 'okey', 'okay', 'sip', 'siap',
  'boleh', 'itu', 'gitu', 'lanjut', 'mau', 'bisa', 'baik',
]);

/**
 * Giliran CS yang MENUTUP: berterima kasih, atau menjanjikan tim yang akan
 * menghubungi. Keduanya menyatakan sesuatu yang sudah disepakati, jadi balasan
 * pendek atasnya berarti "saya mengerti" dan bukan "saya ambil".
 *
 * Sengaja sempit. Default-nya tetap `ambiguous`, karena salah menebak ke arah
 * ambigu hanya memunculkan satu pertanyaan, sedangkan salah menebak ke arah
 * pengakuan berarti percakapan berhenti padahal customer menunggu.
 */
const CLOSING_MARKERS = /terima kasih|makasih|thank/i;
const COMMITMENT_MARKERS = /\bakan\b[^.!?\n]*\b(telepon|hubungi|kontak|call|menghubungi)\b/i;

function classifyShortReply(message, history = []) {
  const bare = String(message || '')
    .toLowerCase()
    .replace(/[\p{Extended_Pictographic}\p{P}\p{S}]/gu, '')
    .trim();
  if (!bare) return 'none';
  const isNumberPick = /^[1-9]$/.test(bare);
  if (!isNumberPick && !SHORT_ACKS.has(bare)) return 'none';

  const lastCs = [...history].reverse().find((turn) => turn?.role === 'assistant');
  if (!lastCs) return 'ambiguous';
  const body = String(lastCs.content || '');
  const hasNumberedOptions = /(?:^|\n)\s*(?:[1-9]\uFE0F?\u20E3|[1-9][.)])\s/.test(body);

  // Angka hanya bermakna kalau ada daftar bernomor untuk dirujuk.
  if (isNumberPick) return hasNumberedOptions ? 'none' : 'ambiguous';
  // CS baru saja bertanya atau menawarkan pilihan: balasannya punya rujukan.
  if (hasNumberedOptions || body.includes('?')) return 'none';
  // Giliran terakhir menutup sesuatu yang sudah disepakati: ini pengakuan.
  if (CLOSING_MARKERS.test(body) || COMMITMENT_MARKERS.test(body)) return 'acknowledged';
  return 'ambiguous';
}

/**
 * Apakah giliran CS terakhir sudah menutup percakapan?
 *
 * Dipakai untuk memutuskan antara menutup sekali lagi atau diam. Customer yang
 * membalas "oke" atas ucapan terima kasih tidak meminta apa pun; membalasnya
 * dengan terima kasih lagi hanya memancing "oke" berikutnya.
 */
function lastTurnAlreadyClosed(history = []) {
  const lastCs = [...history].reverse().find((turn) => turn?.role === 'assistant');
  if (!lastCs) return false;
  const body = String(lastCs.content || '');
  return !body.includes('?') && CLOSING_MARKERS.test(body);
}

/**
 * Sudah berapa kali berturut-turut customer hanya membalas pendek?
 *
 * Customer yang bilang "oke" selalu dibalas — didiamkan terasa seperti
 * diacuhkan, dan itu aturan tegas dari pemilik produk. Yang berubah adalah ISI
 * balasannya: ronde pertama ucapan terima kasih, ronde berikutnya sesuatu yang
 * benar-benar baru. Berterima kasih dua kali dengan susunan berbeda terbaca
 * seperti mesin yang kehabisan kalimat.
 *
 * Dihitung mundur dari ekor riwayat, berhenti pada giliran customer pertama
 * yang bukan balasan pendek. Pesan yang sedang diproses belum masuk riwayat,
 * jadi 0 berarti pesan inilah ronde pertamanya.
 */
function countRecentAckRounds(history = []) {
  const konteksNetral = [{ role: 'assistant', content: 'x' }];
  let rounds = 0;
  for (let i = history.length - 1; i >= 0; i -= 1) {
    const turn = history[i];
    if (turn?.role !== 'user') continue;
    if (classifyShortReply(turn.content, konteksNetral) === 'none') break;
    rounds += 1;
  }
  return rounds;
}

/**
 * Memastikan kalimat penutup memuat ucapan terima kasih.
 *
 * Bukan soal sopan santun — soal berhenti. `lastTurnAlreadyClosed` mengenali
 * penutup lewat ucapan terima kasih, jadi penutup tanpa kata itu membuat "oke"
 * berikutnya kembali digolongkan ambigu dan ditanyai. Penutup yang tidak bisa
 * dikenali sebagai penutup akan memancing putaran yang sama sekali lagi.
 */
function ensureClosingIsRecognizable(text, fallback) {
  const value = String(text || '').trim();
  if (!value) return fallback;
  if (CLOSING_MARKERS.test(value)) return value;
  return `${value.replace(/\s+$/, '')}\n\n${fallback}`;
}

/** Balasan klarifikasi tidak boleh menawarkan atau mengirim link apa pun. */
function stripLinks(text) {
  return String(text || '')
    .replace(/\s*(?:\u{1F449}\s*)?https?:\/\/\S+/gu, '')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

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
  const claim = findClaimViolations(value)[0];
  if (claim) {
    warnings.push(claim.isPlaceholderLeak || claim.isClarificationQuestion ? claim.label : `klaim hasil/risiko: ${claim.label}`);
  }
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

/**
 * Aturan percakapan bawaan Agnee — berlaku untuk SEMUA tenant.
 *
 * Yang ada di sini hanya bentuk percakapannya, bukan isinya. Apa saja ujung
 * yang sah, berapa harganya, siapa nama orangnya — itu milik playbook tiap
 * company dan tidak boleh bocor ke sini.
 *
 * Alasan aturan ini hidup di kode, bukan di tiap playbook: setiap tenant baru
 * akan mengulang kesalahan yang sama kalau dibiarkan menulis sendiri. Perilaku
 * yang merusak percakapan seragam lintas company — mengulang tawaran yang sama,
 * menyalin template mentah ke percakapan yang sudah berjalan, dan berputar
 * tanpa ujung.
 */
const AGNEE_CONVERSATION_RULES = `## ATURAN PERCAKAPAN (bawaan Agnee, berlaku selalu)

1. Dokumen adalah sumber FAKTA, bukan naskah. Angka, harga, isi paket, syarat
   garansi, nama produk, dan link wajib persis seperti tertulis. Susunan
   kalimatnya bebas kamu rangkai sendiri supaya nyambung dengan apa yang baru
   saja ditulis customer. Menyalin template mentah ke percakapan yang sudah
   berjalan membuatnya terbaca seperti mesin.

2. Jangan pernah mengulang tawaran yang sama dua kali berturut-turut. Kalau
   sebuah ajakan sudah disampaikan dan customer membalas tanpa menerimanya,
   naik ke langkah berikutnya — jangan menulis ulang ajakan yang sama dengan
   susunan berbeda.

3. Jangan memperkenalkan diri lagi kalau percakapan sudah berjalan. Perkenalan
   hanya untuk pesan pertama.

4. Setiap percakapan harus menuju satu ujung yang jelas sesuai playbook company
   ini. Jangan berputar.

5. Kalau sudah tiga giliran tanpa kemajuan ke salah satu ujung itu, berhenti
   menawarkan dan serahkan ke manusia. Diam lebih baik daripada berputar.

6. Baca riwayat percakapan sebelum menjawab. Jangan menanyakan hal yang sudah
   dijawab customer.

7. JANGAN PERNAH menyebut dirimu AI, bot, asisten virtual, atau mesin. Jangan
   menyebut bahwa percakapan dialihkan ke atau dari sistem otomatis. Kamu
   berbicara sebagai orang dari tim, titik.

8. Satu pesan, satu ajakan — kecuali kamu memang menawarkan dua jalan bernomor
   sekaligus, yang paling banyak boleh membawa dua link. Lebih dari dua tidak
   pernah dibuka.

9. Kalau kamu menyebut sebuah penawaran, linknya harus ikut di pesan yang sama.
   Menyebut paket lalu tidak memberi cara mengambilnya memaksa customer
   bertanya "caranya gimana" — dan itu berarti kamu membuang satu giliran.

10. Kirim link yang sesuai dengan posisi customer. Orang yang belum pernah
    melihat halaman penawaran dikirimi halaman penawaran, bukan halaman
    pembayaran. Halaman pembayaran hanya untuk orang yang sudah bilang mau
    membeli.

11. JANGAN PERNAH menanyakan apa maksud customer. Tidak dengan "maksudnya yang
    mana ya kak", tidak dengan susunan lain. Balasan pendek seperti "oke",
    "siap", atau "baik" dibalas ucapan terima kasih — bukan pertanyaan balik.
    Ditanyai maksudnya padahal sudah jelas membuat orang merasa disalahkan dan
    terbaca seperti diajak berdebat; di produksi ada yang sampai menulis "Saya
    krng paham" setelah ditanya begitu.

    Kalau kamu memang belum yakin maksudnya, akui dulu balasannya, lalu
    tawarkan satu langkah lanjutan yang konkret. Customer memilih, bukan
    menjelaskan dirinya.

    JANGAN PERNAH mendiamkan pesan customer. Setiap pesan dibalas. Kalau kamu
    sudah berterima kasih di giliran sebelumnya, jangan berterima kasih lagi —
    tambahkan satu keterangan baru yang berguna tentang apa yang sudah
    disepakati. Balasan yang mengulang kalimat sebelumnya sama buruknya dengan
    tidak membalas.

12. Sesuatu yang sudah dikonfirmasi tidak dikonfirmasi ulang. Kalau jadwal call
    sudah disepakati dan customer hanya mengiyakan, cukup satu kalimat penutup,
    lalu berhenti. Percakapan yang sudah punya ujung tidak perlu dilanjutkan.`;

/**
 * Membatasi jumlah link dalam satu balasan.
 *
 * Batasnya DUA, bukan satu. Batas satu terbukti merusak di produksi: balasan
 * pembuka menawarkan dua jalan bernomor — free signal Telegram dan Recovery
 * Package — lalu link kedua dibuang sementara kalimat penawarannya tetap
 * tinggal. Customer membaca ajakan membeli tanpa cara membelinya, harus
 * bertanya "caranya kak?", dan agent manusia yang akhirnya menutup. Menyebut
 * penawaran tanpa linknya lebih buruk daripada mengirim dua link.
 *
 * Link ketiga dan seterusnya tetap dibuang; itu batas asli yang memang
 * bermasalah. Yang dibuang adalah BARIS yang memuat link berlebih beserta
 * kalimat yang memperkenalkannya, supaya tidak meninggalkan panah atau
 * penawaran menggantung.
 *
 * @returns {{ text: string, dropped: number }}
 */
const MAX_LINKS_PER_REPLY = 2;

function limitLinks(text) {
  const baris = String(text || '').split('\n');
  const urlPattern = /https?:\/\/\S+/;
  let jumlahLink = 0;
  const disimpan = [];
  let dropped = 0;

  for (const satu of baris) {
    if (!urlPattern.test(satu)) {
      disimpan.push(satu);
      continue;
    }
    jumlahLink += 1;
    if (jumlahLink <= MAX_LINKS_PER_REPLY) {
      disimpan.push(satu);
      continue;
    }
    dropped += 1;
    // Kalimat pengantar tepat di atas link yang dibuang ikut dibuang selama ia
    // masih satu blok dengan link itu (tidak dipisah baris kosong) dan bukan
    // baris yang memuat link lain. Kalau tidak, yang tertinggal adalah
    // penawaran tanpa cara mengambilnya — persis kegagalan yang dihindari di
    // atas, hanya bergeser ke link ketiga.
    while (disimpan.length) {
      const sebelumnya = disimpan[disimpan.length - 1];
      if (sebelumnya.trim() === '' || urlPattern.test(sebelumnya)) break;
      disimpan.pop();
    }
  }

  if (!dropped) return { text: String(text || ''), dropped: 0 };
  const hasil = disimpan.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  return { text: hasil, dropped };
}

module.exports = {
  normalizeUsage, formatUsd, styleWarnings, judgeReply,
  CLAIM_PATTERNS, findClaimViolations, stripClaimSentences, enforceReplyContract,
  classifyShortReply, lastTurnAlreadyClosed, countRecentAckRounds, ensureClosingIsRecognizable, stripLinks, AGNEE_CONVERSATION_RULES, limitLinks, MAX_LINKS_PER_REPLY,
  COMMITMENT_MARKERS,
};
