const UI = {
  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  },

  formatDate(isoString) {
    const d = new Date(isoString);
    const now = new Date();
    const diff = now - d;
    if (diff < 60000) return 'NOW';
    if (diff < 3600000) return `${Math.floor(diff / 60000)}M AGO`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}H AGO`;
    if (diff < 604800000) return `${Math.floor(diff / 86400000)}D AGO`;
    return d.toLocaleDateString();
  },

  // Markdown-to-HTML renderer
  renderMarkdown(text) {
    if (!text) return '';

    let html = this.escapeHtml(text);

    // Code blocks with language
    html = html.replace(/```(\w*)\n?([\s\S]*?)```/g, (_m, lang, code) => {
      const langLabel = lang ? `<span class="code-lang">${lang}</span>` : '';
      const copyBtn = `<button class="copy-btn" data-code="${this.escapeHtml(code.trim())}">COPY</button>`;
      return `<pre>${langLabel}${copyBtn}<code>${code.trim()}</code></pre>`;
    });

    // Inline code
    html = html.replace(/`([^`]+)`/g, '<code>$1</code>');

    // Bold
    html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');

    // Italic
    html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>');

    // Headers
    html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
    html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>');
    html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>');

    // Unordered lists
    html = html.replace(/^[*-] (.+)$/gm, '<li>$1</li>');
    html = html.replace(/(<li>.*<\/li>)\n?(?!<li>)/gs, '<ul>$1</ul>');
    html = html.replace(/<\/ul>\n<ul>/g, '\n');

    // Ordered lists
    html = html.replace(/^\d+\. (.+)$/gm, '<li>$1</li>');

    // Blockquotes
    html = html.replace(/^&gt; (.+)$/gm, '<blockquote>$1</blockquote>');

    // Horizontal rules
    html = html.replace(/^---$/gm, '<hr>');

    // Tables
    html = html.replace(/\|(.+)\|/g, (_m, content) => {
      const cells = content.split('|').map(c => c.trim());
      if (cells.every(c => /^[-:]+$/.test(c))) return ''; // skip separator rows
      const tag = 'td';
      return '<tr>' + cells.map(c => `<${tag}>${c}</${tag}>`).join('') + '</tr>';
    });

    // Line breaks
    html = html.replace(/\n\n/g, '</p><p>');
    html = html.replace(/\n/g, '<br>');

    // Wrap in paragraphs
    if (!html.startsWith('<')) html = `<p>${html}</p>`;

    // Clean up empty paragraphs
    html = html.replace(/<p><\/p>/g, '');

    return html;
  },

  addMessage(role, content) {
    const container = document.getElementById('chat-messages');
    // Remove welcome screen if present
    const welcome = container.querySelector('.welcome-screen');
    if (welcome) welcome.remove();

    const div = document.createElement('div');
    div.className = `message ${role}`;

    const avatar = role === 'user' ? '>' : '⚠';
    const rendered = role === 'user'
      ? `<p>${this.escapeHtml(content || '')}</p>`
      : this.renderMarkdown(content || '');
    div.innerHTML = `<div class="message-avatar">${avatar}</div><div class="message-content">${rendered}</div>`;

    container.appendChild(div);
    // Scroll to bottom after message is added
    requestAnimationFrame(() => {
      container.scrollTop = container.scrollHeight;
    });
    return div.querySelector('.message-content');
  },

  addToolCard(name, args) {
    const container = document.getElementById('chat-messages');
    // Remove welcome screen if present
    const welcome = container.querySelector('.welcome-screen');
    if (welcome) welcome.remove();

    const div = document.createElement('div');
    div.className = 'message assistant';
    const shortName = name.replace(/^mcp_lore-db_/, '');
    div.innerHTML = `
      <div class="message-avatar">⚙</div>
      <div class="message-content">
        <div class="tool-card">
          <div class="tool-card-header" data-action="toggle-tool">
            <span class="tool-card-icon">▶</span>
            <span class="tool-card-name">${this.escapeHtml(shortName)}</span>
            <span class="tool-card-status running">EXEC</span>
          </div>
          <div class="tool-card-body">
            <div><strong>ARGS:</strong> ${this.escapeHtml(args || '{}')}</div>
            <div class="tool-result-placeholder"></div>
          </div>
        </div>
      </div>`;

    // Insert tool card BEFORE the streaming message
    const streamingEl = container.querySelector('.streaming-cursor');
    if (streamingEl) {
      container.insertBefore(div, streamingEl.closest('.message'));
    } else {
      container.appendChild(div);
    }

    // Scroll to bottom
    requestAnimationFrame(() => {
      container.scrollTop = container.scrollHeight;
    });

    // Toggle handler
    const header = div.querySelector('.tool-card-header');
    header.addEventListener('click', () => {
      const card = div.querySelector('.tool-card');
      card.classList.toggle('open');
    });

    return div;
  },

  updateToolResult(toolDiv, result) {
    const body = toolDiv.querySelector('.tool-card-body');
    const status = toolDiv.querySelector('.tool-card-status');
    const placeholder = body.querySelector('.tool-result-placeholder');
    if (placeholder) {
      placeholder.innerHTML = `<strong>RESULT:</strong>\n${this.escapeHtml(result || '(EMPTY)')}`;
    } else {
      body.innerHTML += `\n\n<strong>RESULT:</strong>\n${this.escapeHtml(result || '(EMPTY)')}`;
    }
    status.textContent = 'DONE';
    status.className = 'tool-card-status done';

    // Auto-collapse after showing result
    const card = toolDiv.querySelector('.tool-card');
    if (card) card.classList.remove('open');
  },

  addStreamingMessage() {
    const container = document.getElementById('chat-messages');
    const welcome = container.querySelector('.welcome-screen');
    if (welcome) welcome.remove();

    const div = document.createElement('div');
    div.className = 'message assistant';
    div.innerHTML = `<div class="message-avatar">⚠</div><div class="message-content streaming-cursor"><div class="typing-dots"><span></span><span></span><span></span></div></div>`;
    container.appendChild(div);

    // Scroll to bottom immediately
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

    for (const s of sessions) {
      const item = document.createElement('div');
      item.className = `session-item${s.id === activeId ? ' active' : ''}`;
      item.dataset.id = s.id;
      item.innerHTML = `
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
    document.getElementById('cfg-protocol').value = cfg.protocol;
    document.getElementById('settings-modal').classList.remove('hidden');
  },

  hideSettings() {
    document.getElementById('settings-modal').classList.add('hidden');
  },

  async loadSkills() {
    // No-op: skills are now resolved server-side from depth + style.
    // Kept for backward compatibility with any existing calls.
  },

  async loadMCPServers() {
    try {
      const res = await fetch('/api/config');
      const data = await res.json();
      const list = document.getElementById('mcp-server-list');
      list.innerHTML = '';
      for (const s of data.mcpServers) {
        const item = document.createElement('div');
        item.className = 'mcp-server-item';
        item.innerHTML = `
          <div class="mcp-server-info">
            <div class="mcp-server-name">${this.escapeHtml(s.id)}</div>
            <div class="mcp-server-status ${s.status}">${s.status.toUpperCase()}${s.toolCount ? ` [${s.toolCount} TOOLS]` : ''}</div>
          </div>
          <button class="btn-mcp-remove" data-action="remove-mcp" data-id="${s.id}">REMOVE</button>
        `;
        list.appendChild(item);
      }
    } catch {}
  }
};
