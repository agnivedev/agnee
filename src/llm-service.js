'use strict';

/**
 * Balasan yang berhenti di tengah kalimat tidak boleh sampai ke customer.
 * OpenRouter mengembalikan isi setengah jadi dengan finish_reason "error"
 * saat penyedia modelnya terputus, dan "length" saat batas token habis;
 * keduanya dulu diterima begitu saja sebagai balasan sah.
 */
function assertComplete(finishReason, model) {
  if (finishReason !== 'error' && finishReason !== 'length') return;
  const error = new Error(`Reply cut off (${model}, finish_reason=${finishReason})`);
  error.interrupted = finishReason === 'error';
  throw error;
}

class LlmService {
  constructor(config = {}) {
    this.apiKey = config.apiKey || process.env.OPENROUTER_API_KEY;
    this.model = config.model || process.env.OPENROUTER_MODEL || 'google/gemini-2.5-flash';
    this.modelChain = config.modelChain || [];
    this.baseUrl = 'https://openrouter.ai/api/v1';
    this.contextWindow = config.contextWindow || 8000;
    this.maxTokens = config.maxTokens || 512;
    this.enabled = config.enabled !== false && !!this.apiKey;
    /**
     * Dipanggil sekali per panggilan model yang berhasil.
     *
     * Dipasang dari luar supaya modul ini tetap tidak tahu apa-apa soal
     * database. Kegagalan pencatatan tidak boleh menggagalkan balasan ke
     * customer — pemanggilnya yang menelan errornya.
     */
    this.onUsage = config.onUsage || null;
  }

  async _callModel(model, userMessage, context) {
    const systemPrompt = context.systemPrompt || this.getDefaultSystemPrompt();
    const messages = this.buildMessages(userMessage, context);

    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      // Tanpa batas waktu, satu model yang menggantung menahan permintaan
      // selamanya — MCP sudah menyerah di 15 detik sementara kuota terpakai.
      signal: AbortSignal.timeout(60_000),
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
        'HTTP-Referer': 'https://agnee.agnive.co',
        'X-Title': 'Agnee Customer Service Bot',
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          ...messages,
          { role: 'user', content: userMessage },
        ],
        temperature: 0.7,
        max_tokens: this.maxTokensFor(context),
        top_p: 0.95,
        // Tanpa ini OpenRouter hanya mengembalikan jumlah token, tanpa biaya.
        // `normalizeUsage` sudah lama membaca `usage.cost` — field yang tidak
        // pernah datang, jadi biaya tercatat nol untuk semua pemakaian.
        usage: { include: true },
      }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(`OpenRouter API error (${model}): ${error.error?.message || response.statusText}`);
    }

    const data = await response.json();
    const reply = data.choices?.[0]?.message?.content;
    if (!reply) throw new Error(`No reply content from ${model}`);
    assertComplete(data.choices?.[0]?.finish_reason, model);

    if (this.onUsage) {
      try {
        this.onUsage({ model, usage: data.usage, context });
      } catch { /* pencatatan tidak boleh menjatuhkan balasan */ }
    }
    return { text: reply.trim(), model, usage: data.usage };
  }

  /**
   * The same call, but the model may look things up first: `context.tools` is
   * a list of { name, description, parameters (JSON Schema), run(args) }.
   * The model asks for a tool, we run it and hand back the result, at most
   * `maxToolRounds` times; the last round forbids tools so it must answer.
   * Tool output goes back as data in a "tool" message, never as instructions.
   */
  /**
   * Balasan chat pendek cukup di batas platform (512). Pekerjaan yang
   * menulis ulang seluruh dokumen minta batas sendiri lewat `context.maxTokens`;
   * tanpa itu dokumen panjang terpotong dan balasannya ditolak sebagai "cut off".
   */
  maxTokensFor(context = {}) {
    const asked = Number(context.maxTokens);
    return Number.isInteger(asked) && asked > 0 ? Math.min(asked, 8000) : this.maxTokens;
  }

  async _callModelWithTools(model, userMessage, context) {
    const systemPrompt = context.systemPrompt || this.getDefaultSystemPrompt();
    const conversation = [
      { role: 'system', content: systemPrompt },
      ...this.buildMessages(userMessage, context),
      { role: 'user', content: userMessage },
    ];
    const specs = context.tools.map((t) => ({
      type: 'function',
      function: { name: t.name, description: t.description, parameters: t.parameters },
    }));
    const byName = new Map(context.tools.map((t) => [t.name, t]));
    const rounds = Math.max(0, Math.min(context.maxToolRounds ?? 3, 5));
    // Alat cari cukup empat per putaran; pemanggil yang memang butuh banyak
    // sekaligus (asisten Latih AI) menaikkannya lewat `maxToolCalls`.
    const perRound = Number.isInteger(context.maxToolCalls) ? Math.min(Math.max(context.maxToolCalls, 1), 12) : 4;
    const toolCalls = [];
    const total = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0, cost: 0 };

    for (let round = 0; round <= rounds; round += 1) {
      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        signal: AbortSignal.timeout(60_000),
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`,
          'HTTP-Referer': 'https://agnee.agnive.co',
          'X-Title': 'Agnee Customer Service Bot',
        },
        body: JSON.stringify({
          model,
          messages: conversation,
          tools: specs,
          tool_choice: round < rounds ? 'auto' : 'none',
          temperature: 0.7,
          max_tokens: this.maxTokensFor(context),
          top_p: 0.95,
          usage: { include: true },
        }),
      });
      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(`OpenRouter API error (${model}): ${error.error?.message || response.statusText}`);
      }
      const data = await response.json();
      if (this.onUsage) {
        try {
          this.onUsage({ model, usage: data.usage, context });
        } catch { /* pencatatan tidak boleh menjatuhkan balasan */ }
      }
      for (const k of Object.keys(total)) total[k] += Number(data.usage?.[k] || 0);

      const message = data.choices?.[0]?.message || {};
      const calls = Array.isArray(message.tool_calls) ? message.tool_calls : [];
      if (!calls.length) {
        if (!message.content) throw new Error(`No reply content from ${model}`);
        assertComplete(data.choices?.[0]?.finish_reason, model);
        return { text: String(message.content).trim(), model, usage: total, toolCalls };
      }

      conversation.push({ role: 'assistant', content: message.content || '', tool_calls: calls });
      for (const call of calls.slice(0, perRound)) {
        const tool = byName.get(call.function?.name);
        let output;
        let args = {};
        try {
          args = JSON.parse(call.function?.arguments || '{}');
          output = tool ? await tool.run(args) : { error: `Unknown tool ${call.function?.name}` };
        } catch (err) {
          output = { error: err.message };
        }
        toolCalls.push({ name: call.function?.name, args });
        conversation.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(output).slice(0, 8000) });
      }
      // Calls beyond four in one turn are answered as refused, so the model
      // is not left waiting on a result that never comes.
      for (const call of calls.slice(perRound)) {
        conversation.push({ role: 'tool', tool_call_id: call.id, content: '{"error":"Too many tool calls in one turn"}' });
      }
    }
    throw new Error(`Tool loop did not finish (${model})`);
  }

  async generateReply(userMessage, context = {}) {
    if (!this.enabled) {
      console.warn('LLM service disabled or API key not configured');
      return null;
    }

    // context.modelChain adalah setting company pemanggil (lihat
    // database.getAiSettings) — ia mengalahkan this.modelChain, yang sekarang
    // cuma fallback platform kalau company itu belum pernah menyetel chain-nya
    // sendiri. Tanpa ini, satu instance LlmService yang dipakai semua tenant
    // tidak bisa membedakan model pilihan tenant A dari tenant B.
    const companyChain = Array.isArray(context.modelChain) ? context.modelChain.filter(Boolean) : [];
    const chain = companyChain.length ? companyChain : (this.modelChain.length ? this.modelChain : [this.model]);
    let lastError;

    const withTools = Array.isArray(context.tools) && context.tools.length > 0;
    for (const model of chain) {
      for (let attempt = 1; attempt <= 2; attempt += 1) {
        try {
          return withTools
            ? await this._callModelWithTools(model, userMessage, context)
            : await this._callModel(model, userMessage, context);
        } catch (err) {
          lastError = err;
          // Gangguan di tengah penyusunan balasan biasanya sesaat: satu kali
          // ulang pada model yang sama sebelum pindah ke model berikutnya.
          if (err.interrupted && attempt === 1) continue;
          // Jaringan putus-nyambung meninggalkan koneksi lama yang sudah mati;
          // percobaan kedua membuka koneksi baru. Hanya untuk kegagalan di
          // tingkat jaringan (TypeError "fetch failed"), bukan jawaban error
          // dari penyedia, yang tidak akan berubah kalau diulang.
          const cause = err.cause?.code || err.cause?.message;
          if (err instanceof TypeError && err.message === 'fetch failed' && attempt === 1) {
            console.warn(`Model ${model} network error${cause ? ` (${cause})` : ''}, retrying once`);
            continue;
          }
          console.warn(`Model ${model} failed: ${err.message}${cause ? ` (${cause})` : ''}${chain.length > 1 ? ', trying next...' : ''}`);
          break;
        }
      }
    }

    // A model or provider that cannot take tools should not leave the
    // customer unanswered: answer once more without them.
    // Kecuali pemanggil yang hasilnya HANYA berarti kalau alatnya jalan (asisten
    // Latih AI): jawaban tanpa alat di sana berarti usulan yang diklaim tapi tak ada.
    if (withTools && !context.requireTools) {
      const { tools: _ignored, ...plain } = context;
      for (const model of chain) {
        try {
          return await this._callModel(model, userMessage, plain);
        } catch (err) {
          lastError = err;
        }
      }
    }

    console.error('All models in chain failed. Last error:', lastError?.message);
    return null;
  }

  buildMessages(userMessage, context = {}) {
    const messages = [];

    // Add conversation history (if available)
    if (context.history && Array.isArray(context.history)) {
      // Lima pesan cukup untuk obrolan pendek. Template yang berjenjang (KS)
      // butuh lebih panjang, supaya tingkat yang sudah ditolak tidak keluar dari
      // jendela lalu ditawarkan lagi; pemanggil menaikkannya lewat historyLimit.
      const limit = Number.isInteger(context.historyLimit) ? Math.min(Math.max(context.historyLimit, 1), 30) : 5;
      for (const msg of context.history.slice(-limit)) {
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
    return `Anda adalah customer service Agnee yang membantu pelanggan lewat WhatsApp.

Prinsip dasar:
1. Jawab langsung dengan bahasa Indonesia sehari-hari yang rapi
2. Tulis seperti percakapan manusia, bukan artikel, brosur, atau jawaban AI
3. Jika tidak tahu, tanyakan atau tawarkan handoff ke manusia
4. Maksimal satu pertanyaan jika memang membantu langkah berikutnya; tidak semua balasan harus diakhiri pertanyaan
5. Jangan mengarang informasi produk, harga, atau timeline
6. Umumnya cukup 2–4 kalimat; boleh lebih panjang hanya untuk menyebut isi paket, harga, atau langkah, dan tetap di bawah 150 kata
7. Emoji secukupnya (maksimal 2–3) dan daftar bernomor pendek boleh dipakai kalau memang membantu customer memilih

Hindari:
- Salam dan perkenalan diri berulang
- Kalimat template seperti "Saya memahami", "Terima kasih atas pertanyaannya", "Tentu saja", dan "Perlu diketahui"
- Penutup generik seperti "Apakah ada hal lain yang bisa saya bantu?"
- Heading markdown, tabel, bold markdown, dan prose yang terasa seperti AI
- Mengarang detail produk yang tidak dikonfirmasi
- Memaksa customer untuk data yang tidak perlu`;
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
