'use strict';

const fs = require('node:fs');
const path = require('node:path');

class KnowledgeBase {
  constructor(options = {}) {
    this.clientId = options.clientId || process.env.KNOWLEDGE_CLIENT || 'bzone';
    this.clientProfile = null;
    this.faqDatabase = new Map();
    this.funnelRules = null;
    this.replyPolicy = null;
    this.loaded = false;
  }

  async load() {
    const knowledgeDir = path.join(__dirname, '..', 'knowledge', 'clients', this.clientId);

    if (!fs.existsSync(knowledgeDir)) {
      console.warn('Knowledge base directory not found');
      return;
    }

    try {
      const profileFile = path.join(knowledgeDir, 'tenant.json');
      if (fs.existsSync(profileFile)) {
        this.clientProfile = JSON.parse(fs.readFileSync(profileFile, 'utf8'));
      }

      // Load FAQ files
      const faqDir = path.join(knowledgeDir, 'faq');
      if (fs.existsSync(faqDir)) {
        // Diurutkan eksplisit: urutan sisip ke faqDatabase menentukan pemenang
        // saat dua FAQ punya skor sama di findRelevantFaq(), dan readdirSync
        // tidak menjamin urutan apa pun. macOS dan overlayfs di container
        // kebetulan sama-sama mengembalikan alfabetis sekarang, jadi ini tidak
        // mengubah peringkat — hanya memastikan hasilnya tidak bergantung pada
        // filesystem.
        for (const file of fs.readdirSync(faqDir).sort()) {
          if (file.endsWith('.md')) {
            const content = fs.readFileSync(path.join(faqDir, file), 'utf8');
            this.parseFaqFile(content, file);
          }
        }
      }

      // Load funnel playbook
      const funnelFile = path.join(knowledgeDir, 'funnel', 'sales-funnel.md');
      if (fs.existsSync(funnelFile)) {
        this.funnelRules = fs.readFileSync(funnelFile, 'utf8');
      }

      // Load reply policy
      const policyFile = path.join(knowledgeDir, 'policies', 'reply-policy.md');
      if (fs.existsSync(policyFile)) {
        this.replyPolicy = fs.readFileSync(policyFile, 'utf8');
      }

      this.loaded = true;
      console.log(`✓ Knowledge base loaded: ${this.clientId} (${this.faqDatabase.size} FAQ entries)`);
    } catch (err) {
      console.error('Failed to load knowledge base:', err.message);
    }
  }

  parseFaqFile(content, filename) {
    const lines = content.split('\n');
    let currentFaqId = null;
    let currentIntent = [];
    let currentAnswer = '';
    let activeField = null; // which bold field continuation lines belong to

    const flush = () => {
      if (currentFaqId && currentAnswer) {
        this.faqDatabase.set(currentFaqId, {
          id: currentFaqId,
          intent: currentIntent,
          answer: currentAnswer.trim(),
          source: filename,
        });
      }
    };

    for (const line of lines) {
      // Match FAQ ID (e.g., ## FAQ-PRODUCT-001)
      if (line.match(/^##\s+FAQ-[A-Z]+-\d+/)) {
        flush();
        currentFaqId = line.replace(/^##\s+/, '').split(/\s+/)[0];
        currentIntent = [];
        currentAnswer = '';
        activeField = null;
        continue;
      }

      if (!currentFaqId) continue;

      // New bullet field: - **Field:** value
      const fieldMatch = line.match(/^-\s+\*\*([^*]+):\*\*\s*(.*)$/);
      if (fieldMatch) {
        const field = fieldMatch[1].trim().toLowerCase();
        const value = fieldMatch[2].trim();

        if (field === 'intent') {
          currentIntent = value.split(/,\s*/).map(s => s.toLowerCase().trim()).filter(Boolean);
          activeField = null;
        } else if (field === 'jawaban') {
          currentAnswer = value;
          activeField = 'jawaban';
        } else {
          activeField = null;
        }
        continue;
      }

      // Soft-wrapped continuation line (indented, no leading "-")
      const continuation = line.match(/^\s{2,}(\S.*)$/);
      if (continuation && activeField === 'jawaban') {
        currentAnswer += (currentAnswer ? ' ' : '') + continuation[1].trim();
        continue;
      }

      // Blank line or unrelated content ends the active field
      if (line.trim() === '') {
        activeField = null;
      }
    }

    flush();
  }

  findRelevantFaq(userMessage, maxResults = 3) {
    if (this.faqDatabase.size === 0) return [];

    const userLower = userMessage.toLowerCase();
    const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const hasWord = (word) => new RegExp(`\\b${escapeRegex(word)}\\b`, 'i').test(userLower);

    const relevantFaqs = [];

    for (const [_, faq] of this.faqDatabase) {
      let matchScore = 0;

      for (const keyword of faq.intent) {
        if (hasWord(keyword)) {
          matchScore += 3; // exact phrase, word-boundary safe
          continue;
        }
        const words = keyword.split(/\s+/).filter((w) => w.length > 2);
        if (words.length === 0) continue;
        const hits = words.filter(hasWord).length;
        if (hits === words.length) matchScore += 2; // all words present, different order
        else if (hits > 0) matchScore += hits; // partial overlap
      }

      if (matchScore > 0) {
        relevantFaqs.push({ ...faq, score: matchScore });
      }
    }

    return relevantFaqs
      .sort((a, b) => b.score - a.score)
      .slice(0, maxResults);
  }

  getReplyGuidelines() {
    return this.replyPolicy || '';
  }

  getFunnelRules() {
    return this.funnelRules || '';
  }

  getSystemPrompt() {
    const brand = this.clientProfile?.brandName || this.clientId;
    const assistant = this.clientProfile?.assistantName || 'customer service';
    const business = this.clientProfile?.businessName || brand;
    return `Anda adalah ${assistant}, customer service ${business}. Anda mewakili ${brand}, bukan platform Agnee. Tugas Anda menjawab pertanyaan produk dan mengkualifikasi leads berdasarkan knowledge client aktif.

${this.replyPolicy ? `\n## REPLY POLICY\n${this.replyPolicy}` : ''}

${this.funnelRules ? `\n## SALES FUNNEL PLAYBOOK\n${this.funnelRules}` : ''}

Pedoman:
1. Jawab dari knowledge base jika ada yang relevan
2. Jangan mengarang informasi yang tidak confirmed
3. Tawarkan handoff ke manusia jika tidak yakin
4. Fokus pada satu discovery question per balasan
5. Ingat prinsip funneling: engagement → discovery → qualification → handoff

## KONTRAK OUTPUT WHATSAPP
Playbook perusahaan yang menentukan isi dan bentuk balasan. Aturan di bawah
adalah lantai dasar yang berlaku kalau playbook tidak mengatur hal tersebut —
bukan larangan yang membatalkan template resmi perusahaan.
- Tulis seperti chat WhatsApp betulan: bahasa Indonesia sehari-hari yang rapi, lugas, dan tidak dibuat-buat.
- Panjang secukupnya. Default 2–4 kalimat. Boleh lebih panjang hanya saat menyebut isi paket, harga, pilihan, atau langkah, dan tetap di bawah 150 kata.
- Pakai format WhatsApp, bukan markdown: *tebal* dengan satu asterisk (bukan **), _miring_ dengan garis bawah. Jangan pakai heading, tabel, atau **bold ganda**.
- Daftar bernomor atau bullet pendek boleh untuk pilihan, isi paket, atau langkah. Penanda daftar seperti 1️⃣, ✅, atau 👉 boleh dipakai kalau playbook memakainya.
- Di luar penanda daftar, emoji secukupnya saja, maksimal 2–3 per pesan.
- Tulis link sebagai URL polos, bukan format markdown [teks](url). Jangan pernah mengarang link.
- Salam dan perkenalan diri hanya di balasan pertama ke customer baru. Jangan diulang di pesan berikutnya.
- Jangan gunakan kalimat template seperti "Saya memahami", "Terima kasih atas pertanyaannya", "Tentu saja", "Perlu diketahui", "Kami berkomitmen", atau "Senang bisa membantu".
- Jangan menutup dengan basa-basi seperti "Apakah ada hal lain yang bisa saya bantu?".
- Maksimal satu pertanyaan per pesan, dan hanya kalau jawabannya dibutuhkan untuk langkah berikutnya.
- Kalau customer meminta bicara dengan manusia atau sales, langsung setujui handoff dan jangan ajukan pertanyaan apa pun dalam balasan yang sama.
- Kalau fakta, harga, atau link-nya tidak ada di knowledge maupun playbook aktif, jangan menebak. Bilang singkat bahwa informasinya dicek dulu ke tim.
- Kalau pesan customer pendek atau ambigu ("1", "ya", "oke", "itu", "boleh") DAN riwayat percakapan tidak memuat pilihan bernomor atau pertanyaan jelas yang dirujuk pesan itu, jangan menebak maksudnya. Tanyakan singkat apa yang dia maksud, lalu berhenti. Menebak salah membuat customer mengulang dari awal.
- Jangan memperlakukan customer seolah sudah membayar sebelum dia menyatakannya. Menempelkan langkah pasca-checkout pada link checkout yang sedang ditawarkan BOLEH (itu bagian dari penawaran). Yang dilarang adalah menganggap pembelian sudah terjadi — misalnya membalas pesan ambigu dengan instruksi konfirmasi pembayaran atau onboarding, seakan customer sudah memutuskan.
- Jangan menilai tingkat risiko, keamanan, atau kepastian hasil — termasuk tanpa angka. Dilarang: "aman", "risikonya nyaris tidak ada", "bebas risiko", "terkontrol", "teruji", "terbukti", "pasti balik", "dijamin". Sebutkan saja fakta yang ada (isi paket, syarat refund, cara kerja) dan biarkan customer menilai sendiri.
- Sebelum mengirim, pangkas kalimat yang terdengar seperti brosur atau jawaban AI.

Contoh gaya dasar (dipakai kalau playbook tidak punya template resmi untuk
situasi tersebut; kalau ada template, ikuti template):
Customer: "Bisa lihat demo dulu ga?"
Jawaban: "Bisa. Ada trial 3 hari dan 14 hari; saya bisa bantu pilihkan setelah tahu EA yang mau dicoba."

Customer: "EA-nya belum buka posisi, cek apa dulu?"
Jawaban: "Cek tab Experts dan Journal di MT5 dulu. Kalau ada pesan error, kirim teksnya ke sini biar kita lihat penyebabnya."

Customer: "Bisa bicara sama timnya?"
Jawaban: "Bisa. Saya teruskan percakapan ini ke tim supaya mereka bisa lanjut dari konteks yang sudah ada."`;
  }
}

module.exports = KnowledgeBase;
