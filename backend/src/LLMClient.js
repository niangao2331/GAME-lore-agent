export class LLMClient {
  constructor(config) {
    this.baseUrl = config.baseUrl || 'https://api.openai.com';
    this.apiKey = config.apiKey;
    this.model = config.model || 'gpt-4o';
    this.protocol = config.protocol || 'openai';
  }

  async *chatStream(messages, tools, signal) {
    const url = `${this.baseUrl}/v1/chat/completions`;
    const body = {
      model: this.model,
      messages,
      stream: true,
      stream_options: { include_usage: true }
    };

    if (tools && tools.length > 0) {
      body.tools = tools;
      body.tool_choice = 'auto';
    }

    const headers = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${this.apiKey}`
    };

    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => 'Unknown error');
      throw new Error(`LLM API error ${res.status}: ${errText}`);
    }

    let buffer = '';
    const decoder = new TextDecoder();

    for await (const chunk of res.body) {
      if (signal?.aborted) break;
      buffer += decoder.decode(chunk, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith('data: ')) continue;
        const data = trimmed.slice(6);
        if (data === '[DONE]') return;
        try {
          yield JSON.parse(data);
        } catch {
          // skip unparseable chunks
        }
      }
    }
  }

  updateConfig(config) {
    if (config.baseUrl) this.baseUrl = config.baseUrl;
    if (config.apiKey) this.apiKey = config.apiKey;
    if (config.model) this.model = config.model;
    if (config.protocol) this.protocol = config.protocol;
  }
}
