// Google Gemini Provider — raw fetch, no SDK

import { LLMProvider } from './provider.mjs';

export class GeminiProvider extends LLMProvider {
  constructor(config) {
    super(config);
    this.name = 'gemini';
    this.apiKey = config.apiKey;
    this.model = config.model || 'gemini-3.1-pro';
  }

  get isConfigured() { return !!this.apiKey; }

  async complete(systemPrompt, userMessage, opts = {}) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent?key=${this.apiKey}`;

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemPrompt }] },
        contents: [{ parts: [{ text: userMessage }] }],
        // --- TRAVA DE SEGURANÇA DESATIVADA PARA OSINT ---
        safetySettings: [
          { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
          { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
          { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
          { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" }
        ],
        // ------------------------------------------------
        generationConfig: {
          maxOutputTokens: opts.maxTokens || 4096,
          // Trava estrutural para garantir o JSON nativo
          responseMimeType: "application/json",
          responseSchema: {
            type: "ARRAY",
            items: {
              type: "OBJECT",
              properties: {
                title: { type: "STRING", description: "Short title (max 10 words)" },
                type: { type: "STRING", enum: ["LONG", "SHORT", "HEDGE", "WATCH", "AVOID"] },
                ticker: { type: "STRING", description: "Primary instrument" },
                confidence: { type: "STRING", enum: ["HIGH", "MEDIUM", "LOW"] },
                rationale: { type: "STRING", description: "2-3 sentence explanation citing specific data" },
                risk: { type: "STRING", description: "Key risk factor" },
                horizon: { type: "STRING", description: "Intraday, Days, Weeks, or Months" },
                signals: { type: "ARRAY", items: { type: "STRING" } }
              },
              required: ["title", "type", "ticker", "confidence", "rationale", "risk", "horizon", "signals"]
            }
          }
        },
      }),
      signal: AbortSignal.timeout(opts.timeout || 60000),
    });

    if (!res.ok) {
      const err = await res.text().catch(() => '');
      throw new Error(`Gemini API ${res.status}: ${err.substring(0, 200)}`);
    }

    const data = await res.json();
    
    // Fallback de segurança caso a API bloqueie em um nível superior (independente do BLOCK_NONE)
    if (data.candidates?.[0]?.finishReason === 'SAFETY') {
        console.warn('[LLM] Alerta de Censura: O modelo recusou a análise do feed por violação de segurança.');
    }

    const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';

    // --- INJEÇÃO DE DEBUG ---
    if (!text || text.length < 10) {
        console.log("\n[DEBUG CRÍTICO] A IA não retornou texto válido. Resposta bruta da API:");
        console.log(JSON.stringify(data, null, 2));
    }
    // ------------------------

    return {
      text,
      usage: {
        inputTokens: data.usageMetadata?.promptTokenCount || 0,
        outputTokens: data.usageMetadata?.candidatesTokenCount || 0,
      },
      model: this.model,
    };
  }
}