'use strict';

const { sendCloudApiText, verifyCloudApiCredentials } = require('./cloud-api-sender.js');

/**
 * Thin orchestration around a company's WhatsApp Cloud API credentials and
 * sending. Unlike WhatsappManager there is no persistent client/socket to
 * manage per company — a saved, verified access token *is* "connected", so
 * this never touches Puppeteer/QR concepts at all.
 */
class CloudApiManager {
  constructor(database) {
    this.database = database;
  }

  /** Returns the company's decrypted connection, or null if none configured. */
  async getConnection(companyId) {
    return this.database.getCloudApiConnection(companyId);
  }

  /** Semua nomor milik company — rotator dan UI membacanya dari sini. */
  async listConnections(companyId) {
    return this.database.listCloudApiConnections(companyId);
  }

  /** Verifies the credentials against Meta before persisting them. */
  async connect(companyId, { phoneNumberId, wabaId, accessToken, appSecret, label = null }) {
    const { displayPhoneNumber } = await verifyCloudApiCredentials({ phoneNumberId, accessToken });
    return this.database.upsertCloudApiConnection(companyId, {
      phoneNumberId, wabaId, accessToken, appSecret, displayPhoneNumber, label,
    });
  }

  /**
   * Nomor mana yang dipakai untuk satu percakapan.
   *
   * Rotasi hanya berlaku untuk percakapan BARU. Begitu sebuah percakapan
   * menempel pada satu nomor, ia tetap di nomor itu selamanya — termasuk kalau
   * nomor itu sudah dinonaktifkan. Di sisi customer, balasan dari nomor lain
   * bukan kelanjutan percakapan melainkan chat baru dari nomor asing, dan
   * riwayatnya pecah.
   *
   * Untuk percakapan baru, dipilih nomor aktif dengan percakapan paling
   * sedikit — bukan round-robin berbasis urutan — supaya nomor yang ditambah
   * belakangan ikut menyerap beban, bukan menunggu gilirannya.
   */
  async pickConnectionForChat(companyId, chatId) {
    const attached = await this.database.getCloudChatNumber(companyId, chatId);
    if (attached) return attached;

    const counts = await this.database.countCloudChatsPerConnection(companyId);
    if (!counts.length) return null;

    const all = await this.database.listCloudApiConnections(companyId);
    const chosen = all.find((row) => row.id === counts[0].id);
    if (!chosen) return null;

    await this.database.assignCloudChatNumber(companyId, chatId, chosen.id);
    // Dua pengiriman bersamaan untuk percakapan baru yang sama bisa memilih
    // nomor berbeda; INSERT yang pertama menang. Baca ulang supaya kedua jalur
    // memakai pemenang yang sama, bukan pilihannya sendiri.
    return (await this.database.getCloudChatNumber(companyId, chatId)) || chosen;
  }

  /**
   * Tempelkan percakapan ke nomor yang MENERIMA pesan masuk. Ini sumber
   * kebenaran yang paling kuat: customer memang sedang bicara ke nomor itu.
   */
  async attachInbound(companyId, chatId, connectionId) {
    return this.database.assignCloudChatNumber(companyId, chatId, connectionId);
  }

  async sendText(companyId, chatId, text) {
    const connection = await this.pickConnectionForChat(companyId, chatId);
    if (!connection) throw new Error('Company has no WhatsApp Cloud API connection configured');
    return sendCloudApiText({ phoneNumberId: connection.phoneNumberId, accessToken: connection.accessToken, to: chatId, text });
  }
}

module.exports = { CloudApiManager };
