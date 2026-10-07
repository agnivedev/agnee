'use strict';

/**
 * Jeda sebelum balasan otomatis keluar.
 *
 * Tiga hal yang membuatnya lebih dari sekadar setTimeout:
 *
 * 1. Jeda dihitung dari saat pesan customer MASUK, bukan dari saat balasan
 *    selesai dibuat. Menyusun balasan sudah memakan beberapa detik; kalau
 *    jedanya ditambahkan di atasnya, "5 detik" berarti 5 + lama AI berpikir.
 *    Dengan hitungan dari penerimaan, jeda 6 detik setelah AI berpikir 8
 *    detik langsung terkirim, karena jedanya sudah terlampaui.
 *
 * 2. Balasan satu chat dikerjakan berurutan. Tanpa itu, dua pesan beruntun
 *    menghasilkan dua jeda acak yang berjalan bersamaan, dan balasan untuk
 *    pesan kedua bisa keluar lebih dulu dari balasan untuk pesan pertama.
 *    Bonus yang tidak diminta: balasan kedua baru dibuat setelah yang pertama
 *    terkirim, jadi AI membacanya di riwayat dan tidak mengulang.
 *
 * 3. Selama jeda, keadaan chat bisa berubah. Kalau agent mengambil alih
 *    sebelum balasan keluar, balasan AI yang sudah disiapkan dibuang.
 */

/**
 * Pangkat yang menekuk sebaran ke arah batas bawah. Dengan 3 dan rentang
 * 5-60 detik: sekitar 57% balasan keluar dalam 15 detik, separuhnya dalam
 * ~12 detik, dan hanya ~23% yang lewat 30 detik. Rentangnya tetap sampai
 * batas atas — hanya "sering cepat, sesekali lambat" yang dijaga.
 *
 * Sengaja bukan setelan: yang diatur supervisor adalah batas bawah dan atasnya,
 * dan bentuk sebarannya cukup satu yang masuk akal.
 */
const SKEW = 3;

const DEFAULTS = Object.freeze({ enabled: true, minSeconds: 5, maxSeconds: 60 });

/**
 * Indikator "sedang mengetik" hanya muncul di BAGIAN AKHIR jeda, bukan
 * sepanjang jeda. Empat puluh detik berturut-turut "mengetik" terlihat janggal,
 * dan WhatsApp sendiri memadamkannya di 25 detik (kedua provider). Dengan
 * batas 20 detik, satu kali nyalakan cukup — tidak perlu loop penyegar yang
 * bisa tertinggal menyala kalau prosesnya mati.
 *
 * Lamanya mengikuti panjang balasan: orang mengetik balasan panjang lebih
 * lama daripada "oke".
 */
const TYPING = Object.freeze({ minMs: 1500, maxMs: 20_000, msPerChar: 60 });

// Batas yang sama dengan CHECK di migrasi 047. Dipasang lagi di sini karena
// nilai bisa datang dari baris lama atau jalur yang tidak melewati API.
const LIMITS = Object.freeze({ minSecondsMax: 120, maxSecondsMax: 300 });

function toSeconds(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

/**
 * Baris company -> setelan siap pakai dalam milidetik.
 * Baris kosong atau null memakai bawaan: jeda tetap berlaku, bukan hilang.
 */
function normalizeSettings(raw) {
  const enabled = raw?.replyDelayEnabled !== false;
  const min = Math.min(Math.max(toSeconds(raw?.replyDelayMinSeconds, DEFAULTS.minSeconds), 0), LIMITS.minSecondsMax);
  const max = Math.min(Math.max(toSeconds(raw?.replyDelayMaxSeconds, DEFAULTS.maxSeconds), min), LIMITS.maxSecondsMax);
  return { enabled, minMs: Math.round(min * 1000), maxMs: Math.round(max * 1000) };
}

/** Satu jeda acak dalam rentang, condong ke batas bawah. */
function pickDelayMs({ minMs, maxMs }, random = Math.random) {
  if (maxMs <= minMs) return minMs;
  return Math.round(minMs + (maxMs - minMs) * random() ** SKEW);
}

/**
 * Berapa lama indikator mengetik ditampilkan.
 * @param textLength  panjang balasan
 * @param availableMs sisa jeda yang masih harus ditunggu
 * @returns 0 kalau sisa jedanya terlalu pendek untuk layak ditampilkan
 */
function typingDurationMs(textLength, availableMs) {
  const wanted = Math.min(Math.max(textLength * TYPING.msPerChar, TYPING.minMs), TYPING.maxMs);
  const shown = Math.min(wanted, availableMs);
  return shown >= TYPING.minMs ? Math.round(shown) : 0;
}

/** Indikator itu kosmetik: gagalnya tidak boleh menggagalkan atau menunda balasan. */
async function bestEffort(fn) {
  try { await fn?.(); } catch { /* sengaja ditelan */ }
}

function sleepFor(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Menunggu `promise`, tapi paling lama `ms`. Pewaktunya dibersihkan agar tidak menggantung. */
function waitAtMost(promise, ms) {
  let timer;
  const timeout = new Promise((resolve) => { timer = setTimeout(resolve, ms); });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/**
 * @param opts.predecessorWaitMs  paling lama menunggu balasan sebelumnya di chat yang sama.
 *   Batasnya ada supaya satu panggilan yang menggantung tidak membisukan chat itu selamanya.
 */
function createReplyPacer({
  sleep = sleepFor,
  now = Date.now,
  random = Math.random,
  predecessorWaitMs = 120_000,
  onEvent = () => {},
} = {}) {
  const tails = new Map();

  /**
   * @param key          satu kunci per chat (company + chat), menentukan urutan
   * @param receivedAt   epoch ms pesan customer diterima
   * @param opts.settings   async () => baris setelan company
   * @param opts.produce    async () => muatan balasan, atau null kalau tidak ada yang dikirim
   * @param opts.send       async (muatan) => void
   * @param opts.snapshot   async (muatan) => keadaan chat sesaat setelah balasan siap
   * @param opts.stillValid async (snapshot) => false kalau balasan harus dibuang
   * @param opts.typing     { start, stop } indikator mengetik; opsional dan kosmetik
   * @returns {Promise<{sent: boolean, reason?: string, delayMs?: number, waitedMs?: number}>}
   */
  async function run(key, receivedAt, { settings, produce, send, snapshot, stillValid, typing }) {
    const previous = tails.get(key) || Promise.resolve();
    let release;
    const mine = new Promise((resolve) => { release = resolve; });
    tails.set(key, mine);

    try {
      await waitAtMost(previous, predecessorWaitMs);

      const payload = await produce();
      if (!payload) return { sent: false, reason: 'tidak-ada-balasan' };

      const config = normalizeSettings(await Promise.resolve(settings?.()).catch(() => null));
      const before = snapshot ? await snapshot(payload) : undefined;

      let delayMs = 0;
      let waitedMs = 0;
      const valid = () => !stillValid || stillValid(before, payload);
      const discard = () => {
        onEvent({ type: 'dibuang', key, delayMs });
        return { sent: false, reason: 'chat-berubah', delayMs, waitedMs };
      };
      if (config.enabled) {
        delayMs = pickDelayMs(config, random);
        // Yang sudah terpakai sejak pesan masuk (menyusun balasan, menunggu
        // balasan sebelumnya) dihitung sebagai bagian dari jeda.
        waitedMs = Math.max(0, delayMs - (now() - receivedAt));
        if (waitedMs > 0) {
          const typingMs = typing ? typingDurationMs(String(payload?.text ?? '').length, waitedMs) : 0;
          if (typingMs > 0) {
            // Diam dulu, lalu "mengetik" sampai balasan keluar.
            if (waitedMs - typingMs > 0) await sleep(waitedMs - typingMs);
            // Agent bisa mengambil alih selama masa diam. Menyalakan indikator
            // untuk balasan yang sudah pasti dibuang berarti customer melihat
            // "mengetik…" dari bot yang sudah digantikan.
            if (!(await valid())) return discard();
            await bestEffort(typing.start);
            await sleep(typingMs);
            // Dipadamkan SEBELUM pemeriksaan di bawah: balasan yang dibatalkan
            // karena agent mengambil alih tidak boleh meninggalkan indikator
            // yang menggantung.
            await bestEffort(typing.stop);
          } else {
            await sleep(waitedMs);
          }
        }
      }

      if (!(await valid())) return discard();

      await send(payload);
      onEvent({ type: 'terkirim', key, delayMs, waitedMs });
      return { sent: true, delayMs, waitedMs };
    } finally {
      release();
      // Hanya hapus kalau belum ada pengganti: ekor yang lebih baru milik
      // balasan yang datang sesudah ini dan tidak boleh ikut terhapus.
      if (tails.get(key) === mine) tails.delete(key);
    }
  }

  return { run, pendingChats: () => tails.size };
}

module.exports = { createReplyPacer, normalizeSettings, pickDelayMs, typingDurationMs, DEFAULTS, LIMITS, SKEW, TYPING };
