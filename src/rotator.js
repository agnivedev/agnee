'use strict';

/**
 * Rotasi nomor WhatsApp: nomor mana yang dipakai untuk percakapan BARU.
 *
 * Dua aturan yang menentukan seluruh bentuk modul ini:
 *
 * 1. **Percakapan yang sudah menempel tidak pernah dipindah.** Di sisi customer,
 *    balasan yang datang dari nomor lain adalah chat baru dari orang asing dan
 *    riwayatnya pecah. Karena itu modul ini hanya memilih untuk percakapan yang
 *    belum punya nomor; yang sudah punya tidak pernah lewat sini.
 *
 * 2. **Yang dipilih harus nomor yang benar-benar bisa mengirim sekarang.**
 *    Sebelum ini penyaringnya hanya `is_active`, jadi percakapan baru bisa
 *    menempel permanen ke nomor yang sedang menunggu QR atau terputus — dan
 *    karena aturan pertama, percakapan itu tidak akan pernah bisa dibalas.
 *
 * Fungsinya murni: kesiapan nomor dioper sebagai `siapKirim`, bukan dibaca
 * sendiri dari manager, supaya bisa diuji tanpa menyalakan WhatsApp.
 */

/**
 * @param {object} arg
 * @param {Array<{id: string, chatCount: number}>} arg.counts  nomor aktif, urut dari beban paling ringan
 * @param {Array<{id: string}>} arg.connections                seluruh nomor milik company
 * @param {{id: string}|null} arg.primary                      nomor utama
 * @param {boolean} arg.rotationEnabled                        saklar rotasi company
 * @param {(id: string) => boolean} arg.siapKirim              nomor ini siap mengirim sekarang?
 * @returns {{nomor: object|null, alasan: string}}
 */
function pilihNomorUntukPercakapanBaru({
  counts = [],
  connections = [],
  primary = null,
  rotationEnabled = true,
  siapKirim = () => false,
}) {
  if (rotationEnabled) {
    // `counts` sudah urut dari beban paling ringan, jadi yang pertama lolos
    // adalah yang paling ringan DI ANTARA yang siap — nomor yang ditambah
    // belakangan tetap langsung menyerap percakapan baru.
    for (const baris of counts) {
      const kandidat = connections.find((row) => row.id === baris.id);
      if (kandidat && siapKirim(kandidat.id)) {
        return { nomor: kandidat, alasan: 'beban-paling-ringan' };
      }
    }
  }

  // Rotasi mati, atau tidak ada kandidat yang siap: jatuh ke nomor utama —
  // tapi hanya kalau nomor utamanya sendiri siap.
  if (primary?.id && siapKirim(primary.id)) {
    return { nomor: primary, alasan: rotationEnabled ? 'hanya-utama-yang-siap' : 'rotasi-mati' };
  }

  // Tidak ada yang bisa mengirim. Sengaja TIDAK menempelkan percakapan ke nomor
  // mana pun: tempelan tidak pernah bisa dicabut, jadi menempel ke nomor mati
  // sekarang berarti percakapan ini tidak akan pernah bisa dibalas walau nanti
  // ada nomor sehat. Lebih baik gagal sekarang dan menempel saat dicoba lagi.
  return { nomor: null, alasan: 'tidak-ada-yang-siap' };
}

module.exports = { pilihNomorUntukPercakapanBaru };
