const App = {
  _databases: [],
  _activeDatabase: '',

  async init() {
    this._restoreModeSelections();
    this._applyFontSize();
    this._applyBubbleWidth();
    this._applyChatOffset();
    await this._fetchConfig();
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

  _applyChatOffset() {
    const cfg = Config.get();
    const px = Number(cfg.chatOffset || 0);
    this._setChatOffset(px);
    const slider = document.getElementById('cfg-chat-offset');
    if (slider) slider.value = px;
    const label = document.getElementById('chatoffset-label');
    if (label) label.textContent = px;
  },

  _applyBubbleWidth() {
    const cfg = Config.get();
    const pct = Number(cfg.bubbleWidth ?? 100);
    this._setBubbleWidth(pct);
    const slider = document.getElementById('cfg-bubble-width');
    if (slider) slider.value = pct;
    const label = document.getElementById('bubblewidth-label');
    if (label) label.textContent = pct;
  },

  _setChatOffset(px) {
    const main = document.getElementById('main');
    main.style.setProperty('--chat-offset', px + 'px');
  },

  _setBubbleWidth(pct) {
    const main = document.getElementById('main');
    main.style.setProperty('--content-width', pct + '%');
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
    const depthLabel = { quick: '快速', deep: '深度', structured: '结构化' }[depth] || depth;
    const styleLabel = { dossier: '综合', research: '溯源', storytelling: '叙述' }[style] || style;
    UI.setStatus(`${depthLabel} / ${styleLabel}`);
  },

  _updateDatabaseUI(databaseName, databaseId) {
    this._activeDatabase = databaseId;

    // Update header label
    const headerLabel = document.getElementById('header-label');
    if (headerLabel) headerLabel.textContent = databaseName || '资料库';

    // Update welcome page badge
    const welcomeBadge = document.getElementById('welcome-badge-text');
    if (welcomeBadge) welcomeBadge.textContent = databaseName || '资料库';

    // Update sidebar logo subtitle
    const logoSub = document.querySelector('.logo-sub');
    if (logoSub) {
      logoSub.textContent = databaseName || '档案问询台';
    }

    // Update sidebar logo ::after content via CSS custom property
    const dbSuffix = databaseId === 'arknights' ? 'RHODES ISLAND' : (databaseName || 'DATABASE');
    document.documentElement.style.setProperty('--logo-suffix', `"${dbSuffix}"`);

    // Update page title
    document.title = `${databaseName || '资料库'} // 档案问询台`;
  },

  async _fetchConfig() {
    try {
      const res = await fetch('/api/config');
      const data = await res.json();

      // Store database list
      this._databases = data.databases || [];
      const activeDb = data.activeDatabase || '';

      // Render database selector
      const dbSelect = document.getElementById('db-select');
      if (dbSelect && this._databases.length > 0) {
        dbSelect.innerHTML = '';
        for (const db of this._databases) {
          const opt = document.createElement('option');
          opt.value = db.id;
          opt.textContent = db.name;
          dbSelect.appendChild(opt);
        }

        // Restore saved selection or use server default
        const cfg = Config.get();
        const savedDb = cfg.database;
        if (savedDb && this._databases.find(d => d.id === savedDb)) {
          dbSelect.value = savedDb;
        } else {
          dbSelect.value = activeDb;
          Config.set({ database: activeDb });
        }

        const selectedDb = this._databases.find(d => d.id === dbSelect.value);
        this._updateDatabaseUI(selectedDb?.name, dbSelect.value);
      }

      // Update stats if MCP servers connected
      if (data.mcpServers && data.mcpServers.length > 0) {
        const statDoc = document.getElementById('stat-documents');
        const statEnt = document.getElementById('stat-entities');
        const statUnit = document.getElementById('stat-units');
        if (statDoc) statDoc.textContent = '2.1K';
        if (statEnt) statEnt.textContent = '1.0K';
        if (statUnit) statUnit.textContent = '7.0K';
      }
    } catch (err) {
      console.error('Failed to fetch config:', err);
    }
  },

  _bindEvents() {
    document.getElementById('btn-send').addEventListener('click', () => this._handleSend());
    document.getElementById('btn-stop').addEventListener('click', () => Chat.abort());

    const input = document.getElementById('chat-input');
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        this._handleSend();
      }
    });
    input.addEventListener('input', () => {
      input.style.height = 'auto';
      input.style.height = Math.min(input.scrollHeight, 120) + 'px';
    });

    document.getElementById('btn-new-chat').addEventListener('click', () => this.newChat());

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

    document.getElementById('btn-settings').addEventListener('click', () => UI.showSettings());
    document.getElementById('btn-close-settings').addEventListener('click', () => UI.hideSettings());
    document.getElementById('btn-save-settings').addEventListener('click', () => this._saveSettings());
    document.getElementById('btn-test-connection').addEventListener('click', () => this._testConnection());

    document.querySelectorAll('.modal-backdrop').forEach(bg => {
      bg.addEventListener('click', () => UI.hideSettings());
    });

    document.getElementById('chat-messages').addEventListener('click', (e) => {
      if (e.target.classList.contains('copy-btn')) {
        const code = e.target.dataset.code;
        navigator.clipboard.writeText(code).then(() => {
          e.target.textContent = '已复制';
          setTimeout(() => { e.target.textContent = '复制'; }, 1500);
        });
      }
    });

    // Database selector
    const dbSelect = document.getElementById('db-select');
    if (dbSelect) {
      dbSelect.addEventListener('change', () => this._handleDatabaseChange());
    }

    document.getElementById('depth-select').addEventListener('change', () => {
      this._updateModeStatus();
      const depth = document.getElementById('depth-select').value;
      const style = document.getElementById('style-select').value;
      Config.set({ depth, style });
    });

    document.getElementById('style-select').addEventListener('change', () => {
      this._updateModeStatus();
      const depth = document.getElementById('depth-select').value;
      const style = document.getElementById('style-select').value;
      Config.set({ depth, style });
    });

    document.getElementById('cfg-fontsize').addEventListener('input', (e) => {
      const size = e.target.value;
      document.getElementById('fontsize-label').textContent = size;
      document.documentElement.style.setProperty('--font-size', size + 'px');
    });

    document.getElementById('cfg-bubble-width').addEventListener('input', (e) => {
      const pct = Number(e.target.value);
      document.getElementById('bubblewidth-label').textContent = pct;
      this._setBubbleWidth(pct);
    });

    document.getElementById('cfg-chat-offset').addEventListener('input', (e) => {
      const px = Number(e.target.value);
      document.getElementById('chatoffset-label').textContent = px;
      this._setChatOffset(px);
    });

    document.addEventListener('keydown', (e) => {
      if (e.ctrlKey && e.key === ',') {
        e.preventDefault();
        UI.showSettings();
      }
    });
  },

  async _handleDatabaseChange() {
    const dbSelect = document.getElementById('db-select');
    const databaseId = dbSelect.value;
    const database = this._databases.find(d => d.id === databaseId);

    UI.setStatus('切换数据源...');

    try {
      const res = await fetch('/api/database/switch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ databaseId })
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: '切换失败' }));
        throw new Error(err.error || '切换失败');
      }

      const data = await res.json();
      Config.set({ database: databaseId });
      this._updateDatabaseUI(data.name, databaseId);
      UI.setStatus('数据源已切换', 'success');
      setTimeout(() => this._updateModeStatus(), 2000);

      // Refresh stats
      await this._fetchConfig();
    } catch (err) {
      console.error('Database switch failed:', err);
      UI.setStatus(`切换失败: ${err.message}`, 'error');
      // Revert selection
      dbSelect.value = this._activeDatabase;
    }
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
    const selectedDb = this._databases.find(d => d.id === this._activeDatabase);
    container.innerHTML = UI.welcomeMarkup({
      databaseName: selectedDb?.name || '资料库',
      documents: '2.1K',
      entities: '1.0K',
      units: '7.0K'
    });
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
      roundDelayMs,
      fontSize: Number(document.getElementById('cfg-fontsize').value),
      bubbleWidth: Number(document.getElementById('cfg-bubble-width').value),
      chatOffset: Number(document.getElementById('cfg-chat-offset').value)
    };
    Config.set(config);
    UI.hideSettings();
    UI.setStatus('设置已保存', 'success');
    setTimeout(() => this._updateModeStatus(), 2000);
  },

  async _testConnection() {
    const status = document.getElementById('settings-status');
    const apiKey = document.getElementById('cfg-apikey').value.trim();
    const baseUrl = document.getElementById('cfg-baseurl').value.trim();

    if (!apiKey) {
      status.textContent = '[错误] 需要 API Key';
      status.className = 'settings-status error';
      return;
    }

    status.textContent = '正在测试连接...';
    status.className = 'settings-status';

    try {
      const res = await fetch(`${baseUrl}/v1/models`, {
        headers: { 'Authorization': `Bearer ${apiKey}` }
      });
      if (res.ok) {
        status.textContent = '[完成] 连接可用';
        status.className = 'settings-status success';
      } else {
        const err = await res.text().catch(() => 'UNKNOWN');
        status.textContent = `[失败] ${res.status} ${err}`;
        status.className = 'settings-status error';
      }
    } catch (e) {
      status.textContent = `[错误] ${e.message}`;
      status.className = 'settings-status error';
    }
  }
};

document.addEventListener('DOMContentLoaded', () => App.init());
