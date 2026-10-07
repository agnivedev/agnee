'use strict';

/**
 * Indikator "sedang mengetik" per provider.
 *
 * Dua provider, dua mekanisme yang jujur berbeda:
 *
 * - whatsapp-web.js: `chat.sendStateTyping()` menyalakan, `chat.clearState()`
 *   memadamkan. Padam sendiri setelah ~25 detik.
 * - Cloud API: satu panggilan yang juga menandai pesan customer SUDAH DIBACA
 *   (centang biru muncul bersamaan). Tidak ada panggilan "padamkan"; ia padam
 *   saat balasan dikirim atau setelah 25 detik. Karena itu `stop` di sini
 *   sengaja kosong.
 *
 * Semuanya kosmetik. Pemanggil membungkusnya `bestEffort`, jadi galat di sini
 * tidak pernah sampai menunda atau menggagalkan balasan.
 */

/**
 * @param opts.provider          'whatsapp_web' | 'cloud_api'
 * @param opts.message           pesan masuk yang dibalas
 * @param opts.sendCloudTyping   async (inboundMessageId) => void
 * @returns {{start: Function, stop: Function} | null}  null = tidak ada yang bisa ditampilkan
 */
function createTypingHooks({ provider, message, sendCloudTyping }) {
  if (provider === 'cloud_api') {
    const inboundId = message?.id?._serialized;
    if (!inboundId || typeof sendCloudTyping !== 'function') return null;
    return {
      start: () => sendCloudTyping(inboundId),
      stop: async () => {},
    };
  }

  if (provider === 'whatsapp_web' && typeof message?.getChat === 'function') {
    let chat = null;
    return {
      start: async () => {
        chat = await message.getChat();
        await chat.sendStateTyping();
      },
      stop: async () => {
        if (chat) await chat.clearState();
      },
    };
  }

  return null;
}

module.exports = { createTypingHooks };
