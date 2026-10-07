'use strict';

/**
 * Broadcast: satu pesan ke banyak customer, dikirim pelan-pelan.
 *
 * Kecepatannya sengaja rendah. Nomor WhatsApp Web (QR) yang mengirim pesan
 * identik ke ratusan chat dalam hitungan menit adalah pola yang paling cepat
 * membuat nomor diblokir, dan nomor yang diblokir berarti seluruh percakapan
 * customer di nomor itu ikut hilang. Broadcast yang selesai dalam dua jam
 * lebih berguna daripada broadcast yang selesai dalam lima menit lalu
 * mematikan nomornya.
 *
 * Semua yang menentukan "boleh kirim sekarang atau tidak" ada di sini dan
 * murni (jam dioper, database dioper), supaya bisa diuji tanpa WhatsApp.
 */

const { tanggalLokal, instanUntukLokal, offsetZona } = require('./sla');

const ZONA_CADANGAN = 'Asia/Jakarta';

/**
 * Tempo per kanal.
 *
 * WhatsApp Web: 20–45 detik antar pesan, acak di rentang itu — jarak yang
 * persis sama setiap kali adalah ciri mesin. Hasilnya ±110 pesan per jam,
 * dibatasi 300 per hari per company.
 *
 * Cloud API: Meta sendiri yang mengatur batas lajunya dan nomornya tidak
 * berisiko diblokir karena tempo, jadi jaraknya pendek. Plafon hariannya
 * mengikuti tingkat pertama Meta (1.000 percakapan per 24 jam).
 */
const TEMPO = {
  whatsapp_web: { jedaMinMs: 20_000, jedaMaksMs: 45_000, plafonHarian: 300 },
  cloud_api: { jedaMinMs: 1_000, jedaMaksMs: 2_000, plafonHarian: 1000 },
};

/** Jam kirim, waktu lokal company. Pesan promosi jam 23.00 dibaca sebagai gangguan. */
const JAM_KIRIM = { mulai: 8, selesai: 20 };

/** Plafon penerima per broadcast. Lebih dari ini, pecah jadi beberapa broadcast. */
const MAKS_PENERIMA = 1000;

/**
 * Penerima yang diklaim lebih lama dari ini tanpa hasil dianggap prosesnya
 * mati di tengah pengiriman. Statusnya jadi `unknown`, tidak dikirim ulang.
 */
const KLAIM_KEDALUWARSA_MENIT = 5;

/** Gagal berturut-turut sebanyak ini menghentikan broadcast sementara. */
const GAGAL_BERUNTUN_MAKS = 5;

const PLACEHOLDER_NAMA = /\{\s*nama\s*\}/gi;
const SAPAAN_CADANGAN = 'Kak';
const KALIMAT_BERHENTI = 'Balas STOP kalau tidak mau menerima pesan seperti ini lagi.';
const KATA_BERHENTI = new Set(['STOP', 'BERHENTI', 'UNSUB', 'UNSUBSCRIBE']);

function tempoUntuk(provider) {
  return TEMPO[provider] || TEMPO.whatsapp_web;
}

/**
 * Nama tampilan WhatsApp sering berhias: "~ Budi ~", "Sari 🌸", "  ". Yang
 * dipakai hanya bagian yang bisa dibaca; kalau tidak ada huruf sama sekali,
 * sapaan cadangan lebih sopan daripada menyapa customer dengan emoji.
 */
function namaUntukSapaan(nama) {
  const bersih = String(nama || '')
    .replace(/[^\p{L}\p{N}\s.'-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[.'-]+|[.'-]+$/g, '')
    .trim();
  if (!/\p{L}/u.test(bersih)) return SAPAAN_CADANGAN;
  return bersih.length > 40 ? bersih.slice(0, 40).trim() : bersih;
}

/**
 * Bagian pesan yang tidak boleh disentuh variasi: link, angka (harga, persen,
 * tanggal, jam, kode), dan {nama}. AI boleh mengganti kata, bukan fakta.
 */
const POLA_LINK = /https?:\/\/\S+|www\.\S+/gi;
const POLA_ANGKA = /\d+(?:[.,:/]\d+)*%?/g;

function tokenTetap(teks) {
  const link = (teks.match(POLA_LINK) || []).map((l) => l.replace(/[.,!?)]+$/, ''));
  const tanpaLink = teks.replace(POLA_LINK, ' ');
  return {
    link,
    angka: tanpaLink.match(POLA_ANGKA) || [],
    nama: (teks.match(PLACEHOLDER_NAMA) || []).length,
  };
}

function hitung(daftar) {
  const map = new Map();
  for (const item of daftar) map.set(item, (map.get(item) || 0) + 1);
  return map;
}

/**
 * Kata batas waktu dikelompokkan menurut artinya. "Sampai 31 Oktober" dan
 * "hingga 31 Oktober" sama; "sebelum 31 Oktober" tidak — tanggal 31 tidak
 * termasuk. Angkanya utuh, jadi hanya penjaga ini yang menangkap pergeseran
 * seperti itu. Ketemu di uji coba dengan model sungguhan, 7 Okt.
 */
const BATAS_WAKTU = [
  ['sampai', /\b(?:sampai|hingga|s\.?\s?d\.?|s\/d|paling lambat|selambat-lambatnya|maksimal tanggal)\b/gi],
  ['sebelum', /\bsebelum\b/gi],
  ['setelah', /\b(?:setelah|sesudah|lewat dari)\b/gi],
  ['mulai', /\b(?:mulai|sejak|terhitung)\b/gi],
];

function kelasBatasWaktu(teks) {
  return BATAS_WAKTU.map(([kelas, pola]) => `${kelas}:${(teks.match(pola) || []).length}`).join(',');
}

function samaPersis(a, b) {
  const ma = hitung(a);
  const mb = hitung(b);
  if (ma.size !== mb.size) return false;
  for (const [k, v] of ma) if (mb.get(k) !== v) return false;
  return true;
}

/**
 * Menerima variasi AI hanya kalau faktanya utuh. Mengembalikan teks yang
 * sudah dibersihkan, atau null — dan null berarti pesan asli yang dikirim.
 *
 * Penjaganya di kode, bukan di prompt: model yang "sedikit" mengubah
 * "Diskon 20%" jadi "Diskon hingga 25%" sudah mengirim janji palsu atas nama
 * perusahaan ke ratusan orang. Aturan di prompt pernah dua kali lolos di
 * fitur lain (lihat aturan percakapan bawaan); aturan di sini tidak bisa.
 */
function periksaVariasi(asli, variasi) {
  let teks = String(variasi || '').trim();
  // Model kadang membungkus jawabannya dengan kutip atau label.
  teks = teks.replace(/^(?:pesan|versi baru|hasil)\s*:\s*/i, '').replace(/^["'“”‘’]+|["'“”‘’]+$/g, '').trim();
  if (!teks) return null;
  const a = tokenTetap(String(asli));
  const b = tokenTetap(teks);
  if (a.nama !== b.nama) return null;
  if (!samaPersis(a.link, b.link)) return null;
  if (!samaPersis(a.angka, b.angka)) return null;
  if (kelasBatasWaktu(String(asli)) !== kelasBatasWaktu(teks)) return null;
  const rasio = teks.length / Math.max(1, String(asli).trim().length);
  if (rasio < 0.6 || rasio > 1.5) return null;
  return teks;
}

const PROMPT_VARIASI = `Ubah SEDIKIT pesan WhatsApp di bawah supaya tidak persis sama dengan versi yang dikirim ke orang lain. Artinya harus sama persis.

Cara mengubah: ganti dua sampai empat kata dengan padanan yang setara, atau tukar urutan dua bagian kalimat. Sisanya biarkan.

Wajib:
- Nada dan gaya bahasanya sama. Kalau aslinya santai ("cuma", "ya", "udah", "kak"), hasilnya tetap santai. Jangan dibuat lebih formal atau lebih "jualan".
- Jangan menambah kata iklan yang tidak ada di aslinya, seperti "Dapatkan", "Segera", "Jangan lewatkan", "Terbatas", "Eksklusif".
- Semua angka, harga, persen, tanggal, jam, dan link ditulis persis seperti aslinya.
- Kata batas waktu (sampai, sebelum, setelah, mulai) jangan diganti ke arti lain.
- {nama} tetap ditulis {nama}, jumlahnya sama.
- Jangan menambah informasi, janji, ajakan, emoji, atau salam.
- Keluarkan HANYA teks pesannya.`;

/** Isi yang benar-benar diterima satu customer. */
function susunPesan(body, nama, denganKalimatBerhenti = true) {
  const isi = String(body || '').replace(PLACEHOLDER_NAMA, namaUntukSapaan(nama)).trim();
  return denganKalimatBerhenti ? `${isi}\n\n${KALIMAT_BERHENTI}` : isi;
}

/**
 * Apakah pesan customer adalah permintaan berhenti.
 *
 * Hanya satu kata utuh. "stop dulu ya kak, nanti saya kabari" adalah
 * percakapan, bukan permintaan keluar dari daftar — menyaringnya sebagai
 * berhenti akan diam-diam mengeluarkan customer yang sedang tertarik.
 */
function mintaBerhenti(teks) {
  const kata = String(teks || '').trim().replace(/[.!\s]+$/u, '').toUpperCase();
  return KATA_BERHENTI.has(kata);
}

function jamLokal(sekarangMs, zona) {
  return new Date(sekarangMs + offsetZona(sekarangMs, zona)).getUTCHours();
}

function zonaAman(zona) {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zona || ZONA_CADANGAN });
    return zona || ZONA_CADANGAN;
  } catch {
    return ZONA_CADANGAN;
  }
}

function dalamJamKirim(sekarangMs, zona, jam = JAM_KIRIM) {
  const sekarang = jamLokal(sekarangMs, zonaAman(zona));
  return sekarang >= jam.mulai && sekarang < jam.selesai;
}

/** Awal hari ini di zona company — batas hitungan plafon harian. */
function awalHariLokal(sekarangMs, zona) {
  const z = zonaAman(zona);
  return new Date(instanUntukLokal(tanggalLokal(sekarangMs, z), 0, 0, z));
}

/**
 * Jarak sebelum pesan berikutnya boleh keluar.
 *
 * Acaknya diturunkan dari waktu pengiriman terakhir, bukan Math.random() per
 * putaran: putaran berjalan tiap beberapa detik, dan undian ulang tiap putaran
 * akan menggeser hasilnya ke batas bawah rentang.
 */
function jedaSetelah(terakhirMs, tempo) {
  const rentang = Math.max(0, tempo.jedaMaksMs - tempo.jedaMinMs);
  if (!rentang) return tempo.jedaMinMs;
  const benih = Math.abs(Math.floor(terakhirMs) * 2654435761) % 4294967296;
  return tempo.jedaMinMs + (benih % (rentang + 1));
}

/**
 * Error pengiriman yang berarti nomornya tidak siap, bukan customer-nya yang
 * bermasalah. Untuk error seperti ini penerimanya dikembalikan ke antrean dan
 * broadcast dihentikan sementara — kalau tidak, seluruh daftar akan tercatat
 * gagal satu per satu selama nomornya terputus.
 */
function nomorTidakSiap(error) {
  return error?.statusCode === 409 || error?.statusCode === 503;
}

/**
 * Error dari lapisan WhatsApp yang sudah dikenal, dalam kalimat yang bisa
 * ditindaklanjuti supervisor. Sisanya ditampilkan apa adanya — lebih baik
 * pesan teknis yang jujur daripada tebakan.
 */
const ERROR_DIKENAL = [
  [/conversation is unavailable/i, 'Percakapan ini tidak ada lagi di WhatsApp nomor pengirim (chat dihapus atau nomor berganti).'],
  [/131047|re-?engagement|24 ?hour/i, 'Di luar jendela 24 jam Meta: customer ini belum chat dalam 24 jam terakhir.'],
  [/not (a )?registered|invalid wid|not on whatsapp/i, 'Nomor ini tidak terdaftar di WhatsApp.'],
];

function ringkasError(error) {
  const pesan = String(error?.message || error || 'Gagal mengirim').replace(/\s+/g, ' ').trim();
  const dikenal = ERROR_DIKENAL.find(([pola]) => pola.test(pesan));
  if (dikenal) return dikenal[1];
  return pesan.length > 300 ? `${pesan.slice(0, 297)}…` : pesan;
}

/**
 * Satu putaran pengirim untuk semua company.
 *
 * Paling banyak SATU pesan per company per putaran. Putaran berjalan tiap
 * beberapa detik, jadi temponya ditentukan oleh jarak di `TEMPO`, bukan oleh
 * seberapa sering putaran ini dipanggil.
 *
 * @param deps.kirim async (companyId, chatId, teks) => { messageId }
 * @param deps.onProgress (companyId, broadcastId) => void — memberi tahu layar
 */
async function putaranBroadcast({
  database, kirim, variasikan = null, onProgress = () => {}, logger = null, sekarangMs = Date.now(),
}) {
  const hasil = { terkirim: 0, gagal: 0, dijeda: 0, selesai: 0 };
  const kabari = (companyId, broadcastId) => {
    try { onProgress(companyId, broadcastId); } catch { /* layar tidak boleh menghentikan pengiriman */ }
  };

  for (const row of await database.markStaleBroadcastClaims(KLAIM_KEDALUWARSA_MENIT)) {
    kabari(row.companyId, row.broadcastId);
  }
  for (const row of await database.activateDueBroadcasts()) {
    kabari(row.companyId, row.broadcastId);
  }

  const daftar = await database.listCompaniesWithSendingBroadcasts();
  for (const company of daftar) {
    const { companyId } = company;
    const zona = zonaAman(company.timezone);
    const tempo = tempoUntuk(company.provider);
    try {
      if (!dalamJamKirim(sekarangMs, zona)) continue;

      const terakhirMs = company.lastSentAt ? new Date(company.lastSentAt).getTime() : null;
      if (terakhirMs && sekarangMs - terakhirMs < jedaSetelah(terakhirMs, tempo)) continue;

      const terkirimHariIni = await database.countBroadcastSentSince(companyId, awalHariLokal(sekarangMs, zona));
      if (terkirimHariIni >= tempo.plafonHarian) continue;

      for (const row of await database.skipOptedOutBroadcastRecipients(companyId)) {
        kabari(companyId, row.broadcastId);
      }

      const penerima = await database.claimNextBroadcastRecipient(companyId);
      if (!penerima) {
        for (const row of await database.finishDrainedBroadcasts(companyId)) {
          hasil.selesai += 1;
          kabari(companyId, row.broadcastId);
        }
        continue;
      }

      // Variasi gagal, ditolak penjaga, atau kuota AI habis: pesan asli tetap
      // dikirim. Variasi adalah hiasan, bukan syarat terkirim.
      let isi = penerima.body;
      if (penerima.aiVariation && variasikan) {
        const usulan = await Promise.resolve(variasikan(companyId, penerima.body)).catch((error) => {
          logger?.warn?.({ err: error, companyId }, 'Broadcast: variasi AI gagal, memakai pesan asli');
          return null;
        });
        isi = periksaVariasi(penerima.body, usulan) || penerima.body;
      }
      const teks = susunPesan(isi, penerima.name, penerima.optOutFooter);
      try {
        const sent = await kirim(companyId, penerima.chatId, teks);
        await database.markBroadcastRecipient(penerima.id, companyId, {
          status: 'sent', messageId: sent?.messageId || null, sentBody: teks,
        });
        hasil.terkirim += 1;
      } catch (error) {
        if (nomorTidakSiap(error)) {
          await database.releaseBroadcastRecipient(penerima.id, companyId);
          await database.pauseBroadcast(penerima.broadcastId, companyId, ringkasError(error));
          hasil.dijeda += 1;
        } else {
          await database.markBroadcastRecipient(penerima.id, companyId, {
            status: 'failed', error: ringkasError(error),
          });
          hasil.gagal += 1;
          const beruntun = await database.countTrailingBroadcastFailures(penerima.broadcastId, companyId, GAGAL_BERUNTUN_MAKS);
          if (beruntun >= GAGAL_BERUNTUN_MAKS) {
            await database.pauseBroadcast(penerima.broadcastId, companyId,
              `${GAGAL_BERUNTUN_MAKS} pengiriman berturut-turut gagal. Periksa nomor WhatsApp-nya, lalu lanjutkan.`);
            hasil.dijeda += 1;
          }
        }
        logger?.warn?.({ err: error, companyId, broadcastId: penerima.broadcastId }, 'Broadcast: satu pengiriman gagal');
      }
      kabari(companyId, penerima.broadcastId);
    } catch (error) {
      // Satu company yang databasenya bermasalah tidak boleh menahan yang lain.
      logger?.warn?.({ err: error, companyId }, 'Broadcast: putaran company gagal');
    }
  }
  return hasil;
}

module.exports = {
  TEMPO, JAM_KIRIM, MAKS_PENERIMA, KLAIM_KEDALUWARSA_MENIT, GAGAL_BERUNTUN_MAKS, KALIMAT_BERHENTI,
  PROMPT_VARIASI,
  tempoUntuk, namaUntukSapaan, susunPesan, mintaBerhenti, dalamJamKirim, awalHariLokal,
  jedaSetelah, periksaVariasi, putaranBroadcast,
};
