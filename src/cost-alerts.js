'use strict';

/**
 * Alert biaya AI per perusahaan.
 *
 * Paket Company dan Lifetime menjanjikan pesan AI "tanpa batas", dan satu-satunya
 * pengaman biaya adalah janji pemakaian wajar. Modul ini tidak memotong
 * layanan siapa pun — janji kita justru tidak pernah memutus tiba-tiba. Ia hanya
 * memastikan staf TAHU lebih dulu ketika satu tenant membakar biaya model yang
 * mendekati (atau melewati) pendapatan dari paketnya, sebelum tagihan penyedia
 * model datang.
 *
 * Semua angka untuk manusia dalam Rupiah. OpenRouter menagih dalam USD dan itu
 * yang tersimpan di ai_usage_logs; konversinya memakai satu kurs yang bisa
 * diatur (USD_IDR_RATE), jadi angka Rp di sini adalah perkiraan, bukan tagihan.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/** Selama masih di atas ambang, ingatkan lagi tiap sekian hari — bukan tiap jam. */
const REMINDER_DAYS = 7;

const DEFAULT_USD_IDR_RATE = 16_500;
// Setara kira-kira US$3 dan US$100 pada kurs bawaan.
const DEFAULT_THRESHOLDS_IDR = { personal: 50_000, company: 1_650_000 };

const rupiahFormat = new Intl.NumberFormat('id-ID', { maximumFractionDigits: 0 });

/** Angka positif dari env, atau cadangannya — nilai rusak tidak boleh mematikan alert diam-diam. */
function positiveNumber(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function formatRupiah(value) {
  return `Rp ${rupiahFormat.format(Math.round(Number(value) || 0))}`;
}

function toRupiah(costUsd, rate) {
  return (Number(costUsd) || 0) * rate;
}

/**
 * Ambang per paket. Lifetime berbagi ambang Company: ia memang berisi semua
 * yang ada di Company, jadi biayanya setara, bukan lebih murah.
 */
function thresholdFor(plan, thresholds) {
  return plan === 'personal' ? thresholds.personal : thresholds.company;
}

/**
 * Memilih tenant yang perlu dikabari dan yang perlu "dipersenjatai ulang".
 *
 * - Di atas ambang dan belum pernah dikabari, atau terakhir dikabari sudah
 *   REMINDER_DAYS lalu: kabari.
 * - Sudah di bawah ambang tetapi masih tercatat pernah dikabari: reset, supaya
 *   lonjakan berikutnya dikabari lagi tanpa menunggu pengingat.
 * - Tenant yang sudah ditangguhkan/ditutup dilewati: biayanya tidak bertambah
 *   dan tidak ada yang perlu diputuskan.
 *
 * @returns {{alerts: object[], rearm: string[]}}
 */
function evaluate(rows, { rate, thresholds, now = new Date() }) {
  const alerts = [];
  const rearm = [];
  for (const row of rows) {
    if (row.status && row.status !== 'active') continue;
    const costIdr = toRupiah(row.costUsd30d, rate);
    const thresholdIdr = thresholdFor(row.plan, thresholds);
    const over = costIdr >= thresholdIdr;
    const notifiedAt = row.notifiedAt ? new Date(row.notifiedAt) : null;
    if (over) {
      if (!notifiedAt || now - notifiedAt >= REMINDER_DAYS * DAY_MS) {
        alerts.push({ ...row, costIdr, thresholdIdr, firstTime: !notifiedAt });
      }
    } else if (notifiedAt) {
      rearm.push(row.id);
    }
  }
  alerts.sort((a, b) => b.costIdr / b.thresholdIdr - a.costIdr / a.thresholdIdr);
  return { alerts, rearm };
}

/** Satu email ringkasan per putaran, bukan satu email per tenant. */
function buildEmail(alerts, { consoleUrl }) {
  const count = alerts.length;
  const subject = count === 1
    ? `[Agnee] Biaya AI tinggi: ${alerts[0].name}`
    : `[Agnee] Biaya AI tinggi: ${count} perusahaan melewati ambang`;
  const lines = [
    'Biaya AI 30 hari terakhir melewati ambang untuk perusahaan berikut.',
    'Layanan mereka TIDAK dihentikan. Ini hanya kabar supaya kamu bisa memutuskan lebih dulu.',
    '',
  ];
  for (const row of alerts) {
    const percent = Math.round((row.costIdr / row.thresholdIdr) * 100);
    lines.push(
      `${row.name} (${row.slug})`,
      `  Paket       : ${row.plan}`,
      `  Biaya 30 hr : ${formatRupiah(row.costIdr)}  (${percent}% dari ambang ${formatRupiah(row.thresholdIdr)})`,
      `  Panggilan AI: ${row.calls30d ?? 0}`,
      row.firstTime ? '  Status      : baru melewati ambang' : '  Status      : masih di atas ambang (pengingat mingguan)',
      '',
    );
  }
  lines.push(
    `Buka konsol: ${consoleUrl}`,
    '',
    'Angka Rupiah adalah perkiraan dari biaya USD penyedia model dengan kurs yang diatur di server (USD_IDR_RATE).',
  );
  return { subject, text: lines.join('\n') };
}

/**
 * Pengirim email lewat SMTP. Library-nya dimuat malas supaya proses yang tidak
 * memakai alert (test, mode demo) tidak membayar biaya muat apa pun.
 *
 * `transport` boleh disuntik untuk test; produksi membuatnya dari SMTP_*.
 */
function createMailer(env = process.env, { transport = null } = {}) {
  const to = String(env.COST_ALERT_EMAIL_TO || '').trim();
  const host = String(env.SMTP_HOST || '').trim();
  const from = String(env.SMTP_FROM || env.SMTP_USER || '').trim();
  const configured = Boolean(to && from && (transport || host));
  let cached = transport;

  async function getTransport() {
    if (cached) return cached;
    const nodemailer = require('nodemailer');
    const port = Number(env.SMTP_PORT) || 587;
    cached = nodemailer.createTransport({
      host,
      port,
      // 465 memakai TLS sejak awal; port lain (587) naik ke TLS lewat STARTTLS.
      secure: port === 465,
      auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS || '' } : undefined,
    });
    return cached;
  }

  return {
    configured,
    to,
    async send({ subject, text }) {
      if (!configured) throw new Error('Email alert belum dikonfigurasi');
      const sender = await getTransport();
      await sender.sendMail({ from, to, subject, text });
    },
  };
}

class CostAlertMonitor {
  /**
   * @param {object} options
   * @param options.database   butuh listCostAlertCandidates / markCostAlertNotified / clearCostAlerts
   * @param options.mailer     hasil createMailer
   * @param options.rate       kurs USD→IDR
   * @param options.thresholds { personal, company } dalam Rupiah
   * @param options.consoleUrl alamat konsol platform untuk tautan di email
   */
  constructor({ database, mailer, logger = console, rate, thresholds, consoleUrl, intervalMs = 60 * 60 * 1000 }) {
    this.database = database;
    this.mailer = mailer;
    this.logger = logger;
    this.rate = rate;
    this.thresholds = thresholds;
    this.consoleUrl = consoleUrl;
    this.intervalMs = intervalMs;
    this.running = false;
    this.timer = null;
    this.warnedUnconfigured = false;
  }

  start({ firstDelayMs = 60_000 } = {}) {
    if (this.timer) return;
    this.timer = setInterval(() => { this.check().catch(() => {}); }, this.intervalMs);
    this.timer.unref?.();
    setTimeout(() => { this.check().catch(() => {}); }, firstDelayMs).unref?.();
    this.logger.info?.({ intervalMs: this.intervalMs, emailConfigured: this.mailer.configured },
      'Pemantau biaya AI dimulai');
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /**
   * Satu putaran. Tidak pernah melempar: pemantau yang gagal tidak boleh
   * menjatuhkan proses yang melayani customer.
   */
  async check(now = new Date()) {
    if (this.running) return { skipped: 'already_running' };
    this.running = true;
    try {
      const rows = await this.database.listCostAlertCandidates();
      const { alerts, rearm } = evaluate(rows, { rate: this.rate, thresholds: this.thresholds, now });

      if (rearm.length) await this.database.clearCostAlerts(rearm);
      if (!alerts.length) return { alerts: 0, rearmed: rearm.length };

      if (!this.mailer.configured) {
        // Tidak ditandai terkabari: begitu SMTP dipasang, putaran berikutnya
        // langsung mengirim. Lencana di konsol tetap menampilkannya.
        if (!this.warnedUnconfigured) {
          this.warnedUnconfigured = true;
          this.logger.warn?.({ tenants: alerts.map((a) => a.slug) },
            'Biaya AI melewati ambang tetapi email alert belum dikonfigurasi (COST_ALERT_EMAIL_TO, SMTP_HOST, SMTP_FROM)');
        }
        return { alerts: alerts.length, sent: false, reason: 'not_configured', rearmed: rearm.length };
      }

      const email = buildEmail(alerts, { consoleUrl: this.consoleUrl });
      try {
        await this.mailer.send(email);
      } catch (error) {
        // Gagal kirim = belum terkabari; coba lagi di putaran berikutnya.
        this.logger.warn?.({ err: error }, 'Email alert biaya AI gagal terkirim');
        return { alerts: alerts.length, sent: false, reason: 'send_failed', rearmed: rearm.length };
      }
      await this.database.markCostAlertNotified(alerts.map((a) => a.id));
      this.logger.info?.({ tenants: alerts.map((a) => a.slug) }, 'Email alert biaya AI terkirim');
      return { alerts: alerts.length, sent: true, rearmed: rearm.length };
    } catch (error) {
      this.logger.warn?.({ err: error }, 'Pemeriksaan biaya AI gagal');
      return { error: true };
    } finally {
      this.running = false;
    }
  }
}

module.exports = {
  CostAlertMonitor, positiveNumber, createMailer, evaluate, buildEmail, thresholdFor, toRupiah, formatRupiah,
  REMINDER_DAYS, DEFAULT_USD_IDR_RATE, DEFAULT_THRESHOLDS_IDR,
};
