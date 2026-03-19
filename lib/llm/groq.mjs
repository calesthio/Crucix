// Groq Provider — OpenAI-compatible API, insanely fast inference

import { LLMProvider } from './provider.mjs';

export class GroqProvider extends LLMProvider {
    constructor(config) {
        super(config);
        this.name = 'groq';
        this.apiKey = config.apiKey;
        this.model = config.model || 'llama-3.3-70b-versatile';
    }

    get isConfigured() { return !!this.apiKey; }

    async complete(systemPrompt, userMessage, opts = {}) {
        const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${this.apiKey}`,
            },
            body: JSON.stringify({
                model: this.model,
                max_tokens: opts.maxTokens || 4096,
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: userMessage },
                ],
            }),
            signal: AbortSignal.timeout(opts.timeout || 60000),
        });

        if (!res.ok) {
            const err = await res.text().catch(() => '');
            throw new Error(`Groq API ${res.status}: ${err.substring(0, 200)}`);
        }

        const data = await res.json();
        const text = data.choices?.[0]?.message?.content || '';

        return {
            text,
            usage: {
                inputTokens: data.usage?.prompt_tokens || 0,
                outputTokens: data.usage?.completion_tokens || 0,
            },
            model: data.model || this.model,
        };
    }
}
