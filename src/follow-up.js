'use strict';

// Semua tenant Agnee berbisnis di Indonesia, dan jam kirim di follow_up_settings
// disimpan sebagai jam lokal mereka. Kalau nanti ada tenant di zona lain, ini
// yang harus dipindah jadi kolom per company.
const BUSINESS_TZ = 'Asia/Jakarta';
const DAY_MS = 24 * 60 * 60 * 1000;

/** Jam (0-23) di zona bisnis, bukan jam server. */
function hourInBusinessTz(now = new Date()) {
  return Number(new Intl.DateTimeFormat('en-GB', {
    timeZone: BUSINESS_TZ, hour: '2-digit', hour12: false,
  }).format(now));
}

function withinSendWindow(fromHour, toHour, now = new Date()) {
  const hour = hourInBusinessTz(now);
  // Jendela yang melewati tengah malam (mis. 21→8) tetap ditangani benar.
  return fromHour <= toHour ? hour >= fromHour && hour < toHour : hour >= fromHour || hour < toHour;
}

/**
 * Jarak minimum untuk kirim manual, dalam menit.
 *
 * Supervisor tidak harus menunggu jadwal otomatis — itu gunanya tombol manual.
 * Tapi jarak nol berarti plafon harian bisa dihabiskan dalam hitungan detik:
 * dengan plafon bawaan 5 di hari pertama, satu orang menerima lima pesan
 * beruntun. Itu spam, dan tidak berhenti jadi spam hanya karena manusia yang
 * mengekliknya. Jadi jaraknya diperpendek, bukan dihapus.
 */
const MANUAL_MIN_GAP_MINUTES = 15;

/**
 * Setelan company dengan jarak minimum versi manual: yang berlaku adalah yang
 * lebih kecil antara setelan company dan MANUAL_MIN_GAP_MINUTES.
 */
function withManualGap(state) {
  return {
    ...state,
    minGapMinutes: Math.min(state.minGapMinutes ?? MANUAL_MIN_GAP_MINUTES, MANUAL_MIN_GAP_MINUTES),
  };
}

/**
 * Memutuskan apakah satu chat boleh dikirimi follow-up sekarang.
 *
 * Angka di dayCaps adalah PLAFON, bukan kuota yang harus dihabiskan: fungsi ini
 * hanya menjawab "boleh atau tidak", dan pemanggilnya masih bisa memutuskan
 * tidak mengirim kalau tidak ada yang layak disampaikan.
 *
 * @returns {{send: boolean, dayIndex?: number, attemptInDay?: number,
 *            stop?: string, skip?: string}}
 *   stop = rangkaian selesai permanen; skip = belum waktunya, coba lagi nanti.
 */
function decide(state, now = new Date()) {
  const { sequenceStartedAt, sentPerDay = [], dayCaps, minGapMinutes, lastSentAt,
    sendFromHour, sendToHour } = state;

  const dayIndex = Math.floor((now - new Date(sequenceStartedAt)) / DAY_MS);
  if (dayIndex < 0) return { send: false, skip: 'clock_skew' };
  if (dayIndex >= dayCaps.length) return { send: false, stop: 'exhausted' };

  if (lastSentAt && now - new Date(lastSentAt) < minGapMinutes * 60_000) {
    return { send: false, skip: 'gap_not_elapsed' };
  }
  if (!withinSendWindow(sendFromHour, sendToHour, now)) {
    return { send: false, skip: 'outside_send_window' };
  }

  const sentToday = sentPerDay[dayIndex] || 0;
  if (sentToday >= dayCaps[dayIndex]) return { send: false, skip: 'day_cap_reached' };

  return { send: true, dayIndex, attemptInDay: sentToday + 1 };
}

/**
 * Menyusun prompt untuk satu follow-up.
 *
 * Dua batasan yang paling menentukan hasilnya: jangan mengulang follow-up
 * sebelumnya (itu yang membuat follow-up terasa seperti nagih), dan jangan
 * menyebut fakta yang tidak ada di playbook.
 */
/** Apakah kita sudah pernah mengirim link ke chat ini (checkout/pembayaran)? */
function checkoutAlreadySent(recentOutbound = [], paymentLink = '') {
  return recentOutbound.some((row) => {
    const body = String(row?.body || '');
    if (paymentLink && body.includes(paymentLink)) return true;
    return /\b(?:checkout|pembayaran|bayar)\b/i.test(body) && /https?:\/\//.test(body);
  });
}

function buildFollowUpPrompt({ dayIndex, attemptInDay, dayCaps, previousSends, playbookMd,
  recentOutbound = [], checkoutSent = false }) {
  const isLast = dayIndex === dayCaps.length - 1
    && attemptInDay === dayCaps[dayIndex];
  const previous = previousSends.length
    ? previousSends.map((s, i) => `${i + 1}. (hari ${s.dayIndex + 1}) ${s.body}`).join('\n')
    : '(belum ada)';

  // Tanpa ini, follow-up tidak tahu apa pun tentang percakapannya dan hanya
  // bisa mengulang penawaran umum. Dengan konteks, ia bisa menanyakan hal yang
  // konkret — dan pertanyaan konkret jauh lebih mudah dibalas customer.
  const lastSaid = recentOutbound.length
    ? recentOutbound.map((row) => `- ${row.body}`).join('\n')
    : '(tidak ada catatan)';

  const pendingAction = checkoutSent
    ? `\nLink checkout SUDAH dikirim ke orang ini dan dia belum membalas. Untuk
follow-up pertama, cukup tanyakan kabarnya secara langsung dan singkat —
misalnya menanyakan apakah sudah sempat checkout, atau apakah ada yang masih
mengganjal sebelum lanjut bayar. Pertanyaan pendek yang konkret lebih mudah
dibalas daripada penawaran yang diulang. JANGAN mengirim ulang link yang sama
kecuali dia menanyakannya.\n`
    : '';

  return `Tulis SATU pesan follow-up WhatsApp untuk customer yang belum membalas.

Yang terakhir KAMI sampaikan ke orang ini:
${lastSaid}
${pendingAction}

Ini follow-up ke-${previousSends.length + 1} secara keseluruhan, hari ke-${dayIndex + 1} dari ${dayCaps.length}, percobaan ke-${attemptInDay} di hari ini.${isLast ? '\nINI FOLLOW-UP TERAKHIR — tutup dengan hormat, jangan menekan, beri tahu dia boleh chat kapan saja.' : ''}

Follow-up yang SUDAH pernah dikirim ke orang ini:
${previous}

${playbookMd ? `Panduan follow-up dari pemilik bisnis:\n${playbookMd}\n` : ''}
Aturan wajib:
- Jangan mengulang isi atau sudut pandang follow-up yang sudah dikirim di atas. Kalau tidak ada lagi yang bernilai untuk disampaikan, balas persis: SKIP
- Kalau ada langkah yang jelas sedang menggantung (checkout belum selesai, pertanyaan kita belum dijawab), menanyakannya langsung dan singkat sudah cukup bernilai — tidak perlu dibungkus penawaran baru.
- Kalau tidak ada yang menggantung, bawa satu hal yang berguna untuk dia (wawasan, pengingat konkret), bukan sekadar "halo kak masih di sana?"
- Jangan menuntut jawaban, jangan membuat rasa bersalah, jangan mendesak.
- Jangan menyebut angka, harga, atau klaim yang tidak ada di panduan/fakta.
- Maksimal 45 kata, satu paragraf, bahasa Indonesia sehari-hari.
- Keluarkan HANYA teks pesannya, tanpa tanda kutip atau penjelasan.`;
}

/**
 * Scheduler follow-up. Dijalankan di proses app (satu container), memindai
 * chat yang jatuh tempo setiap tick.
 *
 * Sengaja tidak memakai cron eksternal: sisa sistem ini juga menghindarinya
 * (kedaluwarsa trial dihitung lazy), dan menambah worker terpisah berarti
 * menambah satu hal lagi yang bisa mati tanpa terlihat.
 */
class FollowUpScheduler {
  /**
   * @param deps.sendMessage async (companyId, chatId, text) => void
   * @param deps.isHumanHandled async (companyId, chatId) => boolean
   * @param deps.generate async (companyId, chatId, prompt) => string|null
   */
  constructor({
    database, logger, deps, intervalMs = 5 * 60_000, batchSize = 25,
    maxPerCompanyPerTick = 3, sendSpacingMs = 1500,
  }) {
    this.database = database;
    this.logger = logger || console;
    this.deps = deps;
    this.intervalMs = intervalMs;
    this.batchSize = batchSize;
    this.maxPerCompanyPerTick = maxPerCompanyPerTick;
    this.sendSpacingMs = sendSpacingMs;
    this.timer = null;
    this.running = false;
  }

  /** Overridable so tests do not have to wait out the spacing delay. */
  sleep(ms) {
    return new Promise((resolve) => { setTimeout(resolve, ms).unref?.(); });
  }

  start() {
    if (this.timer) return;
    this.timer = setInterval(() => { this.tick().catch(() => {}); }, this.intervalMs);
    this.timer.unref?.();
    this.logger.info?.({ intervalMs: this.intervalMs }, 'Follow-up scheduler started');
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /**
   * Satu putaran. Dilindungi flag supaya tick yang lambat tidak menumpuk.
   *
   * Dua rem di sini melindungi NOMOR-nya, bukan tiap chat. `minGapMinutes`
   * hanya menjaga jarak antar pesan ke satu customer; tanpa rem ini, 25 chat
   * yang jatuh tempo bersamaan tetap keluar beruntun dalam hitungan detik dari
   * satu nomor WhatsApp, dan ledakan seperti itulah yang membuat nomor
   * ditandai. Chat yang kena rem tidak hilang — tick berikutnya mengambilnya
   * lagi, karena `listDueFollowUps` tetap mengembalikannya.
   */
  async tick(now = new Date()) {
    if (this.running) return { skipped: 'already_running' };
    this.running = true;
    const result = { sent: 0, stopped: 0, skipped: 0, throttled: 0 };
    const sentPerCompany = new Map();
    try {
      const due = await this.database.listDueFollowUps(this.batchSize);
      for (const row of due) {
        if ((sentPerCompany.get(row.companyId) || 0) >= this.maxPerCompanyPerTick) {
          result.throttled += 1;
          continue;
        }
        try {
          const outcome = await this.processOne(row, now);
          if (outcome.sent) {
            result.sent += 1;
            sentPerCompany.set(row.companyId, (sentPerCompany.get(row.companyId) || 0) + 1);
            if (this.sendSpacingMs > 0) await this.sleep(this.sendSpacingMs);
          } else if (outcome.stopped) result.stopped += 1;
          else result.skipped += 1;
        } catch (err) {
          result.skipped += 1;
          this.logger.warn?.({ err, chatId: row.chatId, companyId: row.companyId },
            'Follow-up failed for one chat');
        }
      }
      if (result.throttled > 0) {
        this.logger.info?.({ throttled: result.throttled, maxPerCompanyPerTick: this.maxPerCompanyPerTick },
          'Tindak lanjut direm agar tidak meledak dari satu nomor; sisanya menunggu tick berikutnya');
      }
    } finally {
      this.running = false;
    }
    return result;
  }

  /**
   * Menyusun satu follow-up TANPA mengirimnya, sekaligus menegakkan semua
   * batas. Dipakai jalur otomatis maupun jalur kirim manual, supaya keduanya
   * tidak bisa menyimpang: kalau plafon habis, tombol manual pun menolak.
   *
   * @returns {{ok: true, text, dayIndex, attemptInDay} |
   *           {ok: false, reason: string, stopped?: boolean}}
   */
  async draft(row, now = new Date()) {
    const verdict = decide(row, now);

    if (verdict.stop) {
      await this.database.stopFollowUpSequence(row.chatId, row.companyId, verdict.stop);
      return { ok: false, reason: verdict.stop, stopped: true };
    }
    if (!verdict.send) return { ok: false, reason: verdict.skip };

    // Agent sudah mengambil alih chat ini: mesin tidak boleh menyerobot.
    if (await this.deps.isHumanHandled(row.companyId, row.chatId)) {
      await this.database.stopFollowUpSequence(row.chatId, row.companyId, 'human_takeover');
      return { ok: false, reason: 'human_takeover', stopped: true };
    }

    // Plafon absolut, dihitung dari baris yang benar-benar ada di
    // follow_up_sends — bukan dari penghitung di follow_up_state. Kalau
    // penghitung itu rusak lagi, batas ini tetap berlaku.
    const alreadySent = await this.database.countFollowUpSends?.(row.chatId, row.companyId)
      ?? null;
    const hardCeiling = row.dayCaps.reduce((total, cap) => total + cap, 0);
    if (alreadySent !== null && alreadySent >= hardCeiling) {
      await this.database.stopFollowUpSequence(row.chatId, row.companyId, 'exhausted');
      return { ok: false, reason: 'exhausted', stopped: true };
    }

    const [previousSends, doc, recentOutbound, company] = await Promise.all([
      this.database.listFollowUpSends(row.chatId, row.companyId),
      this.database.getPlaybookDoc('followup', row.companyId).catch(() => null),
      this.database.listOutboundRepliesForChat?.(row.companyId, row.chatId, 5).catch(() => []) ?? [],
      this.database.getCompanyConfig?.(row.companyId).catch(() => null) ?? null,
    ]);

    const prompt = buildFollowUpPrompt({
      dayIndex: verdict.dayIndex,
      attemptInDay: verdict.attemptInDay,
      dayCaps: row.dayCaps,
      previousSends,
      playbookMd: doc?.contentMd || '',
      recentOutbound,
      checkoutSent: checkoutAlreadySent(recentOutbound, company?.paymentLink || ''),
    });

    const text = await this.deps.generate(row.companyId, row.chatId, prompt);
    // Generator boleh menolak: kalau tidak ada lagi yang layak dikirim, diam
    // lebih baik daripada mengisi plafon dengan pesan kosong.
    if (!text || text.trim().toUpperCase() === 'SKIP') {
      return { ok: false, reason: 'nothing_worth_sending' };
    }
    return { ok: true, text: text.trim(), dayIndex: verdict.dayIndex, attemptInDay: verdict.attemptInDay };
  }

  /**
   * Mengirim teks yang sudah disetujui. Percobaannya dicatat LEBIH DULU.
   *
   * Urutan ini bukan selera. `sendTextForUi` mengirim pesan ke WhatsApp lalu
   * menserialisasi hasilnya di dalam `pupPage.evaluate`; kalau serialisasi itu
   * gagal — dan di produksi ia memang gagal berulang kali — pesannya SUDAH
   * terkirim tetapi pemanggilnya melempar. Dengan urutan lama (kirim dulu,
   * catat kemudian), percobaan itu tidak pernah tercatat, tick berikutnya
   * melihat plafon masih kosong, dan follow-up yang sama dikirim ulang setiap
   * lima menit tanpa henti. Itu benar-benar terjadi: satu customer menerima
   * pesan identik 20 kali.
   *
   * Asimetrinya besar. Percobaan yang tercatat tapi gagal terkirim merugikan
   * satu pesan yang hilang. Percobaan yang terkirim tapi tidak tercatat
   * merugikan pesan berulang tanpa batas ke customer sungguhan — dan reputasi
   * nomor WhatsApp-nya. Jadi kalau harus salah, salah ke arah diam.
   */
  /**
   * Pengiriman yang gagal MENGHENTIKAN rangkaian, bukan menjadwalkan ulang.
   *
   * Insiden 2026-09-14 terjadi persis karena kegagalan diperlakukan sebagai
   * "coba lagi nanti": pesannya sebenarnya terkirim, kegagalannya ada di
   * langkah sesudahnya, dan percobaan ulang tiap lima menit sampai ke customer
   * sebagai pesan berulang. Sebuah tindak lanjut yang hilang tidak merugikan
   * siapa pun; tindak lanjut berulang merugikan customer dan reputasi nomor
   * WhatsApp-nya. Jadi pada keraguan, berhenti.
   *
   * Aturan ini ada di sini, bukan di pemanggilnya, supaya jalur otomatis dan
   * jalur kirim manual tidak bisa menyimpang.
   */
  async send(row, { text, dayIndex, attemptInDay }) {
    await this.database.recordFollowUpSend({
      chatId: row.chatId, dayIndex, attemptInDay, body: text,
    }, row.companyId);
    try {
      await this.deps.sendMessage(row.companyId, row.chatId, text);
    } catch (error) {
      await this.database.stopFollowUpSequence(row.chatId, row.companyId, 'undeliverable')
        .catch(() => {});
      this.logger.warn?.({ err: error, chatId: row.chatId, companyId: row.companyId },
        'Pengiriman tindak lanjut gagal; rangkaian dihentikan alih-alih diulang');
      throw error;
    }
  }

  async processOne(row, now = new Date()) {
    const prepared = await this.draft(row, now);
    if (!prepared.ok) {
      return prepared.stopped ? { stopped: prepared.reason } : { skipped: prepared.reason };
    }

    try {
      await this.send(row, prepared);
    } catch {
      // `send` sudah menghentikan rangkaian dan mencatat alasannya.
      return { stopped: 'undeliverable' };
    }
    return { sent: true, dayIndex: prepared.dayIndex };
  }
}

module.exports = {
  FollowUpScheduler, decide, buildFollowUpPrompt, checkoutAlreadySent,
  withinSendWindow, withManualGap, BUSINESS_TZ, MANUAL_MIN_GAP_MINUTES,
};
