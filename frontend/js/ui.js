const UI = {
  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  },

  welcomeMarkup(stats = {}) {
    const dbName = stats.databaseName || '资料库';
    return `
      <div class="welcome-screen">
        <div class="welcome-badge">
          <span class="badge-stripe"></span>
          <span id="welcome-badge-text">${dbName}</span>
          <span class="badge-stripe"></span>
        </div>
        <div class="welcome-logo">IRIS</div>
        <h2>档案问询台</h2>
        <p class="welcome-subtitle">内容检索 / 资料解析 / 情报分析</p>
        <div class="welcome-stats">
          <div class="stat-item"><span class="stat-val" id="stat-documents">${stats.documents || '--'}</span><span class="stat-lbl">文档</span></div>
          <div class="stat-sep"></div>
          <div class="stat-item"><span class="stat-val" id="stat-entities">${stats.entities || '--'}</span><span class="stat-lbl">实体</span></div>
          <div class="stat-sep"></div>
          <div class="stat-item"><span class="stat-val" id="stat-units">${stats.units || '--'}</span><span class="stat-lbl">文本单元</span></div>
        </div>
        <p class="welcome-hint">在设置中配置 API 后，输入你的问题开始问询。</p>
      </div>`;
  },

  scrollChatToBottom(force = false) {
    const container = document.getElementById('chat-messages');
    if (!container) return;
    if (force) {
      container.scrollTop = container.scrollHeight;
      return;
    }
    const threshold = 50;
    const distanceFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
    if (distanceFromBottom < threshold) {
      container.scrollTop = container.scrollHeight;
    }
  },

  formatDate(isoString) {
    const d = new Date(isoString);
    const now = new Date();
    const diff = now - d;
    if (diff < 60000) return '刚刚';
    if (diff < 3600000) return `${Math.floor(diff / 60000)} 分钟前`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)} 小时前`;
    if (diff < 604800000) return `${Math.floor(diff / 86400000)} 天前`;
    return d.toLocaleDateString();
  },

  renderMarkdown(text) {
    if (!text) return '';

    let html = this.escapeHtml(text);

    html = html.replace(/```(\w*)\n?([\s\S]*?)```/g, (_m, lang, code) => {
      const langLabel = lang ? `<span class="code-lang">${lang}</span>` : '';
      const copyBtn = `<button class="copy-btn" data-code="${this.escapeHtml(code.trim())}">复制</button>`;
      return `<pre>${langLabel}${copyBtn}<code>${code.trim()}</code></pre>`;
    });

    html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
    html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>');
    html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
    html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>');
    html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>');
    html = html.replace(/^[*-] (.+)$/gm, '<li>$1</li>');
    html = html.replace(/(<li>.*<\/li>)\n?(?!<li>)/gs, '<ul>$1</ul>');
    html = html.replace(/<\/ul>\n<ul>/g, '\n');
    html = html.replace(/^\d+\. (.+)$/gm, '<li>$1</li>');
    html = html.replace(/^&gt; (.+)$/gm, '<blockquote>$1</blockquote>');
    html = html.replace(/^---$/gm, '<hr>');

    html = html.replace(/\|(.+)\|/g, (_m, content) => {
      const cells = content.split('|').map(c => c.trim());
      if (cells.every(c => /^[-:]+$/.test(c))) return '';
      return '<tr>' + cells.map(c => `<td>${c}</td>`).join('') + '</tr>';
    });

    html = html.replace(/\n\n/g, '</p><p>');
    html = html.replace(/\n/g, '<br>');
    if (!html.startsWith('<')) html = `<p>${html}</p>`;
    html = html.replace(/<p><\/p>/g, '');

    return html;
  },

  addMessage(role, content) {
    const container = document.getElementById('chat-messages');
    const welcome = container.querySelector('.welcome-screen');
    if (welcome) welcome.remove();

    const div = document.createElement('div');
    div.className = `message ${role}`;

    const avatar = role === 'user' ? 'YOU' : 'PRT';
    const rendered = role === 'user'
      ? `<p>${this.escapeHtml(content || '')}</p>`
      : this.renderMarkdown(content || '');
    div.innerHTML = `<div class="message-avatar">${avatar}</div><div class="message-content">${rendered}</div>`;

    container.appendChild(div);
    requestAnimationFrame(() => this.scrollChatToBottom(true));
    return div.querySelector('.message-content');
  },

  createToolGroup() {
    const container = document.getElementById('chat-messages');
    const welcome = container.querySelector('.welcome-screen');
    if (welcome) welcome.remove();

    const div = document.createElement('div');
    div.className = 'message assistant tool-message';
    div.innerHTML = `
      <div class="message-avatar">LOG</div>
      <div class="message-content tool-message-content">
        <div class="tool-panel" data-total="0" data-done="0">
          <div class="tool-panel-header" data-action="toggle-tool-panel">
            <div class="tool-panel-title">
              <span class="tool-panel-caret">›</span>
              <span>检索过程</span>
            </div>
            <div class="tool-panel-summary">0 个工具执行中</div>
          </div>
          <div class="tool-timeline"></div>
        </div>
      </div>`;

    const streamingEl = container.querySelector('.streaming-cursor');
    if (streamingEl) {
      container.insertBefore(div, streamingEl.closest('.message'));
    } else {
      container.appendChild(div);
    }

    const panel = div.querySelector('.tool-panel');
    div.querySelector('.tool-panel-header').addEventListener('click', () => {
      panel.classList.toggle('collapsed');
    });

    return panel;
  },

  addToolCard(name, args, groupEl = null) {
    const panel = groupEl || this.createToolGroup();
    const shortName = name.replace(/^mcp_lore-db_/, '');
    const timeline = panel.querySelector('.tool-timeline');
    const total = Number(panel.dataset.total || 0) + 1;
    panel.dataset.total = total;

    const item = document.createElement('div');
    item.className = 'tool-node running';
    item.dataset.toolName = shortName;
    item.innerHTML = `
      <span class="tool-node-dot"></span>
      <span class="tool-node-card">
        <span class="tool-node-name">检索过程 / ${this.escapeHtml(shortName)}</span>
        <span class="tool-node-status">执行中</span>
      </span>`;
    timeline.appendChild(item);

    this.updateToolPanelSummary(panel);
    requestAnimationFrame(() => {
      timeline.scrollTop = timeline.scrollHeight;
      this.scrollChatToBottom(false);
    });

    return { groupEl: panel, itemEl: item };
  },

  updateToolResult(toolDiv, result) {
    if (!toolDiv) return;
    toolDiv.classList.remove('running');
    toolDiv.classList.add('done');
    const status = toolDiv.querySelector('.tool-node-status');
    if (status) status.textContent = '完成';

    const panel = toolDiv.closest('.tool-panel');
    if (panel) {
      panel.dataset.done = Number(panel.dataset.done || 0) + 1;
      this.updateToolPanelSummary(panel);
    }
  },

  updateToolPanelSummary(panel) {
    const total = Number(panel.dataset.total || 0);
    const done = Number(panel.dataset.done || 0);
    const running = Math.max(total - done, 0);
    const summary = panel.querySelector('.tool-panel-summary');
    if (!summary) return;
    summary.textContent = running
      ? `${running} 个执行中 / ${done} 个完成`
      : `${done} 个工具已完成`;
  },

  finalizeToolGroup(panel) {
    if (!panel) return;
    panel.classList.add('complete');
    this.updateToolPanelSummary(panel);
  },

  addStreamingMessage() {
    const container = document.getElementById('chat-messages');
    const welcome = container.querySelector('.welcome-screen');
    if (welcome) welcome.remove();

    const div = document.createElement('div');
    div.className = 'message assistant';
    div.innerHTML = `<div class="message-avatar">PRT</div><div class="message-content streaming-cursor"><div class="typing-dots"><span></span><span></span><span></span></div></div>`;
    container.appendChild(div);

    requestAnimationFrame(() => {
      container.scrollTop = container.scrollHeight;
    });

    return div.querySelector('.message-content');
  },

  finalizeStreamingMessage(el) {
    el.classList.remove('streaming-cursor');
  },

  renderSessionList(sessions, activeId) {
    const list = document.getElementById('session-list');
    list.innerHTML = '';

    for (const [idx, s] of sessions.entries()) {
      const item = document.createElement('div');
      item.className = `session-item${s.id === activeId ? ' active' : ''}`;
      item.dataset.id = s.id;
      const code = `A-${String(idx + 1).padStart(3, '0')}`;
      item.innerHTML = `
        <span class="session-code">${code}</span>
        <span class="session-item-title">${this.escapeHtml(s.title)}</span>
        <span class="session-item-delete" data-action="delete-session" data-id="${s.id}">&times;</span>
      `;
      list.appendChild(item);
    }
  },

  setStatus(text, type = '') {
    const el = document.getElementById('header-status');
    el.textContent = text;
    el.className = 'header-status ' + type;
  },

  showSettings() {
    const cfg = Config.get();
    document.getElementById('cfg-apikey').value = cfg.apiKey;
    document.getElementById('cfg-baseurl').value = cfg.baseUrl;
    document.getElementById('cfg-model').value = cfg.model;
    document.getElementById('cfg-round-delay').value = Number(cfg.roundDelayMs || 0);
    document.getElementById('cfg-fontsize').value = cfg.fontSize || 13;
    document.getElementById('fontsize-label').textContent = cfg.fontSize || 13;
    document.getElementById('cfg-bubble-width').value = cfg.bubbleWidth ?? 100;
    document.getElementById('bubblewidth-label').textContent = cfg.bubbleWidth ?? 100;
    document.getElementById('cfg-chat-offset').value = cfg.chatOffset || 0;
    document.getElementById('chatoffset-label').textContent = cfg.chatOffset || 0;
    document.getElementById('settings-modal').classList.remove('hidden');
  },

  hideSettings() {
    document.getElementById('settings-modal').classList.add('hidden');
  },

  async loadSkills() {},
  async loadMCPServers() {}
};
