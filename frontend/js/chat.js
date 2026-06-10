const Chat = {
  currentSessionId: null,
  isStreaming: false,

  async send(message) {
    if (this.isStreaming) return;
    if (!Config.isValid()) {
      UI.setStatus('请先配置 API Key', 'error');
      UI.showSettings();
      return;
    }

    const config = Config.get();

    this.isStreaming = true;
    this._setSending(true);

    UI.addMessage('user', message);

    const streamingEl = UI.addStreamingMessage();
    let fullContent = '';
    let currentToolDiv = null;
    let currentToolGroup = null;

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: this.currentSessionId,
          message,
          config: {
            apiKey: config.apiKey,
            baseUrl: config.baseUrl,
            model: config.model,
            roundDelayMs: config.roundDelayMs
          },
          depth: document.getElementById('depth-select').value,
          style: document.getElementById('style-select').value,
          database: document.getElementById('db-select').value
        })
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: '请求失败' }));
        throw new Error(err.error || `HTTP ${res.status}`);
      }

      const sessionId = res.headers.get('X-Session-Id');
      if (sessionId && !this.currentSessionId) {
        this.currentSessionId = sessionId;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const jsonStr = line.slice(6);
          let event;
          try { event = JSON.parse(jsonStr); } catch { continue; }

          switch (event.type) {
            case 'session':
              this.currentSessionId = event.sessionId;
              break;

            case 'delta':
              fullContent += event.text;
              streamingEl.innerHTML = UI.renderMarkdown(fullContent);
              if (!fullContent.includes('```')) {
                streamingEl.classList.add('streaming-cursor');
              } else {
                streamingEl.classList.remove('streaming-cursor');
              }
              UI.scrollChatToBottom(false);
              break;

            case 'tool_start':
              {
                const toolEntry = UI.addToolCard(event.name, event.args, currentToolGroup);
                currentToolGroup = toolEntry.groupEl;
                currentToolDiv = toolEntry.itemEl;
              }
              break;

            case 'tool_end':
              if (currentToolDiv) {
                UI.updateToolResult(currentToolDiv, event.result);
                currentToolDiv = null;
              }
              fullContent = '';
              break;

            case 'rate_wait':
              UI.setStatus(`等待 ${event.delayMs}ms`);
              break;

            case 'error':
              streamingEl.innerHTML = `<span style="color:var(--error)">[错误] ${UI.escapeHtml(event.message)}</span>`;
              UI.finalizeStreamingMessage(streamingEl);
              UI.setStatus('错误', 'error');
              break;

            case 'done':
              if (currentToolGroup) {
                UI.finalizeToolGroup(currentToolGroup);
                currentToolGroup = null;
              }
              UI.finalizeStreamingMessage(streamingEl);
              if (fullContent) {
                streamingEl.innerHTML = UI.renderMarkdown(fullContent);
              }
              App.refreshSessions();
              break;
          }
        }
      }
    } catch (err) {
      if (err.name !== 'AbortError') {
        streamingEl.innerHTML = `<span style="color:var(--error)">[请求错误] ${UI.escapeHtml(err.message)}</span>`;
        UI.finalizeStreamingMessage(streamingEl);
        UI.setStatus('请求错误', 'error');
      }
    } finally {
      this.isStreaming = false;
      this._setSending(false);
      if (currentToolGroup) {
        UI.finalizeToolGroup(currentToolGroup);
      }
      if (!(document.getElementById('header-status').textContent || '').includes('错误')) {
        UI.setStatus('系统就绪');
      }
    }
  },

  abort() {
    if (this.currentSessionId) {
      fetch('/api/chat/abort', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: this.currentSessionId })
      }).catch(() => {});
    }
  },

  async loadSession(sessionId) {
    this.currentSessionId = sessionId;
    const container = document.getElementById('chat-messages');
    container.innerHTML = '';

    const session = await Sessions.get(sessionId);
    if (!session || !session.messages.length) {
      container.innerHTML = UI.welcomeMarkup();
      return;
    }

    const sorted = [...session.messages].sort((a, b) => {
      const ta = a.timestamp ? new Date(a.timestamp).getTime() : 0;
      const tb = b.timestamp ? new Date(b.timestamp).getTime() : 0;
      return ta - tb;
    });

    for (const msg of sorted) {
      UI.addMessage(msg.role, msg.content);
    }
  },

  _setSending(active) {
    const sendBtn = document.getElementById('btn-send');
    const stopBtn = document.getElementById('btn-stop');
    const input = document.getElementById('chat-input');

    if (active) {
      sendBtn.classList.add('hidden');
      stopBtn.classList.remove('hidden');
      input.disabled = true;
    } else {
      sendBtn.classList.remove('hidden');
      stopBtn.classList.add('hidden');
      input.disabled = false;
      input.focus();
    }
  }
};
