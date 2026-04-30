// Base LLM Provider — all providers implement this interface

export class LLMProvider {
  constructor(config) {
    this.config = config;
    this.name = 'base';
  }

  /**
   * Complete a prompt with system + user messages
   * @returns {{ text: string, usage: { inputTokens: number, outputTokens: number }, model: string }}
   */
  async complete(systemPrompt, userMessage, opts = {}) {
    throw new Error(`${this.name}: complete() not implemented`);
  }

  /**
   * Multi-turn chat. Default: packs history into the user message and calls complete().
   * Providers that support native message arrays (e.g. Bedrock) override this.
   * @param {{ role: 'user'|'assistant', content: string }[]} messages
   * @returns {{ text: string, usage: object, model: string }}
   */
  async chat(messages, systemPrompt, opts = {}) {
    const history = messages.slice(0, -1);
    const last    = messages[messages.length - 1];
    let userContent = last?.content || '';
    if (history.length > 0) {
      const transcript = history
        .map(m => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
        .join('\n');
      userContent = `Previous conversation:\n${transcript}\n\nUser: ${userContent}`;
    }
    return this.complete(systemPrompt, userContent, opts);
  }

  get isConfigured() { return false; }
}
