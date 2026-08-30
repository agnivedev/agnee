'use strict';

class LlmService {
  constructor(config = {}) {
    this.apiKey = config.apiKey || process.env.OPENROUTER_API_KEY;
    this.model = config.model || process.env.OPENROUTER_MODEL || 'grok-2-1212';
    this.baseUrl = 'https://openrouter.ai/api/v1';
    this.contextWindow = config.contextWindow || 8000;
    this.maxTokens = config.maxTokens || 512;
    this.enabled = config.enabled !== false && !!this.apiKey;
  }

  async generateReply(userMessage, context = {}) {
    if (!this.enabled) {
      console.warn('LLM service disabled or API key not configured');
      return null;
    }

    try {
      const systemPrompt = context.systemPrompt || this.getDefaultSystemPrompt();
      const messages = this.buildMessages(userMessage, context);

      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`,
          'HTTP-Referer': 'https://agnee.agnive.co',
          'X-Title': 'Agnee Customer Service Bot',
        },
        body: JSON.stringify({
          model: this.model,
          messages: [
            { role: 'system', content: systemPrompt },
            ...messages,
            { role: 'user', content: userMessage },
          ],
          temperature: 0.7,
          max_tokens: this.maxTokens,
          top_p: 0.95,
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(`OpenRouter API error: ${error.error?.message || response.statusText}`);
      }

      const data = await response.json();
      const reply = data.choices?.[0]?.message?.content;

      if (!reply) {
        throw new Error('No reply content in OpenRouter response');
      }

      return {
        text: reply.trim(),
        model: this.model,
        usage: data.usage,
      };
    } catch (err) {
      console.error('LLM generation failed:', err.message);
      return null;
    }
  }

  buildMessages(userMessage, context = {}) {
    const messages = [];

    // Add conversation history (if available)
    if (context.history && Array.isArray(context.history)) {
      for (const msg of context.history.slice(-5)) {
        if (msg.role === 'user' || msg.role === 'assistant') {
          messages.push({
            role: msg.role,
            content: msg.content,
          });
        }
      }
    }

    // Add relevant FAQ context
    if (context.relevantFaqs && context.relevantFaqs.length > 0) {
      const faqContext = context.relevantFaqs
        .map(faq => `Q: ${faq.intent.join(', ')}\nA: ${faq.answer}`)
        .join('\n\n');

      messages.push({
        role: 'system',
        content: `Relevant knowledge base entries:\n\n${faqContext}`,
      });
    }

    // Add lead context (if qualified)
    if (context.leadState) {
      const stateContext = Object.entries(context.leadState)
        .filter(([_, v]) => v !== null && v !== undefined && v !== '')
        .map(([k, v]) => `${k}: ${v}`)
        .join('\n');

      if (stateContext) {
        messages.push({
          role: 'system',
          content: `Current lead context:\n${stateContext}`,
        });
      }
    }

    return messages;
  }

  getDefaultSystemPrompt() {
    return `Anda adalah chatbot customer service Agnee yang profesional dan membantu.

Prinsip dasar:
1. Jawab dengan ringkas, jelas, dan natural
2. Gunakan bahasa Indonesia yang hangat tapi profesional
3. Jika tidak tahu, tanyakan atau tawarkan handoff ke manusia
4. Satu pertanyaan discovery per balasan maksimal
5. Jangan mengarang informasi produk, harga, atau timeline

Hindari:
- Menambah emoji berlebihan
- Mengarang detail produk yang tidak dikonfirmasi
- Memaksa customer untuk data yang tidak perlu
- Balasan panjang (target: 2-4 kalimat)`;
  }

  static async testModels(apiKey, models = []) {
    if (!apiKey) {
      console.error('API key required for testing');
      return [];
    }

    const results = [];
    const testMessage = 'Apa itu Agnee?';

    for (const model of models) {
      try {
        const service = new LlmService({ apiKey, model });
        const reply = await service.generateReply(testMessage, {
          systemPrompt: 'Jawab singkat dalam 1-2 kalimat.',
        });

        if (reply) {
          results.push({
            model,
            status: 'ok',
            reply: reply.text.substring(0, 100),
            tokens: reply.usage,
          });
        } else {
          results.push({
            model,
            status: 'failed',
            error: 'No reply generated',
          });
        }
      } catch (err) {
        results.push({
          model,
          status: 'error',
          error: err.message,
        });
      }
    }

    return results;
  }
}

module.exports = LlmService;
