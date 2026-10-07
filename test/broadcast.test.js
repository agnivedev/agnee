'use strict';

/**
 * Broadcast: yang dijaga di sini adalah perilakunya terhadap customer dan
 * nomor WhatsApp — pesan yang keluar terlalu rapat, di luar jam, dua kali ke
 * orang yang sama, atau ke orang yang sudah membalas STOP.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  TEMPO, KALIMAT_BERHENTI, GAGAL_BERUNTUN_MAKS,
  namaUntukSapaan, susunPesan, mintaBerhenti, dalamJamKirim, awalHariLokal, jedaSetelah, putaranBroadcast,
  periksaVariasi,
} = require('../src/broadcast');

const JKT = 'Asia/Jakarta';
// 2026-10-07 Rabu, Asia/Jakarta = UTC+7.
const jamJakarta = (jam, menit = 0) => Date.UTC(2026, 9, 7, jam - 7, menit);

test('{nama} diganti nama yang bisa dibaca, atau "Kak"', () => {
  assert.equal(susunPesan('Halo {nama}, promo hari ini.', 'Budi', false), 'Halo Budi, promo hari ini.');
  assert.equal(susunPesan('Halo { NAMA }!', '~ Sari 🌸 ~', false), 'Halo Sari!');
  assert.equal(susunPesan('Halo {nama}!', '🦋🦋', false), 'Halo Kak!');
  assert.equal(susunPesan('Halo {nama}!', null, false), 'Halo Kak!');
  assert.equal(namaUntukSapaan('a'.repeat(80)).length, 40);
});

test('kalimat cara berhenti ditempel hanya kalau diminta', () => {
  assert.equal(susunPesan('Promo', 'Budi', true), `Promo\n\n${KALIMAT_BERHENTI}`);
  assert.equal(susunPesan('Promo', 'Budi', false), 'Promo');
});

test('STOP hanya dikenali sebagai satu kata utuh', () => {
  for (const kata of ['STOP', 'stop', ' Stop. ', 'berhenti', 'BERHENTI!', 'unsubscribe']) {
    assert.equal(mintaBerhenti(kata), true, kata);
  }
  // Percakapan biasa yang kebetulan memuat kata itu bukan permintaan keluar.
  for (const kalimat of ['stop dulu ya kak', 'jangan berhenti kirim info', 'stopkontak', '', null]) {
    assert.equal(mintaBerhenti(kalimat), false, String(kalimat));
  }
});

test('jam kirim dihitung di zona company, bukan zona server', () => {
  assert.equal(dalamJamKirim(jamJakarta(7, 59), JKT), false);
  assert.equal(dalamJamKirim(jamJakarta(8), JKT), true);
  assert.equal(dalamJamKirim(jamJakarta(19, 59), JKT), true);
  assert.equal(dalamJamKirim(jamJakarta(20), JKT), false);
  // Zona yang tidak dikenal tidak menghentikan pengirim; jatuh ke Jakarta.
  assert.equal(dalamJamKirim(jamJakarta(9), 'Bukan/Zona'), true);
  assert.equal(awalHariLokal(jamJakarta(15), JKT).toISOString(), '2026-10-06T17:00:00.000Z');
});

test('jarak antar pesan acak tapi selalu di dalam rentang', () => {
  const tempo = TEMPO.whatsapp_web;
  const hasil = new Set();
  for (let i = 0; i < 200; i += 1) {
    const jeda = jedaSetelah(1_759_800_000_000 + i * 37_123, tempo);
    assert.ok(jeda >= tempo.jedaMinMs && jeda <= tempo.jedaMaksMs, String(jeda));
    hasil.add(jeda);
  }
  assert.ok(hasil.size > 50, 'jarak yang selalu sama adalah ciri mesin');
});

/** Database palsu: cukup untuk menguji keputusan putaran, bukan SQL-nya. */
function fakeDatabase({ companies, recipients = [], sentToday = 0, trailingFailures = 0 }) {
  const log = { claimed: [], marked: [], released: [], paused: [], finished: [] };
  const queue = [...recipients];
  return {
    log,
    async markStaleBroadcastClaims() { return []; },
    async activateDueBroadcasts() { return []; },
    async listCompaniesWithSendingBroadcasts() { return companies; },
    async countBroadcastSentSince() { return sentToday; },
    async skipOptedOutBroadcastRecipients() { return []; },
    async claimNextBroadcastRecipient(companyId) {
      const index = queue.findIndex((row) => row.companyId === companyId);
      if (index < 0) return null;
      const [row] = queue.splice(index, 1);
      log.claimed.push(row);
      return row;
    },
    async markBroadcastRecipient(id, companyId, outcome) { log.marked.push({ id, companyId, ...outcome }); },
    async releaseBroadcastRecipient(id) { log.released.push(id); },
    async pauseBroadcast(broadcastId, companyId, reason) { log.paused.push({ broadcastId, reason }); },
    async countTrailingBroadcastFailures() { return trailingFailures; },
    async finishDrainedBroadcasts(companyId) { log.finished.push(companyId); return [{ broadcastId: `b-${companyId}` }]; },
  };
}

const penerima = (id, companyId = 'c1') => ({
  id, companyId, broadcastId: `b-${companyId}`, chatId: `62812${id}@c.us`, name: 'Budi',
  body: 'Halo {nama}', optOutFooter: true,
});

test('satu pesan per company per putaran, dengan nama terisi', async () => {
  const db = fakeDatabase({
    companies: [
      { companyId: 'c1', timezone: JKT, provider: 'whatsapp_web', lastSentAt: null },
      { companyId: 'c2', timezone: JKT, provider: 'whatsapp_web', lastSentAt: null },
    ],
    recipients: [penerima(1), penerima(2), penerima(3, 'c2')],
  });
  const terkirim = [];
  const hasil = await putaranBroadcast({
    database: db, sekarangMs: jamJakarta(10),
    kirim: async (companyId, chatId, teks) => { terkirim.push({ companyId, chatId, teks }); return { messageId: 'm' }; },
  });
  assert.equal(hasil.terkirim, 2);
  assert.deepEqual(terkirim.map((row) => row.companyId), ['c1', 'c2']);
  assert.equal(terkirim[0].teks, `Halo Budi\n\n${KALIMAT_BERHENTI}`);
  assert.deepEqual(db.log.marked.map((row) => row.status), ['sent', 'sent']);
});

test('tidak mengirim di luar jam, sebelum jaraknya lewat, atau setelah plafon harian', async () => {
  const kirim = async () => { throw new Error('tidak boleh mengirim'); };
  const company = { companyId: 'c1', timezone: JKT, provider: 'whatsapp_web', lastSentAt: null };

  const malam = fakeDatabase({ companies: [company], recipients: [penerima(1)] });
  await putaranBroadcast({ database: malam, kirim, sekarangMs: jamJakarta(21) });
  assert.equal(malam.log.claimed.length, 0);

  const barusan = fakeDatabase({
    companies: [{ ...company, lastSentAt: new Date(jamJakarta(10) - 5_000).toISOString() }],
    recipients: [penerima(1)],
  });
  await putaranBroadcast({ database: barusan, kirim, sekarangMs: jamJakarta(10) });
  assert.equal(barusan.log.claimed.length, 0);

  const penuh = fakeDatabase({ companies: [company], recipients: [penerima(1)], sentToday: TEMPO.whatsapp_web.plafonHarian });
  await putaranBroadcast({ database: penuh, kirim, sekarangMs: jamJakarta(10) });
  assert.equal(penuh.log.claimed.length, 0);
});

test('nomor terputus: penerima kembali ke antrean dan broadcast dijeda', async () => {
  const db = fakeDatabase({
    companies: [{ companyId: 'c1', timezone: JKT, provider: 'whatsapp_web', lastSentAt: null }],
    recipients: [penerima(1)],
  });
  const putus = Object.assign(new Error('Belum ada nomor WhatsApp yang siap mengirim.'), { statusCode: 409 });
  const hasil = await putaranBroadcast({ database: db, sekarangMs: jamJakarta(10), kirim: async () => { throw putus; } });
  assert.equal(hasil.dijeda, 1);
  assert.deepEqual(db.log.released, [1]);
  assert.equal(db.log.marked.length, 0, 'penerimanya tidak boleh tercatat gagal');
  assert.match(db.log.paused[0].reason, /siap mengirim/);
});

test('gagal biasa dicatat per penerima; gagal beruntun menjeda broadcast', async () => {
  const company = { companyId: 'c1', timezone: JKT, provider: 'whatsapp_web', lastSentAt: null };
  const kirim = async () => { throw new Error('Conversation is unavailable'); };

  const sekali = fakeDatabase({ companies: [company], recipients: [penerima(1)], trailingFailures: 1 });
  await putaranBroadcast({ database: sekali, sekarangMs: jamJakarta(10), kirim });
  assert.equal(sekali.log.marked[0].status, 'failed');
  assert.match(sekali.log.marked[0].error, /tidak ada lagi di WhatsApp/, 'error yang dikenal diterjemahkan');
  assert.equal(sekali.log.paused.length, 0);

  const beruntun = fakeDatabase({ companies: [company], recipients: [penerima(1)], trailingFailures: GAGAL_BERUNTUN_MAKS });
  await putaranBroadcast({ database: beruntun, sekarangMs: jamJakarta(10), kirim });
  assert.equal(beruntun.log.paused.length, 1);
});

test('antrean kosong menutup broadcast-nya', async () => {
  const db = fakeDatabase({ companies: [{ companyId: 'c1', timezone: JKT, provider: 'whatsapp_web', lastSentAt: null }] });
  const hasil = await putaranBroadcast({ database: db, sekarangMs: jamJakarta(10), kirim: async () => ({}) });
  assert.equal(hasil.selesai, 1);
  assert.deepEqual(db.log.finished, ['c1']);
});

const ASLI = 'Halo {nama}, kelas November dibuka. Diskon 20% sampai 31/10, daftar di https://agnive.co/kelas?ref=wa sebelum jam 20:00.';

test('variasi yang faktanya utuh diterima, bungkus kutipnya dibuang', () => {
  const variasi = '"Hai {nama}, kelas bulan November sudah buka. Ada diskon 20% sampai 31/10, daftarnya di https://agnive.co/kelas?ref=wa sebelum jam 20:00."';
  assert.equal(periksaVariasi(ASLI, variasi), variasi.slice(1, -1));
});

test('padanan batas waktu yang setara tetap diterima', () => {
  assert.ok(periksaVariasi(ASLI, ASLI.replace('sampai 31/10', 'hingga 31/10')));
});

test('variasi yang mengubah fakta ditolak', () => {
  const kasus = {
    'diskon berubah': ASLI.replace('20%', '25%'),
    'diskon hilang': ASLI.replace('Diskon 20% ', ''),
    'tanggal berubah': ASLI.replace('31/10', '30/10'),
    // "sebelum 31" tidak termasuk tanggal 31; "sampai 31" termasuk.
    'sampai jadi sebelum': ASLI.replace('sampai 31/10', 'sebelum 31/10'),
    'jam berubah': ASLI.replace('20:00', '21:00'),
    'link berubah': ASLI.replace('?ref=wa', ''),
    'link tambahan': `${ASLI} Info: https://contoh.com`,
    '{nama} hilang': ASLI.replace('{nama}', 'Kak'),
    '{nama} dobel': `${ASLI} Ditunggu ya {nama}.`,
    'terlalu panjang': `${ASLI} ${'Jangan sampai ketinggalan kesempatan emas ini. '.repeat(3)}`,
    'terlalu pendek': 'Halo {nama}, 20% 31/10 https://agnive.co/kelas?ref=wa 20:00',
    'kosong': '   ',
  };
  for (const [nama, variasi] of Object.entries(kasus)) {
    assert.equal(periksaVariasi(ASLI, variasi), null, nama);
  }
});

test('variasi AI dipakai kalau lolos, pesan asli kalau tidak', async () => {
  const company = { companyId: 'c1', timezone: JKT, provider: 'whatsapp_web', lastSentAt: null };
  const dengan = (body) => ({ ...penerima(1), body, aiVariation: true });
  const terkirim = [];
  const kirim = async (_c, _chat, teks) => { terkirim.push(teks); return { messageId: 'm' }; };

  const lolos = fakeDatabase({ companies: [company], recipients: [dengan('Halo {nama}, promo 20% hari ini.')] });
  await putaranBroadcast({
    database: lolos, sekarangMs: jamJakarta(10), kirim,
    variasikan: async () => 'Hai {nama}, hari ini ada promo 20%.',
  });
  assert.equal(terkirim[0], `Hai Budi, hari ini ada promo 20%.\n\n${KALIMAT_BERHENTI}`);
  assert.equal(lolos.log.marked[0].sentBody, terkirim[0], 'teks yang terkirim disimpan apa adanya');

  const curang = fakeDatabase({ companies: [company], recipients: [dengan('Halo {nama}, promo 20% hari ini.')] });
  await putaranBroadcast({
    database: curang, sekarangMs: jamJakarta(10), kirim,
    variasikan: async () => 'Hai {nama}, hari ini ada promo 50%.',
  });
  assert.equal(terkirim[1], `Halo Budi, promo 20% hari ini.\n\n${KALIMAT_BERHENTI}`);

  const gagal = fakeDatabase({ companies: [company], recipients: [dengan('Halo {nama}, promo 20% hari ini.')] });
  await putaranBroadcast({
    database: gagal, sekarangMs: jamJakarta(10), kirim,
    variasikan: async () => { throw new Error('model mati'); },
  });
  assert.equal(terkirim[2], `Halo Budi, promo 20% hari ini.\n\n${KALIMAT_BERHENTI}`);
  assert.equal(gagal.log.marked[0].status, 'sent', 'AI gagal tidak boleh menggagalkan pengiriman');
});

test('tanpa saklar variasi, AI tidak dipanggil', async () => {
  const db = fakeDatabase({
    companies: [{ companyId: 'c1', timezone: JKT, provider: 'whatsapp_web', lastSentAt: null }],
    recipients: [penerima(1)],
  });
  let dipanggil = 0;
  await putaranBroadcast({
    database: db, sekarangMs: jamJakarta(10), kirim: async () => ({}),
    variasikan: async () => { dipanggil += 1; return 'x'; },
  });
  assert.equal(dipanggil, 0, 'tiap panggilan memotong kuota AI company');
});
