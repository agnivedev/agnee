'use strict';

/**
 * Mode agent per nomor WhatsApp.
 *
 * Satu company punya banyak nomor dalam satu paket; tiap nomor berperan:
 *  - standard     : perilaku Agnee sebelum ada mode (tidak berubah sama sekali)
 *  - sales        : menggerakkan calon customer ke keputusan beli
 *  - cs           : melayani customer yang sudah ada (bantuan, keluhan, status)
 *  - internal_ops : melayani anggota internal dan supplier. BUKAN customer.
 *
 * Mode disimpan di nomor (whatsapp_connections.agent_mode), bukan di company:
 * satu company boleh menjalankan sales, CS, dan operasi sekaligus. Panduan
 * tambahan per mode ada di agent_mode_instructions (per company).
 *
 * Modul ini murni: tidak membaca database, supaya bisa diuji tanpa server.
 */

const MODES = ['standard', 'sales', 'cs', 'internal_ops'];
const CONFIGURABLE_MODES = ['sales', 'cs', 'internal_ops'];
const INSTRUCTIONS_MAX = 8000;

const META = {
  standard: {
    label: 'Umum (bawaan)',
    description: 'Perilaku Agnee seperti sebelumnya: playbook company apa adanya, tanpa peran khusus.',
    customerFacing: true,
  },
  sales: {
    label: 'Sales',
    description: 'Melayani calon customer: memahami kebutuhan, menjelaskan penawaran, mengarahkan ke keputusan.',
    customerFacing: true,
  },
  cs: {
    label: 'Customer service',
    description: 'Melayani customer yang sudah ada: pertanyaan, keluhan, status, dan tindak lanjut.',
    customerFacing: true,
  },
  internal_ops: {
    label: 'Operasi antar-departemen',
    description: 'Melayani anggota tim dan supplier, bukan customer: menjawab dari pengetahuan, meneruskan ke departemen, melacak permintaan.',
    customerFacing: false,
  },
};

const isMode = (value) => MODES.includes(value);
const normalizeMode = (value) => (isMode(value) ? value : 'standard');
/** Hanya nomor yang melayani customer boleh menerima percakapan customer baru. */
const servesCustomers = (mode) => META[normalizeMode(mode)].customerFacing;

const SALES_BLOCK = `## MODE AGENT: SALES
Nomor ini bertugas sebagai sales. Percakapan di sini umumnya calon customer.
- Pahami dulu kebutuhan dan situasi calon customer sebelum menawarkan apa pun.
- Jelaskan penawaran yang cocok dengan kebutuhan itu, bukan semua yang kita punya.
- Setiap giliran menggerakkan satu langkah ke depan (tanya kebutuhan, jelaskan manfaat, ajak ke langkah berikutnya); jangan menekan.
- Soal keluhan atau masalah akun yang sudah berjalan: akui, lalu serahkan ke tim yang menanganinya, jangan berimprovisasi.`;

const CS_BLOCK = `## MODE AGENT: CUSTOMER SERVICE
Nomor ini bertugas sebagai customer service. Percakapan di sini umumnya customer yang sudah membeli atau sedang memakai layanan.
- Utamakan menyelesaikan masalah dan menjawab pertanyaan dengan benar, bukan menjual.
- Akui dulu kesulitan customer dengan tulus dan singkat, lalu langsung ke solusi atau langkah berikutnya.
- Jangan menawarkan produk atau paket baru kecuali customer sendiri menanyakannya.
- Bila masalah di luar wewenang atau pengetahuanmu, jangan menebak: tanyakan ke yang berwenang atau serahkan ke tim.`;

const OPS_BLOCK = `## MODE AGENT: OPERASI ANTAR-DEPARTEMEN
Nomor ini BUKAN untuk customer. Yang menulis ke sini adalah anggota tim internal atau supplier/mitra yang dikenal. Kamu asisten operasional: membantu pekerjaan, bukan menjual.

Yang kamu lakukan:
- Jawab pertanyaan dari pengetahuan dan playbook yang tersedia. Kalau tidak ada di sana, jangan menebak angka, stok, jadwal, atau kebijakan.
- Kalau jawabannya ada di orang atau departemen lain, tanyakan lewat alat ask_department (hal internal) atau ask_third_party (hal yang diketahui pihak luar), lalu beri tahu pengirim bahwa kamu menanyakannya dan akan mengabari.
- Catat permintaan dengan ringkas: apa yang diminta, untuk siapa, kapan dibutuhkan. Kalau ada yang kurang, tanyakan SATU hal yang paling menentukan, bukan daftar pertanyaan.
- Bahasa lugas dan singkat seperti rekan kerja. Tanpa sapaan jualan, tanpa ajakan membeli, tanpa tawaran paket, tanpa tindak lanjut ala sales.
- Pengirim boleh tahu siapa yang menjawab pertanyaannya (departemen atau pihak terkait) karena ini percakapan internal; tetap sebut hanya yang memang terjadi.
- Kalau ditanya, akui jujur bahwa kamu asisten operasional (bukan manusia).

Batas yang tidak boleh dilanggar:
- Dengan SUPPLIER: jangan membuka harga jual, margin, data atau nama customer, atau strategi internal. Hanya yang perlu untuk pekerjaannya.
- Dengan anggota tim: jangan membagikan data pribadi customer atau informasi antar-departemen yang bukan wewenang pengirim.
- Jangan berjanji atas nama departemen lain (harga, tenggat, persetujuan). Sampaikan hanya jawaban yang memang sudah diberikan.
- Tidak mengarang status: kalau belum ada kabar, katakan belum ada kabar.`;

const BLOCKS = { sales: SALES_BLOCK, cs: CS_BLOCK, internal_ops: OPS_BLOCK };

/**
 * Aturan percakapan untuk operasi internal. Aturan standar Agnee ditulis untuk
 * corong customer (satu ujung, satu ajakan, tawaran, link pembayaran); sebagian
 * salah untuk rekan kerja, jadi mode ini memakai set sendiri yang lebih pendek.
 */
const OPS_CONVERSATION_RULES = `## ATURAN PERCAKAPAN (operasi internal, berlaku selalu)

1. Dokumen dan pengetahuan adalah sumber FAKTA. Angka, nama, jadwal, dan kebijakan wajib persis seperti tertulis; susunan kalimat bebas.
2. Baca riwayat sebelum menjawab. Jangan menanyakan hal yang sudah dijawab pengirim.
3. Jangan memperkenalkan diri lagi kalau percakapan sudah berjalan.
4. Jangan menanyakan apa maksud pengirim ("maksudnya yang mana?"). Kalau kurang jelas, akui, lalu ajukan satu pertanyaan yang spesifik dan mudah dijawab.
5. Setiap pesan dibalas. Balasan pendek seperti "oke" atau "siap" dibalas satu kalimat singkat atau cukup konfirmasi bahwa kamu mencatatnya.
6. Jangan mengulang kalimat yang sama dua kali berturut-turut.
7. Penanda seperti "[Customer mengirim foto]" berarti pengirim mengirim berkas yang TIDAK bisa kamu lihat atau buka. Anggap sudah diterima, jangan berpura-pura tahu isinya, dan minta hal yang kamu butuhkan lewat tulisan.
8. Tiga giliran tanpa kemajuan: berhenti berputar dan sarankan pengirim menghubungi penanggung jawab langsung.`;

/** Ujung prompt, sebelum aturan percakapan: blok mode + panduan tambahan company. */
function modeSection(mode, instructions) {
  const m = normalizeMode(mode);
  const block = BLOCKS[m];
  if (!block) return '';
  const extra = String(instructions || '').trim();
  return extra
    ? `${block}\n\n### Panduan tambahan untuk mode ini (dari company)\n${extra}`
    : block;
}

/** Aturan percakapan yang berlaku untuk mode ini; null = pakai aturan standar. */
function conversationRulesOverride(mode) {
  return normalizeMode(mode) === 'internal_ops' ? OPS_CONVERSATION_RULES : null;
}

/** Baris identitas pengirim untuk mode operasi (dari nomor yang dikenal). */
function senderLine(sender) {
  if (!sender) return '';
  const parts = [`Pengirim pesan ini: ${sender.name}`];
  if (sender.kind === 'member') {
    parts.push(sender.departments?.length ? `anggota tim, departemen ${sender.departments.join(', ')}` : 'anggota tim');
  } else if (sender.kind === 'third_party') {
    parts.push('pihak luar (supplier/mitra)');
  }
  return `## SIAPA YANG MENULIS\n${parts.join(' — ')}.`;
}

/**
 * Kalimat penyusun balasan untuk jawaban departemen pada mode operasi. Beda
 * dengan jalur customer: menyebut siapa yang menjawab boleh, karena penerimanya
 * orang dalam. Yang tetap dilarang: menambah fakta yang tidak ada di jawaban.
 */
function opsRelayPrompt({ senderText, question, answer, by }) {
  return `Rekan kerja sebelumnya menulis: "${senderText}"\nKamu menanyakan: "${question}"\nJawaban${by ? ` dari ${by}` : ''}: "${answer}"\n\nSampaikan jawaban ini kepada rekan kerja tersebut.\n\nAturan keras:\n- Pakai HANYA isi jawaban di atas. Jangan menambah fakta, angka, atau janji.\n- Kalau jawabannya belum pasti ("kurang tahu", "mungkin", "nanti dicek", atau tidak menjawab), keluarkan HANYA tulisan [BELUM_PASTI].\n- Lugas, singkat (1–3 kalimat), tanpa sapaan jualan. Keluarkan HANYA pesannya.`;
}

/**
 * Template bawaan mode operasi antar-departemen. Bentuknya sama dengan potret
 * company_templates.sections sehingga dipasang lewat install() yang sama:
 * menambah departemen (tanpa anggota) dan panduan mode, tidak pernah menghapus.
 * Nomor WhatsApp, anggota, dan identitas AI sengaja tidak disentuh.
 */
const OPS_INSTRUCTIONS_DEFAULT = `PERMINTAAN YANG LAZIM DAN CARA MENANGANINYA

1. Cek stok / ketersediaan barang
   - Jawab dari data yang ada di pengetahuan. Kalau tidak ada, tanyakan ke Procurement lewat ask_department dengan menyebut nama barang dan jumlah.
2. Harga modal, pemasok, waktu pengiriman
   - Ini wewenang Procurement. Tanyakan ke sana; jangan menebak dan jangan membuka ke pihak luar.
3. Spesifikasi atau detail produk
   - Jawab dari playbook. Kalau tidak ada, tanyakan ke Product.
4. Persetujuan, diskon di luar aturan, pengecualian kebijakan
   - Wewenang Management. Tanyakan ke Management; sampaikan keputusannya persis seperti dijawab.
5. Kabar dari supplier (stok bahan, kapasitas, jadwal kirim)
   - Gunakan ask_third_party dengan pertanyaan teknis yang singkat. Jangan menyebut nama customer atau harga jual.
6. Minta status permintaan sebelumnya
   - Jawab dari riwayat percakapan. Kalau belum ada kabar, katakan belum ada kabar dan kapan kamu akan menanyakan lagi bila pengirim minta.

CARA MENULIS
- Satu pesan, satu hal. Tulis langsung ke intinya.
- Bila meneruskan pertanyaan, tulis lengkap: barang/hal yang dimaksud, jumlah atau ukuran, dan kapan dibutuhkan, supaya penjawab tidak perlu bertanya balik.
- Saat menunggu jawaban, katakan sudah ditanyakan dan akan dikabari; jangan menebak sambil menunggu.`;

const OPS_DEPARTMENTS = [
  { name: 'Management', description: 'Keputusan bisnis, persetujuan, kebijakan, dan pengecualian.' },
  { name: 'Product', description: 'Fitur, spesifikasi, ketersediaan, dan detail teknis produk.' },
  { name: 'Procurement', description: 'Stok, pengadaan, harga modal, pemasok, dan waktu pengiriman barang.' },
  { name: 'Gudang & Logistik', description: 'Stok fisik di gudang, pengemasan, pengiriman, dan retur.' },
  { name: 'Finance', description: 'Tagihan, pembayaran, invoice, dan pencocokan transfer.' },
];

const BUILTIN_TEMPLATES = [
  {
    code: 'ops-antar-departemen',
    mode: 'internal_ops',
    name: 'Operasi antar-departemen',
    description: 'Departemen dasar (Management, Product, Procurement, Gudang & Logistik, Finance) dan panduan permintaan internal yang lazim. Anggota departemen tetap diisi sendiri.',
    sections: {
      departments: OPS_DEPARTMENTS,
      modes: { internal_ops: OPS_INSTRUCTIONS_DEFAULT },
    },
  },
];

const getBuiltinTemplate = (code) => BUILTIN_TEMPLATES.find((t) => t.code === code) || null;

module.exports = {
  MODES, CONFIGURABLE_MODES, INSTRUCTIONS_MAX, META, BUILTIN_TEMPLATES,
  isMode, normalizeMode, servesCustomers, modeSection, conversationRulesOverride,
  senderLine, opsRelayPrompt, getBuiltinTemplate,
};
