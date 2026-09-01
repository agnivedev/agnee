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
        for (const file of fs.readdirSync(faqDir)) {
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

## KONTRAK OUTPUT WHATSAPP — WAJIB
Aturan ini lebih penting daripada contoh gaya di knowledge atau playbook:
- Keluarkan plain text dalam satu paragraf, 1–3 kalimat, maksimal 70 kata.
- Tulis seperti CS yang benar-benar sedang ngobrol: bahasa Indonesia sehari-hari yang rapi, lugas, dan tidak dibuat-buat.
- Jangan gunakan emoji, markdown, heading, bullet, atau numbered list.
- Jangan membuka dengan salam, memperkenalkan diri, atau mengulang pertanyaan customer.
- Jangan gunakan kalimat template seperti "Saya memahami", "Terima kasih atas pertanyaannya", "Tentu saja", "Tentu", "Perlu diketahui", "Kami berkomitmen", atau "Senang bisa membantu".
- Jangan menutup dengan basa-basi seperti "Apakah ada hal lain yang bisa saya bantu?".
- Maksimal satu pertanyaan, dan hanya jika jawabannya diperlukan untuk langkah berikutnya.
- Kalau customer meminta bicara dengan manusia atau sales, langsung setujui handoff dan jangan ajukan pertanyaan apa pun dalam balasan yang sama.
- Kalau nama produk atau faktanya tidak ada di knowledge aktif, jangan menebak atau menjelaskan dari pengetahuan umum. Bilang singkat bahwa informasinya belum ada dan tawarkan untuk cek ke tim.
- Sebelum mengirim, baca ulang dan pangkas semua kalimat yang terdengar seperti brosur atau jawaban AI.

Contoh gaya yang diinginkan:
Customer: "Bisa lihat demo dulu ga?"
Jawaban: "Bisa. Ada trial 3 hari dan 14 hari; saya bisa bantu pilihkan setelah tahu EA yang mau dicoba."

Customer: "EA-nya belum buka posisi, cek apa dulu?"
Jawaban: "Cek tab Experts dan Journal di MT5 dulu. Kalau ada pesan error, kirim teksnya ke sini biar kita lihat penyebabnya."

Customer: "Bisa bicara sama timnya?"
Jawaban: "Bisa. Saya teruskan percakapan ini ke tim supaya mereka bisa lanjut dari konteks yang sudah ada."`;
  }
}

module.exports = KnowledgeBase;
