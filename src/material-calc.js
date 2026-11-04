'use strict';

/**
 * Alat hitung_kebutuhan: perkiraan kebutuhan material bangunan dari luas.
 *
 * Customer yang bertanya "luas 60m² butuh berapa zak?" harus mendapat ANGKA
 * saat itu juga. Sebelumnya AI menunda ("saya pastikan dulu") dan hanya
 * bertanya balik kemasan, jadi hitungannya terlewat. Yang benar: hitung dulu
 * dengan koefisien SNI 2835:2008 / 7394:2008 (pasangan bata dan plesteran),
 * sebut asumsinya, BARU tanyakan hal yang menentukan ketepatan (luas itu
 * lantai atau dinding, tebal, kemasan).
 *
 * Angka per 1 m² (campuran 1PC:4PS, bata merah 1/2 bata):
 *   pasang bata : 70 bata, 11,5 kg semen, 0,043 m³ pasir
 *   plester t=15mm : 6,24 kg semen, 0,024 m³ pasir
 *   acian : 3,25 kg semen
 */

const TOOL_NAME = 'hitung_kebutuhan';

const WORK = {
  pasang_bata: { label: 'pasang bata merah (1/2 bata, campuran 1:4)', bata: 70, semenKg: 11.5, pasirM3: 0.043 },
  plester: { label: 'plester dinding (tebal 15 mm, campuran 1:4, satu sisi)', semenKg: 6.24, pasirM3: 0.024 },
  acian: { label: 'acian (satu sisi)', semenKg: 3.25 },
};

// Luas dinding rumah kira-kira 2,5x luas lantai (dinding luar+sekat, tinggi ±3 m, dikurangi bukaan).
const WALL_PER_FLOOR = 2.5;
const WASTE = 1.05;

const GUIDE = `## HITUNG KEBUTUHAN MATERIAL (alat ${TOOL_NAME})
- Kalau customer menyebut luas atau volume pekerjaan lalu bertanya butuh berapa (zak semen, bata, pasir), panggil ${TOOL_NAME} DI TURN YANG SAMA. Itu hitungan, bukan fakta yang harus ditanyakan ke departemen: JANGAN memanggil ask_department dan JANGAN menulis "saya pastikan dulu" / "mohon ditunggu" untuk hitungan ini.
- Balasan harus memuat angka hasil alat (perkiraan zak untuk kemasan yang ada di katalog, dan bata/pasir bila relevan), dengan kata "perkiraan" dan asumsi singkatnya. Jangan membuat hitungan sendiri di luar alat.
- SETELAH angkanya, tetap tanyakan SATU hal yang paling menentukan ketepatan (mis. luas 60 m² itu luas bangunan atau luas dindingnya, atau kemasan yang diinginkan). Menanyakan tidak boleh menggantikan menghitung.
- Pakai harga dari katalog/cek_harga untuk kemasan yang dihitung; jangan mengarang harga. Total harga hanya bila harganya sudah ada dari sumber itu.`;

function toolSpec({ run = calculate } = {}) {
  return {
    name: TOOL_NAME,
    description: 'Hitung perkiraan kebutuhan semen (zak 40/50 kg), bata, dan pasir untuk pekerjaan bangunan dari luas. Panggil saat customer menanyakan butuh berapa.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['pekerjaan', 'luas_m2'],
      properties: {
        pekerjaan: { type: 'string', enum: Object.keys(WORK), description: 'pasang_bata, plester, atau acian.' },
        luas_m2: { type: 'number', minimum: 0.1, maximum: 100000, description: 'Luas dalam m² seperti disebut customer.' },
        jenis_luas: { type: 'string', enum: ['dinding', 'bangunan'], description: '"dinding" bila customer menyebut luas dinding/pasangan; "bangunan" bila luas rumah/lantai; bila tidak jelas pakai "bangunan".' },
      },
    },
    run,
  };
}

const round1 = (n) => Math.round(n * 10) / 10;

function calculate(args = {}) {
  const work = WORK[args.pekerjaan];
  const luas = Number(args.luas_m2);
  if (!work || !Number.isFinite(luas) || luas <= 0) return { status: 'gagal', error: 'Pekerjaan atau luas tidak valid.' };
  const fromBuilding = args.jenis_luas !== 'dinding';
  const wall = fromBuilding ? luas * WALL_PER_FLOOR : luas;
  const semenKg = wall * work.semenKg * WASTE;
  const out = {
    status: 'ok',
    pekerjaan: work.label,
    luas_dinding_m2: round1(wall),
    semen_kg: Math.ceil(semenKg),
    zak_40kg: Math.ceil(semenKg / 40),
    zak_50kg: Math.ceil(semenKg / 50),
    asumsi: [
      'perkiraan koefisien SNI, termasuk cadangan 5%',
      fromBuilding
        ? `luas ${luas} m² dianggap luas bangunan, dinding ≈ ${WALL_PER_FLOOR}x luasnya (${round1(wall)} m²)`
        : `luas ${luas} m² dianggap luas dinding`,
    ],
    perlu_ditanyakan: fromBuilding
      ? 'apakah luas itu luas bangunan atau luas dindingnya; bila dinding sudah diketahui, hitungan jadi lebih tepat'
      : null,
  };
  if (work.bata) out.bata_buah = Math.ceil(wall * work.bata * WASTE);
  if (work.pasirM3) out.pasir_m3 = round1(wall * work.pasirM3 * WASTE);
  return out;
}

module.exports = { TOOL_NAME, GUIDE, toolSpec, calculate, WORK };
