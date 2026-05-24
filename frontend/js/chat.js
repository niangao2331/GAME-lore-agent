const Chat = {
  currentSessionId: null,
  isStreaming: false,
  abortController: null,

  async send(message) {
    if (this.isStreaming) return;
    if (!Config.isValid()) {
      UI.setStatus('CONFIGURE API KEY IN SETTINGS', 'error');
      UI.showSettings();
      return;
    }

    const config = Config.get();

    this.isStreaming = true;
    this._setSending(true);

    // Add user message to the bottom
    UI.addMessage('user', message);

    // Create streaming placeholder AFTER user message
    const streamingEl = UI.addStreamingMessage();
    let fullContent = '';
    let currentToolDiv = null;

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
            protocol: config.protocol
          },
          depth: document.getElementById('depth-select').value,
          style: document.getElementById('style-select').value
        })
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'TRANSMISSION FAILED' }));
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
              // Auto-scroll to bottom on each delta
              const container = document.getElementById('chat-messages');
              container.scrollTop = container.scrollHeight;
              break;

            case 'tool_start':
              currentToolDiv = UI.addToolCard(event.name, event.args);
              break;

            case 'tool_end':
              if (currentToolDiv) {
                UI.updateToolResult(currentToolDiv, event.result);
                currentToolDiv = null;
              }
              break;

            case 'error':
              streamingEl.innerHTML = `<span style="color:var(--error)">[ERROR] ${UI.escapeHtml(event.message)}</span>`;
              UI.finalizeStreamingMessage(streamingEl);
              UI.setStatus('ERROR', 'error');
              break;

            case 'done':
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
        streamingEl.innerHTML = `<span style="color:var(--error)">[TRANSMISSION ERROR] ${UI.escapeHtml(err.message)}</span>`;
        UI.finalizeStreamingMessage(streamingEl);
        UI.setStatus('TRANSMISSION ERROR', 'error');
      }
    } finally {
      this.isStreaming = false;
      this._setSending(false);
      if (!(document.getElementById('header-status').textContent || '').includes('ERROR')) {
        UI.setStatus('READY');
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
      container.innerHTML = `
        <div class="welcome-screen">
          <div class="welcome-badge">
            <span class="badge-stripe"></span>
            ARKNIGHTS LORE DATABASE
            <span class="badge-stripe"></span>
          </div>
          <div class="welcome-logo">⚠</div>
          <h2>IRIS LORE TERMINAL</h2>
          <p class="welcome-subtitle">Industrial Research & Information System</p>
          <div class="welcome-stats">
            <div class="stat-item"><span class="stat-val" id="stat-assets">--</span><span class="stat-lbl">ASSETS</span></div>
            <div class="stat-sep"></div>
            <div class="stat-item"><span class="stat-val" id="stat-tags">--</span><span class="stat-lbl">TAGS</span></div>
            <div class="stat-sep"></div>
            <div class="stat-item"><span class="stat-val" id="stat-chunks">--</span><span class="stat-lbl">CHUNKS</span></div>
          </div>
          <p class="welcome-hint">Configure API key in settings, then begin inquiry.</p>
        </div>`;
      return;
    }

    // Sort messages in chronological order
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
