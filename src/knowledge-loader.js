'use strict';

const fs = require('node:fs');
const path = require('node:path');

class KnowledgeBase {
  constructor() {
    this.faqDatabase = new Map();
    this.funnelRules = null;
    this.replyPolicy = null;
    this.loaded = false;
  }

  async load() {
    const knowledgeDir = path.join(__dirname, '..', 'knowledge');

    if (!fs.existsSync(knowledgeDir)) {
      console.warn('Knowledge base directory not found');
      return;
    }

    try {
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
      console.log(`✓ Knowledge base loaded: ${this.faqDatabase.size} FAQ entries`);
    } catch (err) {
      console.error('Failed to load knowledge base:', err.message);
    }
  }

  parseFaqFile(content, filename) {
    const lines = content.split('\n');
    let currentFaqId = null;
    let currentIntent = [];
    let currentAnswer = '';
    let isReading = false;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // Match FAQ ID (e.g., ## FAQ-PRODUCT-001)
      if (line.match(/^##\s+FAQ-[A-Z]+-\d+/)) {
        if (currentFaqId && currentAnswer) {
          this.faqDatabase.set(currentFaqId, {
            id: currentFaqId,
            intent: currentIntent,
            answer: currentAnswer.trim(),
            source: filename,
          });
        }
        currentFaqId = line.replace(/^##\s+/, '').split(/\s+—|\s+/)[0];
        currentIntent = [];
        currentAnswer = '';
        isReading = true;
        continue;
      }

      // Parse intent line
      if (line.match(/^-\s+\*\*Intent:\*\*/)) {
        const intentText = line.replace(/^-\s+\*\*Intent:\*\*\s+/, '').trim();
        currentIntent = intentText.split(/,\s+/).map(s => s.toLowerCase().trim());
      }

      // Parse answer line
      if (line.match(/^-\s+\*\*Jawaban:\*\*/)) {
        currentAnswer = line.replace(/^-\s+\*\*Jawaban:\*\*\s+/, '').trim();
      }

      // Collect multi-line answers
      if (isReading && line.match(/^-\s+/) && !line.match(/Status:|Intent:|Jawaban:|Contoh|Next/)) {
        if (currentAnswer) currentAnswer += ' ';
        currentAnswer += line.replace(/^-\s+/, '').trim();
      }
    }

    // Save last FAQ
    if (currentFaqId && currentAnswer) {
      this.faqDatabase.set(currentFaqId, {
        id: currentFaqId,
        intent: currentIntent,
        answer: currentAnswer.trim(),
        source: filename,
      });
    }
  }

  findRelevantFaq(userMessage, maxResults = 3) {
    if (this.faqDatabase.size === 0) return [];

    const userLower = userMessage.toLowerCase();
    const relevantFaqs = [];

    for (const [_, faq] of this.faqDatabase) {
      const matchScore = faq.intent.reduce((score, keyword) => {
        if (userLower.includes(keyword)) score += 2;
        if (userLower.match(new RegExp(keyword.split('').join('\\s*'), 'i'))) score += 1;
        return score;
      }, 0);

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
    return `Anda adalah chatbot customer service Agnee yang membantu menjawab pertanyaan dan mengkualifikasi leads.

${this.replyPolicy ? `\n## REPLY POLICY\n${this.replyPolicy}` : ''}

${this.funnelRules ? `\n## SALES FUNNEL PLAYBOOK\n${this.funnelRules}` : ''}

Pedoman:
1. Jawab dari knowledge base jika ada yang relevan
2. Jangan mengarang informasi yang tidak confirmed
3. Tawarkan handoff ke manusia jika tidak yakin
4. Fokus pada satu discovery question per balasan
5. Ingat prinsip funneling: engagement → discovery → qualification → handoff`;
  }
}

module.exports = KnowledgeBase;
