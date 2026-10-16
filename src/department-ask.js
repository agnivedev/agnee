'use strict';

/**
 * AI bertanya ke departemen: bila jawaban tidak ada di playbook/pengetahuan,
 * AI tidak boleh menebak. Ia memanggil alat `ask_department`, semua anggota
 * departemen diberi tahu, dan customer diberi kalimat tunggu yang jujur.
 */

const QUESTION_MAX = 600;

// Cadangan bila model lupa menulis kalimat tunggu setelah memanggil alat.
const HOLDING_FALLBACK = (department) =>
  `Baik kak, untuk hal ini saya konfirmasikan dulu ke tim ${department} kami ya. Mohon ditunggu sebentar, begitu ada jawabannya langsung saya kabari kakak 🙏`;

// Setelah batas waktu tanpa jawaban: jujur, tidak menebak, tidak menjanjikan waktu.
const EXPIRED_FALLBACK = 'Kak, mohon maaf, jawaban dari tim kami belum masuk. Pertanyaan kakak sudah kami catat dan akan ditindaklanjuti langsung oleh tim. Terima kasih sudah menunggu 🙏';

function guide(departments) {
  const list = departments.map((d) => `- ${d.name}${d.description ? `: ${d.description}` : ''}`).join('\n');
  return `## BERTANYA KE DEPARTEMEN INTERNAL (alat ask_department)
Kalau customer menanyakan sesuatu yang jawabannya TIDAK ada di playbook, FAQ, atau pengetahuan di atas, JANGAN menebak, mengarang angka, stok, harga, jadwal, atau kebijakan. Panggil alat ask_department ke departemen yang paling berwenang, lalu beri tahu customer bahwa kamu sedang mengonfirmasi.

Departemen yang tersedia:
${list}

Aturan:
- Pilih SATU departemen yang paling relevan. Tulis pertanyaan yang singkat, lengkap, dan bisa dijawab tanpa membaca chat (sebut produk/hal yang dimaksud). Jangan menyertakan nomor telepon atau data pribadi customer.
- Setelah alat dipanggil, balas customer dengan 1–2 kalimat sesuai persona: katakan kamu konfirmasikan dulu ke tim terkait, minta ditunggu sebentar, dan bahwa kamu akan kabari begitu ada jawabannya. Contoh nada: "Baik kak, untuk itu saya konfirmasikan dulu ke tim Product kami ya. Mohon ditunggu sebentar, begitu ada jawabannya langsung saya kabari 🙏". Jangan menyebut kata "AI", "alat", atau "sistem", dan jangan menjanjikan jam atau durasi tertentu.
- Jangan bertanya ke departemen untuk hal yang sudah ada jawabannya di pengetahuan, dan jangan memanggil alat dua kali untuk pertanyaan yang sama.
- Setelah alat dipanggil, jangan memberi jawaban tebakan sambil menunggu.`;
}

function toolSpec({ departments, run }) {
  const names = departments.map((d) => d.name);
  return {
    name: 'ask_department',
    description: 'Tanya ke departemen internal (semua anggotanya diberi tahu) saat jawaban untuk customer tidak ada di pengetahuan. Jawaban datang belakangan; balas customer dengan kalimat tunggu.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['department', 'question'],
      properties: {
        department: { type: 'string', enum: names, description: 'Nama departemen yang paling berwenang.' },
        question: { type: 'string', maxLength: QUESTION_MAX, description: 'Pertanyaan singkat yang bisa dipahami tanpa membaca chat.' },
      },
    },
    run,
  };
}

/** Pesan WhatsApp ke anggota departemen. */
function buildQuestionNotice({ department, question, customerLabel }) {
  const cut = (v, n) => { const t = String(v || '').replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };
  return [
    `*Pertanyaan dari asisten untuk tim ${department}*`,
    `Customer: ${customerLabel}`,
    `Pertanyaan: "${cut(question, 500)}"`,
    '',
    'Mohon dijawab lewat Agnee (menu Pertanyaan AI). Jawaban pertama yang masuk akan diteruskan ke customer.',
  ].join('\n');
}

/** Perintah ke model untuk menyusun balasan ke customer dari jawaban departemen. */
function relayPrompt({ customerText, question, answer, department }) {
  return `Customer sebelumnya menulis: "${customerText}"\nKamu lalu menanyakan ke tim ${department}: "${question}"\nJawaban dari tim: "${answer}"\n\nTulis balasan ke customer dengan persona kamu berdasarkan jawaban tim itu. Pakai HANYA isi jawaban tim — jangan menambah fakta, angka, atau janji yang tidak ada di sana. Singkat dan ramah, tanpa menyebut "tim internal menjawab" secara kaku. Keluarkan HANYA pesannya.`;
}

module.exports = { guide, toolSpec, buildQuestionNotice, relayPrompt, HOLDING_FALLBACK, EXPIRED_FALLBACK, QUESTION_MAX };
