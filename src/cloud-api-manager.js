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

  /** Verifies the credentials against Meta before persisting them. */
  async connect(companyId, { phoneNumberId, wabaId, accessToken, appSecret }) {
    const { displayPhoneNumber } = await verifyCloudApiCredentials({ phoneNumberId, accessToken });
    return this.database.upsertCloudApiConnection(companyId, {
      phoneNumberId, wabaId, accessToken, appSecret, displayPhoneNumber,
    });
  }

  async sendText(companyId, chatId, text) {
    const connection = await this.getConnection(companyId);
    if (!connection) throw new Error('Company has no WhatsApp Cloud API connection configured');
    return sendCloudApiText({ phoneNumberId: connection.phoneNumberId, accessToken: connection.accessToken, to: chatId, text });
  }
}

module.exports = { CloudApiManager };
