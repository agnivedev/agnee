'use strict';

/**
 * Impor chat dari WhatsApp yang sudah tersambung ke Lead List.
 *
 * Agnee hanya tahu percakapan yang lewat sejak nomor tersambung. Chat yang
 * sudah ada di ponsel sebelumnya terlihat di Inbox (dibaca langsung dari
 * WhatsApp) tetapi tidak ada di database, jadi Lead List dan broadcast tampak
 * kosong untuk nomor yang sudah lama dipakai.
 *
 * Modul ini TIDAK menyentuh WhatsApp sendiri. Semua akses ke klien datang lewat
 * `deps`, yang di produksi berisi `getChatsForUi` dan `getMessagesForUi`: dua
 * pembaca yang sudah punya fallback untuk serialisasi whatsapp-web.js yang
 * suka gagal. Menulis pembaca ketiga di sini berarti menambah jalan baru untuk
 * gagal di koneksi pelanggan yang sedang hidup.
 */

const DAY_SECONDS = 24 * 60 * 60;

/** Aktif = ada percakapan dalam 30 hari terakhir; dingin = 31 sampai 90 hari. */
const AKTIF_HARI = 30;
const DINGIN_HARI = 90;

/**
 * Satu proses mengimpor paling banyak sekian chat.
 *
 * Membaca riwayat satu chat berarti satu pemanggilan ke halaman WhatsApp Web
 * yang sedang melayani pelanggan. Ribuan sekaligus bisa membuat halaman itu
 * tersendat atau terputus, dan yang putus adalah nomor yang sedang dipakai
 * membalas customer. Sisanya diambil di proses berikutnya (yang sudah
 * terimpor dilewati), jadi "semua" tetap tercapai, hanya bertahap.
 */
const BATCH_MAKS = 300;

/** Jeda antar chat, supaya halaman WhatsApp tetap sempat melayani pesan masuk. */
const JEDA_ANTAR_CHAT_MS = 250;

/** Berapa pesan terakhir yang dibaca untuk menilai "pernah membalas". */
const JENDELA_PESAN = 40;

/** Gagal beruntun sebanyak ini berarti klien bermasalah, bukan chat tertentu. */
const GAGAL_BERUNTUN_MAKS = 8;

/** Penentuan produk lewat model dibatasi per proses; sisanya di proses berikutnya. */
const PRODUK_AI_MAKS = 100;

/** Berapa pesan masuk terakhir yang dibacakan ke model untuk menebak produk. */
const PESAN_UNTUK_PRODUK = 5;

const JENIS_PESAN_DIABAIKAN = new Set(['e2e_notification', 'protocol', 'notification_template', 'gp2', 'call_log']);

/** Hanya percakapan satu lawan satu. Grup, status, newsletter, dan siaran bukan lead. */
function isChatPerorangan(chatId) {
  const id = String(chatId || '');
  if (!id || id === 'status@broadcast') return false;
  return id.endsWith('@c.us') || id.endsWith('@lid');
}

/**
 * Menilai satu chat dari pesan yang terbaca.
 *
 * "replied" hanya kalau ADA pesan masuk di jendela baca. Kalau tidak ada,
 * hasilnya "unproven", bukan "tidak pernah": jendelanya terbatas, jadi kontak
 * yang membalas lama sebelumnya dan sudah kita kirimi puluhan pesan sesudahnya
 * bisa terlihat belum membalas. Salah ke sisi ini aman (broadcast butuh
 * konfirmasi tambahan); salah ke sisi sebaliknya berarti mengirim massal ke
 * orang yang tidak pernah menghubungi kita.
 *
 * `sudahAdaDiDatabase` = Agnee sendiri pernah mencatat pesan masuk dari chat
 * itu. Itu bukti yang lebih kuat daripada jendela baca, jadi menang.
 */
function nilaiChat({ pesan = [], sudahAdaDiDatabase = false }) {
  let terakhir = 0;
  let masukTerakhir = 0;
  for (const item of pesan) {
    if (JENIS_PESAN_DIABAIKAN.has(item?.type)) continue;
    const waktu = Number(item?.timestamp) || 0;
    if (waktu > terakhir) terakhir = waktu;
    if (!item?.fromMe && waktu > masukTerakhir) masukTerakhir = waktu;
  }
  const membalas = sudahAdaDiDatabase || masukTerakhir > 0;
  return {
    relation: membalas ? 'replied' : 'unproven',
    lastMessageAt: terakhir || null,
    lastInboundAt: masukTerakhir || null,
  };
}

/** Kelompok keaktifan dari waktu percakapan terakhir (detik epoch). */
function kelompokKeaktifan(lastActivityAt, sekarangDetik = Math.floor(Date.now() / 1000)) {
  const waktu = Number(lastActivityAt) || 0;
  if (waktu <= 0) return null;
  const hari = (sekarangDetik - waktu) / DAY_SECONDS;
  if (hari <= AKTIF_HARI) return 'active';
  if (hari <= DINGIN_HARI) return 'cooling';
  return 'old';
}

/** Teks yang dibacakan ke model untuk menebak produk: pesan MASUK terakhir saja. */
function teksUntukProduk(pesan = []) {
  return pesan
    .filter((item) => !item?.fromMe && !JENIS_PESAN_DIABAIKAN.has(item?.type) && String(item?.body || '').trim())
    .slice(-PESAN_UNTUK_PRODUK)
    .map((item) => String(item.body).trim().slice(0, 300))
    .join('\n');
}

/**
 * Menjalankan satu proses impor untuk satu koneksi.
 *
 * @param {object} p
 * @param {object} p.wa                 klien WhatsApp (dioper apa adanya ke deps)
 * @param {string} p.companyId
 * @param {string} p.connectionId
 * @param {object} p.deps
 *   listChats(wa)               -> [{ id, name, timestamp, isGroup }]
 *   readMessages(wa, chatId, n) -> { messages: [{ fromMe, timestamp, body, type }] }
 *   readLabels(wa)              -> Map<chatId, string[]>  (boleh kosong / melempar)
 *   isReady()                   -> boolean
 *   shouldStop()                -> boolean
 *   importedIds(companyId)      -> Set<string>
 *   knownInboundIds(companyId, ids) -> Set<string>
 *   save(companyId, connectionId, rows, names)  menulis ke database
 *   classifyProduct(chatId, text) -> Promise<boolean>  true = produk terpasang
 *   sleep(ms)
 * @param {object} p.options  { classifyProducts, batchMaks, jedaMs }
 * @param {function} p.onProgress dipanggil dengan salinan keadaan
 */
async function jalankanImpor({ wa, companyId, connectionId, deps, options = {}, onProgress = () => {} }) {
  const batchMaks = options.batchMaks ?? BATCH_MAKS;
  const jedaMs = options.jedaMs ?? JEDA_ANTAR_CHAT_MS;
  const keadaan = {
    phase: 'listing',
    totalOnPhone: 0, eligible: 0, alreadyImported: 0, toDo: 0, done: 0,
    replied: 0, unproven: 0, failed: 0, remaining: 0,
    labelsAvailable: false, productsAssigned: 0, productsTried: 0, stoppedBecause: null,
  };
  const lapor = () => onProgress({ ...keadaan });

  const semua = (await deps.listChats(wa)) || [];
  keadaan.totalOnPhone = semua.length;
  const layak = semua
    .filter((chat) => !chat.isGroup && isChatPerorangan(chat.id))
    .sort((a, b) => Number(b.timestamp || 0) - Number(a.timestamp || 0));
  keadaan.eligible = layak.length;

  const sudah = await deps.importedIds(companyId);
  const belum = layak.filter((chat) => !sudah.has(chat.id));
  keadaan.alreadyImported = layak.length - belum.length;
  const kerjakan = belum.slice(0, batchMaks);
  keadaan.toDo = kerjakan.length;
  keadaan.remaining = Math.max(0, belum.length - kerjakan.length);
  lapor();

  let petaLabel = new Map();
  try {
    petaLabel = (await deps.readLabels(wa)) || new Map();
    keadaan.labelsAvailable = petaLabel.size > 0;
  } catch {
    // Akun WhatsApp biasa tidak punya label; itu bukan kegagalan impor.
  }

  const diDatabase = await deps.knownInboundIds(companyId, kerjakan.map((chat) => chat.id));
  const baris = [];
  const nama = [];
  const untukProduk = [];
  let gagalBeruntun = 0;

  const simpan = async () => {
    if (!baris.length) return;
    await deps.save(companyId, connectionId, baris.splice(0), nama.splice(0));
  };

  keadaan.phase = 'reading';
  for (const chat of kerjakan) {
    if (deps.shouldStop()) { keadaan.stoppedBecause = 'cancelled'; break; }
    if (!deps.isReady()) { keadaan.stoppedBecause = 'disconnected'; break; }
    try {
      const { messages = [] } = (await deps.readMessages(wa, chat.id, JENDELA_PESAN)) || {};
      const nilai = nilaiChat({ pesan: messages, sudahAdaDiDatabase: diDatabase.has(chat.id) });
      baris.push({
        chatId: chat.id,
        relation: nilai.relation,
        lastMessageAt: nilai.lastMessageAt ?? (Number(chat.timestamp) || null),
        lastInboundAt: nilai.lastInboundAt,
        waLabels: petaLabel.get(chat.id) || [],
      });
      if (chat.name) nama.push({ chatId: chat.id, name: chat.name });
      if (nilai.relation === 'replied') {
        keadaan.replied += 1;
        const teks = teksUntukProduk(messages);
        if (teks) untukProduk.push({ chatId: chat.id, teks });
      } else {
        keadaan.unproven += 1;
      }
      gagalBeruntun = 0;
    } catch {
      keadaan.failed += 1;
      gagalBeruntun += 1;
      if (gagalBeruntun >= GAGAL_BERUNTUN_MAKS) { keadaan.stoppedBecause = 'client_unstable'; break; }
    }
    keadaan.done += 1;
    if (baris.length >= 25) await simpan();
    if (keadaan.done % 10 === 0) lapor();
    await deps.sleep(jedaMs);
  }
  await simpan();
  lapor();

  if (options.classifyProducts && untukProduk.length && !keadaan.stoppedBecause) {
    keadaan.phase = 'products';
    for (const item of untukProduk.slice(0, PRODUK_AI_MAKS)) {
      if (deps.shouldStop()) { keadaan.stoppedBecause = 'cancelled'; break; }
      keadaan.productsTried += 1;
      try {
        if (await deps.classifyProduct(item.chatId, item.teks)) keadaan.productsAssigned += 1;
      } catch {
        // Satu tebakan produk yang gagal tidak membatalkan impor yang sudah tersimpan.
      }
      if (keadaan.productsTried % 5 === 0) lapor();
    }
  }

  keadaan.phase = 'done';
  lapor();
  return keadaan;
}

module.exports = {
  isChatPerorangan, nilaiChat, kelompokKeaktifan, teksUntukProduk, jalankanImpor,
  AKTIF_HARI, DINGIN_HARI, BATCH_MAKS, JENDELA_PESAN, PRODUK_AI_MAKS,
};
