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
  constructor({ database, logger, deps, intervalMs = 5 * 60_000, batchSize = 25 }) {
    this.database = database;
    this.logger = logger || console;
    this.deps = deps;
    this.intervalMs = intervalMs;
    this.batchSize = batchSize;
    this.timer = null;
    this.running = false;
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

  /** Satu putaran. Dilindungi flag supaya tick yang lambat tidak menumpuk. */
  async tick(now = new Date()) {
    if (this.running) return { skipped: 'already_running' };
    this.running = true;
    const result = { sent: 0, stopped: 0, skipped: 0 };
    try {
      const due = await this.database.listDueFollowUps(this.batchSize);
      for (const row of due) {
        try {
          const outcome = await this.processOne(row, now);
          if (outcome.sent) result.sent += 1;
          else if (outcome.stopped) result.stopped += 1;
          else result.skipped += 1;
        } catch (err) {
          result.skipped += 1;
          this.logger.warn?.({ err, chatId: row.chatId, companyId: row.companyId },
            'Follow-up failed for one chat');
        }
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

  /** Mengirim teks yang sudah disetujui dan mencatatnya. */
  async send(row, { text, dayIndex, attemptInDay }) {
    await this.deps.sendMessage(row.companyId, row.chatId, text);
    await this.database.recordFollowUpSend({
      chatId: row.chatId, dayIndex, attemptInDay, body: text,
    }, row.companyId);
  }

  async processOne(row, now = new Date()) {
    const prepared = await this.draft(row, now);
    if (!prepared.ok) {
      return prepared.stopped ? { stopped: prepared.reason } : { skipped: prepared.reason };
    }
    await this.send(row, prepared);
    return { sent: true, dayIndex: prepared.dayIndex };
  }
}

module.exports = {
  FollowUpScheduler, decide, buildFollowUpPrompt, checkoutAlreadySent,
  withinSendWindow, BUSINESS_TZ,
};
