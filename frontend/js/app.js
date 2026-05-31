const App = {
  async init() {
    this._restoreModeSelections();
    this._applyFontSize();
    this._applyChatWidth();
    this._fetchStats();
    this._bindEvents();
    this.refreshSessions();
    this._updateModeStatus();
  },

  _applyFontSize() {
    const cfg = Config.get();
    const size = cfg.fontSize || 13;
    document.documentElement.style.setProperty('--font-size', size + 'px');
    const label = document.getElementById('fontsize-label');
    if (label) label.textContent = size;
    const slider = document.getElementById('cfg-fontsize');
    if (slider) slider.value = size;
  },

  _applyChatWidth() {
    const cfg = Config.get();
    const pct = cfg.chatWidth ?? 100;
    this._setChatWidth(pct);
    const slider = document.getElementById('cfg-chat-width');
    if (slider) slider.value = pct;
    const label = document.getElementById('chatwidth-label');
    if (label) label.textContent = pct;
  },

  _setChatWidth(pct) {
    const main = document.getElementById('main');
    if (pct >= 100) {
      main.classList.remove('constrained-view');
      main.style.removeProperty('--chat-max-width');
    } else {
      main.classList.add('constrained-view');
      main.style.setProperty('--chat-max-width', pct + '%');
    }
  },

  _restoreModeSelections() {
    const cfg = Config.get();
    const depthSelect = document.getElementById('depth-select');
    const styleSelect = document.getElementById('style-select');
    if (depthSelect && cfg.depth) depthSelect.value = cfg.depth;
    if (styleSelect && cfg.style) styleSelect.value = cfg.style;
  },

  _updateModeStatus() {
    const depth = document.getElementById('depth-select').value;
    const style = document.getElementById('style-select').value;
    UI.setStatus(`MODE: ${depth.toUpperCase()} | ${style.toUpperCase()}`);
  },

  async _fetchStats() {
    try {
      const res = await fetch('/api/config');
      const data = await res.json();
      if (data.mcpServers && data.mcpServers.length > 0) {
        document.getElementById('stat-assets').textContent = '10.5K';
        document.getElementById('stat-tags').textContent = '4.9K';
        document.getElementById('stat-chunks').textContent = '17.4K';
      }
    } catch {}
  },

  _bindEvents() {
    // Send message
    document.getElementById('btn-send').addEventListener('click', () => this._handleSend());
    document.getElementById('btn-stop').addEventListener('click', () => Chat.abort());

    // Input
    const input = document.getElementById('chat-input');
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        this._handleSend();
      }
    });
    // Auto-resize
    input.addEventListener('input', () => {
      input.style.height = 'auto';
      input.style.height = Math.min(input.scrollHeight, 100) + 'px';
    });

    // New chat
    document.getElementById('btn-new-chat').addEventListener('click', () => this.newChat());

    // Session list clicks
    document.getElementById('session-list').addEventListener('click', (e) => {
      const item = e.target.closest('.session-item');
      if (!item) return;

      if (e.target.dataset.action === 'delete-session') {
        e.stopPropagation();
        this.deleteSession(e.target.dataset.id);
        return;
      }

      Chat.loadSession(item.dataset.id);
      document.querySelectorAll('.session-item').forEach(el => el.classList.remove('active'));
      item.classList.add('active');
    });

    // Settings
    document.getElementById('btn-settings').addEventListener('click', () => UI.showSettings());
    document.getElementById('btn-close-settings').addEventListener('click', () => UI.hideSettings());
    document.getElementById('btn-save-settings').addEventListener('click', () => this._saveSettings());
    document.getElementById('btn-test-connection').addEventListener('click', () => this._testConnection());

    // Close modals on backdrop click
    document.querySelectorAll('.modal-backdrop').forEach(bg => {
      bg.addEventListener('click', () => {
        UI.hideSettings();
        document.getElementById('mcp-modal').classList.add('hidden');
      });
    });

    // Copy button delegation
    document.getElementById('chat-messages').addEventListener('click', (e) => {
      if (e.target.classList.contains('copy-btn')) {
        const code = e.target.dataset.code;
        navigator.clipboard.writeText(code).then(() => {
          e.target.textContent = 'COPIED';
          setTimeout(() => { e.target.textContent = 'COPY'; }, 1500);
        });
      }
    });

    // Depth select change
    document.getElementById('depth-select').addEventListener('change', () => {
      this._updateModeStatus();
      const depth = document.getElementById('depth-select').value;
      const style = document.getElementById('style-select').value;
      Config.set({ depth, style });
    });

    // Style select change
    document.getElementById('style-select').addEventListener('change', () => {
      this._updateModeStatus();
      const depth = document.getElementById('depth-select').value;
      const style = document.getElementById('style-select').value;
      Config.set({ depth, style });
    });

    // Font size slider live preview
    document.getElementById('cfg-fontsize').addEventListener('input', (e) => {
      const size = e.target.value;
      document.getElementById('fontsize-label').textContent = size;
      document.documentElement.style.setProperty('--font-size', size + 'px');
    });

    // Chat width slider live preview
    document.getElementById('cfg-chat-width').addEventListener('input', (e) => {
      const pct = Number(e.target.value);
      document.getElementById('chatwidth-label').textContent = pct;
      this._setChatWidth(pct);
    });

    // Keyboard shortcut for settings
    document.addEventListener('keydown', (e) => {
      if (e.ctrlKey && e.key === ',') {
        e.preventDefault();
        UI.showSettings();
      }
    });
  },

  _handleSend() {
    const input = document.getElementById('chat-input');
    const message = input.value.trim();
    if (!message) return;

    input.value = '';
    input.style.height = 'auto';
    Chat.send(message);
  },

  async newChat() {
    Chat.currentSessionId = null;
    const container = document.getElementById('chat-messages');
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
          <div class="stat-item"><span class="stat-val" id="stat-assets">10.5K</span><span class="stat-lbl">ASSETS</span></div>
          <div class="stat-sep"></div>
          <div class="stat-item"><span class="stat-val" id="stat-tags">4.9K</span><span class="stat-lbl">TAGS</span></div>
          <div class="stat-sep"></div>
          <div class="stat-item"><span class="stat-val" id="stat-chunks">17.4K</span><span class="stat-lbl">CHUNKS</span></div>
        </div>
        <p class="welcome-hint">Configure API key in settings, then begin inquiry.</p>
      </div>`;
    document.querySelectorAll('.session-item').forEach(el => el.classList.remove('active'));
    this._restoreModeSelections();
    this._updateModeStatus();
  },

  async refreshSessions() {
    const sessions = await Sessions.list();
    UI.renderSessionList(sessions, Chat.currentSessionId);
  },

  async deleteSession(id) {
    await Sessions.remove(id);
    if (Chat.currentSessionId === id) {
      this.newChat();
    }
    this.refreshSessions();
  },

  _saveSettings() {
    const roundDelayMs = Math.min(
      Math.max(Number(document.getElementById('cfg-round-delay').value || 0), 0),
      60000
    );
    const config = {
      apiKey: document.getElementById('cfg-apikey').value.trim(),
      baseUrl: document.getElementById('cfg-baseurl').value.trim(),
      model: document.getElementById('cfg-model').value.trim(),
      protocol: document.getElementById('cfg-protocol').value,
      roundDelayMs,
      fontSize: Number(document.getElementById('cfg-fontsize').value),
      chatWidth: Number(document.getElementById('cfg-chat-width').value)
    };
    Config.set(config);
    UI.hideSettings();
    UI.setStatus('CONFIG SAVED', 'success');
    setTimeout(() => this._updateModeStatus(), 2000);
  },

  async _testConnection() {
    const status = document.getElementById('settings-status');
    const apiKey = document.getElementById('cfg-apikey').value.trim();
    const baseUrl = document.getElementById('cfg-baseurl').value.trim();

    if (!apiKey) {
      status.textContent = '[ERROR] API KEY REQUIRED';
      status.className = 'settings-status error';
      return;
    }

    status.textContent = 'TESTING CONNECTION...';
    status.className = 'settings-status';

    try {
      const res = await fetch(`${baseUrl}/v1/models`, {
        headers: { 'Authorization': `Bearer ${apiKey}` }
      });
      if (res.ok) {
        status.textContent = '[OK] CONNECTION ESTABLISHED';
        status.className = 'settings-status success';
      } else {
        const err = await res.text().catch(() => 'UNKNOWN');
        status.textContent = `[FAIL] ${res.status} ${err}`;
        status.className = 'settings-status error';
      }
    } catch (e) {
      status.textContent = `[ERROR] ${e.message}`;
      status.className = 'settings-status error';
    }
  }
};

document.addEventListener('DOMContentLoaded', () => App.init());
