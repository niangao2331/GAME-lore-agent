import { EventEmitter } from 'events';
import { LLMClient } from './LLMClient.js';

function clampRoundDelay(value) {
  const delay = Number(value || 0);
  if (!Number.isFinite(delay)) return 0;
  return Math.min(Math.max(Math.round(delay), 0), 60000);
}

function sleepWithAbort(ms, signal) {
  if (!ms || ms <= 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Aborted', 'AbortError'));
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(timer);
      reject(new DOMException('Aborted', 'AbortError'));
    }, { once: true });
  });
}

export class Agent extends EventEmitter {
  constructor(sessionId, config, { toolRegistry, skillRegistry }) {
    super();
    this.sessionId = sessionId;
    this.config = config;
    this.toolRegistry = toolRegistry;
    this.skillRegistry = skillRegistry;
    this.llm = new LLMClient(config);
    this.messages = [];
    this.abortController = null;
    this.activeSkill = config.skill || null;
  }

  buildSystemPrompt() {
    let system = `You are a helpful AI assistant. You can use tools to help answer questions.
Respond in the user's language. Be concise and accurate.

When you need to read a file, execute a command, or search the web, use the available tools.
After using a tool, analyze the result and continue helping the user.

Current working directory: ${process.cwd()}`;

    if (this.activeSkill && this.skillRegistry.has(this.activeSkill)) {
      const skill = this.skillRegistry.get(this.activeSkill);
      system += `\n\n## Active Skill: ${skill.name}\n${skill.systemPrompt}`;
    }

    system += `\n\nCurrent date: ${new Date().toISOString().split('T')[0]}`;
    return system;
  }

  getTools() {
    const tools = this.toolRegistry.getAll();
    return tools.map(t => ({
      type: 'function',
      function: {
        name: t.name,
        description: t.description,
        parameters: t.parameters
      }
    }));
  }

  async processMessage(userMessage) {
    this.abortController = new AbortController();

    this.messages.push({ role: 'user', content: userMessage });

    const systemPrompt = this.buildSystemPrompt();
    const tools = this.getTools();

    try {
      let round = 0;
      const maxRounds = this.config.maxRounds || 15;
      const roundDelayMs = clampRoundDelay(this.config.roundDelayMs);

      while (round < maxRounds) {
        if (this.abortController.signal.aborted) break;
        round++;

        if (round > 1 && roundDelayMs > 0) {
          this.emit('rate_wait', roundDelayMs, round);
          await sleepWithAbort(roundDelayMs, this.abortController.signal);
        }

        const requestMessages = [
          { role: 'system', content: systemPrompt },
          ...this.messages
        ];

        let fullResponse = '';
        let reasoningContent = '';
        let toolCalls = [];
        let currentToolCall = null;
        let currentToolIndex = -1;

        for await (const chunk of this.llm.chatStream(
          requestMessages,
          tools.length > 0 ? tools : undefined,
          this.abortController.signal
        )) {
          if (this.abortController.signal.aborted) break;

          const delta = chunk.choices?.[0]?.delta;
          if (!delta) continue;

          if (delta.reasoning_content) {
            reasoningContent += delta.reasoning_content;
          }

          if (delta.content) {
            fullResponse += delta.content;
            this.emit('delta', delta.content);
          }

          if (delta.tool_calls) {
            for (const tc of delta.tool_calls) {
              if (tc.index !== currentToolIndex) {
                currentToolIndex = tc.index;
                currentToolCall = {
                  id: tc.id || '',
                  name: tc.function?.name || '',
                  arguments: ''
                };
                toolCalls.push(currentToolCall);
              }
              if (tc.id) currentToolCall.id = tc.id;
              if (tc.function?.name) currentToolCall.name = tc.function.name;
              if (tc.function?.arguments) currentToolCall.arguments += tc.function.arguments;
            }
          }
        }

        if (this.abortController.signal.aborted) break;

        if (toolCalls.length > 0) {
          const assistantMsg = {
            role: 'assistant',
            content: fullResponse || null,
            tool_calls: toolCalls.map(tc => ({
              id: tc.id,
              type: 'function',
              function: { name: tc.name, arguments: tc.arguments }
            }))
          };

          if (reasoningContent) {
            assistantMsg.reasoning_content = reasoningContent;
          }

          this.messages.push(assistantMsg);

          for (const tc of toolCalls) {
            this.emit('tool_start', tc.name, tc.arguments);

            let toolResult;
            try {
              const args = JSON.parse(tc.arguments || '{}');
              toolResult = await this.toolRegistry.execute(tc.name, args);
            } catch (e) {
              toolResult = `Error: ${e.message}`;
            }

            const resultStr = typeof toolResult === 'string' ? toolResult : JSON.stringify(toolResult);

            this.emit('tool_end', tc.name, resultStr);

            this.messages.push({
              role: 'tool',
              tool_call_id: tc.id,
              content: resultStr
            });
          }
        } else {
          const assistantMsg = { role: 'assistant', content: fullResponse };
          if (reasoningContent) {
            assistantMsg.reasoning_content = reasoningContent;
          }
          this.messages.push(assistantMsg);
          this.emit('done', fullResponse);
          return fullResponse;
        }
      }
    } catch (err) {
      if (err.name === 'AbortError') {
        this.emit('done', null);
        return null;
      }
      this.emit('error', err.message);
      throw err;
    }
  }

  abort() {
    if (this.abortController) {
      this.abortController.abort();
    }
  }

  getHistory() {
    return [...this.messages];
  }

  setSkill(skillName) {
    this.activeSkill = skillName;
  }

  updateConfig(config) {
    Object.assign(this.config, config);
    this.llm.updateConfig(config);
  }
}
