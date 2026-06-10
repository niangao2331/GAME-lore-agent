const Admin = {
  token: localStorage.getItem('iris_admin_token') || '',
  currentDocument: null,
  currentEntity: null,

  init() {
    document.getElementById('admin-token').value = this.token;
    document.getElementById('save-token').addEventListener('click', () => {
      this.token = document.getElementById('admin-token').value.trim();
      localStorage.setItem('iris_admin_token', this.token);
      this.status('令牌已保存', 'ok');
    });

    document.querySelectorAll('.tab').forEach(btn => {
      btn.addEventListener('click', () => this.switchTab(btn.dataset.tab));
    });

    document.getElementById('search-documents').addEventListener('click', () => this.searchDocuments());
    document.getElementById('new-document').addEventListener('click', () => this.newDocument());
    document.getElementById('save-document').addEventListener('click', () => this.saveDocument());
    document.getElementById('add-unit').addEventListener('click', () => this.addUnit());
    document.getElementById('rebuild-mentions').addEventListener('click', () => this.rebuildMentions());
    document.getElementById('delete-document').addEventListener('click', () => this.deleteDocument());

    document.getElementById('search-entities').addEventListener('click', () => this.searchEntities());
    document.getElementById('new-entity').addEventListener('click', () => this.newEntity());
    document.getElementById('save-entity').addEventListener('click', () => this.saveEntity());
    document.getElementById('add-alias').addEventListener('click', () => this.addAlias());

    this.searchDocuments();
  },

  headers() {
    const headers = { 'Content-Type': 'application/json' };
    if (this.token) headers['x-admin-token'] = this.token;
    return headers;
  },

  async api(path, options = {}) {
    const res = await fetch(path, { ...options, headers: { ...this.headers(), ...(options.headers || {}) } });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
    return json;
  },

  status(text, kind = '') {
    const el = document.getElementById('status');
    el.textContent = text;
    el.className = kind;
  },

  escape(value) {
    return String(value ?? '').replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  },

  parseJson(id, fallback = {}) {
    const value = document.getElementById(id).value.trim();
    if (!value) return fallback;
    return JSON.parse(value);
  },

  switchTab(tab) {
    document.querySelectorAll('.tab').forEach(btn => btn.classList.toggle('active', btn.dataset.tab === tab));
    document.getElementById('document-search').classList.toggle('hidden', tab !== 'documents');
    document.getElementById('entity-search').classList.toggle('hidden', tab !== 'entities');
  },

  async searchDocuments() {
    try {
      this.status('正在搜索文档');
      const params = new URLSearchParams();
      const fields = {
        query: 'document-query',
        content_type: 'document-content-type',
        entity: 'document-entity',
        source_tier: 'document-source-tier',
        review_status: 'document-review-filter',
      };
      for (const [key, id] of Object.entries(fields)) {
        const value = document.getElementById(id).value.trim();
        if (value) params.set(key, value);
      }
      const data = await this.api(`/api/admin/documents?${params}`);
      const list = document.getElementById('document-results');
      list.innerHTML = data.rows.map(row => `
        <div class="result-item" data-document-id="${row.document_id}">
          <div class="result-title">#${row.document_id} ${this.escape(row.title)}</div>
          <div class="result-meta">${this.escape(row.content_type)} / tier ${row.source_tier} / ${this.escape(row.review_status)} / units ${row.unit_count}</div>
          <div class="result-preview">${this.escape(row.text_preview || '')}</div>
        </div>
      `).join('');
      list.querySelectorAll('[data-document-id]').forEach(el => {
        el.addEventListener('click', () => this.loadDocument(el.dataset.documentId));
      });
      this.status(`找到文档：${data.rows.length}`, 'ok');
    } catch (err) {
      this.status(err.message, 'danger');
    }
  },

  newDocument() {
    this.currentDocument = { document: { source_tier: 1, content_type: 'event_story', canon_status: 'official', review_status: 'pending', metadata: {} }, units: [], mentions: [], revisions: [] };
    this.currentEntity = null;
    this.showDocument();
  },

  async loadDocument(documentId) {
    try {
      this.status(`正在加载文档 ${documentId}`);
      this.currentDocument = await this.api(`/api/admin/documents/${documentId}`);
      this.currentEntity = null;
      this.showDocument();
      await this.loadAudit('document', documentId);
      this.status('文档已加载', 'ok');
    } catch (err) {
      this.status(err.message, 'danger');
    }
  },

  showDocument() {
    document.getElementById('empty-state').classList.add('hidden');
    document.getElementById('document-editor').classList.remove('hidden');
    document.getElementById('entity-editor').classList.add('hidden');

    const d = this.currentDocument.document;
    document.getElementById('document-id').textContent = d.document_id ? `文档 ${d.document_id}` : '新文档';
    document.getElementById('document-title').value = d.title || '';
    document.getElementById('document-subtitle').value = d.subtitle || '';
    document.getElementById('document-source-name').value = d.source_name || '';
    document.getElementById('document-source-uri').value = d.source_uri || '';
    document.getElementById('document-content-type-edit').value = d.content_type || 'event_story';
    document.getElementById('document-source-tier-edit').value = d.source_tier || 1;
    document.getElementById('document-canon-status').value = d.canon_status || 'official';
    document.getElementById('document-review-status').value = d.review_status || 'pending';
    document.getElementById('document-perspective-scope').value = d.perspective_scope || '';
    document.getElementById('document-metadata').value = JSON.stringify(d.metadata || {}, null, 2);

    this.renderUnits(this.currentDocument.units || []);
    this.renderMentions(this.currentDocument.mentions || []);
    this.renderRevisions(this.currentDocument.revisions || []);
    this.renderAliases([]);
  },

  documentBody() {
    return {
      title: document.getElementById('document-title').value.trim(),
      subtitle: document.getElementById('document-subtitle').value.trim() || null,
      source_name: document.getElementById('document-source-name').value.trim() || null,
      source_uri: document.getElementById('document-source-uri').value.trim() || null,
      content_type: document.getElementById('document-content-type-edit').value.trim() || 'event_story',
      source_tier: Number(document.getElementById('document-source-tier-edit').value || 1),
      canon_status: document.getElementById('document-canon-status').value,
      review_status: document.getElementById('document-review-status').value,
      perspective_scope: document.getElementById('document-perspective-scope').value.trim() || null,
      metadata: this.parseJson('document-metadata', {}),
    };
  },

  async saveDocument() {
    try {
      const body = this.documentBody();
      if (!body.title) throw new Error('标题不能为空');
      if (this.currentDocument?.document?.document_id) {
        const id = this.currentDocument.document.document_id;
        await this.api(`/api/admin/documents/${id}`, { method: 'PATCH', body: JSON.stringify(body) });
        await this.loadDocument(id);
      } else {
        const data = await this.api('/api/admin/documents', { method: 'POST', body: JSON.stringify(body) });
        await this.loadDocument(data.document.document_id);
      }
      await this.searchDocuments();
      this.status('文档已保存', 'ok');
    } catch (err) {
      this.status(err.message, 'danger');
    }
  },

  renderUnits(units) {
    document.getElementById('unit-list').innerHTML = units.map(unit => `
      <div class="chunk-card" data-unit-card="${unit.unit_id}">
        <div class="chunk-main">unit ${unit.unit_id} / index ${unit.unit_index} / ${this.escape(unit.unit_kind)} / ${this.escape(unit.review_status)}</div>
        <div class="meta-grid">
          <input data-unit-field="${unit.unit_id}:unit_index" type="number" value="${unit.unit_index ?? 0}">
          <input data-unit-field="${unit.unit_id}:unit_kind" value="${this.escape(unit.unit_kind || 'chunk')}">
          <input data-unit-field="${unit.unit_id}:heading" value="${this.escape(unit.heading || '')}" placeholder="heading">
          <input data-unit-field="${unit.unit_id}:speaker" value="${this.escape(unit.speaker || '')}" placeholder="speaker">
          <input data-unit-field="${unit.unit_id}:scene_code" value="${this.escape(unit.scene_code || '')}" placeholder="scene_code">
          <select data-unit-field="${unit.unit_id}:review_status">
            ${['pending','approved','needs_review','seeded','rejected'].map(s => `<option value="${s}" ${s === unit.review_status ? 'selected' : ''}>${s}</option>`).join('')}
          </select>
          <input data-unit-field="${unit.unit_id}:content_type" value="${this.escape(unit.content_type || '')}" placeholder="content_type">
          <input data-unit-field="${unit.unit_id}:source_tier" type="number" min="1" max="5" value="${unit.source_tier || 1}">
        </div>
        <textarea data-unit-field="${unit.unit_id}:text" spellcheck="false">${this.escape(unit.text || '')}</textarea>
        <textarea data-unit-field="${unit.unit_id}:metadata" spellcheck="false" placeholder="metadata JSON">${this.escape(JSON.stringify(unit.metadata || {}, null, 2))}</textarea>
        <div class="button-row">
          <button data-save-unit="${unit.unit_id}">保存单元</button>
          <button data-delete-unit="${unit.unit_id}" class="danger">删除单元</button>
        </div>
      </div>
    `).join('');
    document.querySelectorAll('[data-save-unit]').forEach(btn => {
      btn.addEventListener('click', () => this.saveUnit(btn.dataset.saveUnit));
    });
    document.querySelectorAll('[data-delete-unit]').forEach(btn => {
      btn.addEventListener('click', () => this.deleteUnit(btn.dataset.deleteUnit));
    });
  },

  unitValue(unitId, field) {
    return document.querySelector(`[data-unit-field="${unitId}:${field}"]`).value;
  },

  async saveUnit(unitId) {
    try {
      const body = {
        unit_index: Number(this.unitValue(unitId, 'unit_index')),
        unit_kind: this.unitValue(unitId, 'unit_kind'),
        heading: this.unitValue(unitId, 'heading') || null,
        speaker: this.unitValue(unitId, 'speaker') || null,
        scene_code: this.unitValue(unitId, 'scene_code') || null,
        review_status: this.unitValue(unitId, 'review_status'),
        content_type: this.unitValue(unitId, 'content_type') || this.currentDocument.document.content_type,
        source_tier: Number(this.unitValue(unitId, 'source_tier') || this.currentDocument.document.source_tier),
        text: this.unitValue(unitId, 'text'),
        metadata: JSON.parse(this.unitValue(unitId, 'metadata') || '{}'),
      };
      await this.api(`/api/admin/text-units/${unitId}`, { method: 'PATCH', body: JSON.stringify(body) });
      await this.loadDocument(this.currentDocument.document.document_id);
      this.status('文本单元已保存', 'ok');
    } catch (err) {
      this.status(err.message, 'danger');
    }
  },

  async addUnit() {
    if (!this.currentDocument?.document?.document_id) {
      await this.saveDocument();
    }
    const id = this.currentDocument?.document?.document_id;
    if (!id) return;
    try {
      await this.api(`/api/admin/documents/${id}/text-units`, {
        method: 'POST',
        body: JSON.stringify({
          unit_kind: 'chunk',
          text: '',
          source_tier: this.currentDocument.document.source_tier,
          content_type: this.currentDocument.document.content_type,
          review_status: 'pending',
        }),
      });
      await this.loadDocument(id);
      this.status('文本单元已新增', 'ok');
    } catch (err) {
      this.status(err.message, 'danger');
    }
  },

  async deleteUnit(unitId) {
    try {
      await this.api(`/api/admin/text-units/${unitId}`, { method: 'DELETE', body: '{}' });
      await this.loadDocument(this.currentDocument.document.document_id);
      this.status('文本单元已删除', 'ok');
    } catch (err) {
      this.status(err.message, 'danger');
    }
  },

  async rebuildMentions() {
    const id = this.currentDocument?.document?.document_id;
    if (!id) return;
    try {
      const data = await this.api(`/api/admin/documents/${id}/rebuild-mentions`, { method: 'POST', body: '{}' });
      await this.loadDocument(id);
      this.status(`实体提及已重建：${data.inserted}`, 'ok');
    } catch (err) {
      this.status(err.message, 'danger');
    }
  },

  async deleteDocument() {
    const id = this.currentDocument?.document?.document_id;
    if (!id) return;
    try {
      await this.api(`/api/admin/documents/${id}`, { method: 'DELETE', body: '{}' });
      this.currentDocument = null;
      document.getElementById('document-editor').classList.add('hidden');
      document.getElementById('empty-state').classList.remove('hidden');
      await this.searchDocuments();
      this.status('文档已删除', 'ok');
    } catch (err) {
      this.status(err.message, 'danger');
    }
  },

  async searchEntities() {
    try {
      this.status('正在搜索实体');
      const params = new URLSearchParams();
      const query = document.getElementById('entity-query').value.trim();
      const entityType = document.getElementById('entity-type-filter').value.trim();
      const reviewStatus = document.getElementById('entity-review-filter').value.trim();
      if (query) params.set('query', query);
      if (entityType) params.set('entity_type', entityType);
      if (reviewStatus) params.set('review_status', reviewStatus);
      const data = await this.api(`/api/admin/entities?${params}`);
      const list = document.getElementById('entity-results');
      list.innerHTML = data.rows.map(row => `
        <div class="result-item" data-entity-id="${row.entity_id}">
          <div class="result-title">#${row.entity_id} ${this.escape(row.name)}</div>
          <div class="result-meta">${this.escape(row.entity_type)} / ${this.escape(row.review_status)} / docs ${row.document_count}</div>
          <div class="result-preview">${this.escape(row.summary || '')}</div>
        </div>
      `).join('');
      list.querySelectorAll('[data-entity-id]').forEach(el => {
        el.addEventListener('click', () => this.loadEntity(el.dataset.entityId));
      });
      this.status(`找到实体：${data.rows.length}`, 'ok');
    } catch (err) {
      this.status(err.message, 'danger');
    }
  },

  newEntity() {
    this.currentEntity = { entity: { entity_type: 'character', review_status: 'pending', properties: {} }, aliases: [], mentions: [] };
    this.currentDocument = null;
    this.showEntity();
  },

  async loadEntity(entityId) {
    try {
      this.status(`正在加载实体 ${entityId}`);
      this.currentEntity = await this.api(`/api/admin/entities/${entityId}`);
      this.currentDocument = null;
      this.showEntity();
      await this.loadAudit('entity', entityId);
      this.status('实体已加载', 'ok');
    } catch (err) {
      this.status(err.message, 'danger');
    }
  },

  showEntity() {
    document.getElementById('empty-state').classList.add('hidden');
    document.getElementById('document-editor').classList.add('hidden');
    document.getElementById('entity-editor').classList.remove('hidden');
    const e = this.currentEntity.entity;
    document.getElementById('entity-id').textContent = e.entity_id ? `实体 ${e.entity_id}` : '新实体';
    document.getElementById('entity-name').value = e.name || '';
    document.getElementById('entity-type').value = e.entity_type || 'character';
    document.getElementById('entity-name-en').value = e.name_en || '';
    document.getElementById('entity-review-status').value = e.review_status || 'pending';
    document.getElementById('entity-summary').value = e.summary || '';
    document.getElementById('entity-properties').value = JSON.stringify(e.properties || {}, null, 2);
    this.renderAliases(this.currentEntity.aliases || []);
    this.renderMentions(this.currentEntity.mentions || []);
    this.renderRevisions([]);
  },

  async saveEntity() {
    try {
      const body = {
        name: document.getElementById('entity-name').value.trim(),
        entity_type: document.getElementById('entity-type').value.trim() || 'character',
        name_en: document.getElementById('entity-name-en').value.trim() || null,
        review_status: document.getElementById('entity-review-status').value,
        summary: document.getElementById('entity-summary').value.trim() || null,
        properties: this.parseJson('entity-properties', {}),
      };
      if (!body.name) throw new Error('实体名不能为空');
      if (this.currentEntity?.entity?.entity_id) {
        const id = this.currentEntity.entity.entity_id;
        await this.api(`/api/admin/entities/${id}`, { method: 'PATCH', body: JSON.stringify(body) });
        await this.loadEntity(id);
      } else {
        const data = await this.api('/api/admin/entities', { method: 'POST', body: JSON.stringify(body) });
        await this.loadEntity(data.entity.entity_id);
      }
      await this.searchEntities();
      this.status('实体已保存', 'ok');
    } catch (err) {
      this.status(err.message, 'danger');
    }
  },

  async addAlias() {
    const id = this.currentEntity?.entity?.entity_id;
    if (!id) return;
    const alias = document.getElementById('alias-value').value.trim();
    if (!alias) return;
    try {
      await this.api(`/api/admin/entities/${id}/aliases`, {
        method: 'POST',
        body: JSON.stringify({ alias, alias_kind: 'alias', source: 'manual', confidence: 1 }),
      });
      document.getElementById('alias-value').value = '';
      await this.loadEntity(id);
      this.status('别名已保存', 'ok');
    } catch (err) {
      this.status(err.message, 'danger');
    }
  },

  async deleteAlias(aliasId) {
    try {
      await this.api(`/api/admin/aliases/${aliasId}`, { method: 'DELETE' });
      await this.loadEntity(this.currentEntity.entity.entity_id);
      this.status('别名已删除', 'ok');
    } catch (err) {
      this.status(err.message, 'danger');
    }
  },

  renderAliases(aliases) {
    document.getElementById('alias-list').innerHTML = aliases.map(alias => `
      <div class="tag-card">
        <div class="tag-main">#${alias.alias_id} ${this.escape(alias.alias)}</div>
        <div class="result-meta">${this.escape(alias.alias_kind)} / ${this.escape(alias.source)} / ${alias.confidence}</div>
        <div class="button-row"><button data-delete-alias="${alias.alias_id}" class="danger">删除别名</button></div>
      </div>
    `).join('');
    document.querySelectorAll('[data-delete-alias]').forEach(btn => {
      btn.addEventListener('click', () => this.deleteAlias(btn.dataset.deleteAlias));
    });
  },

  renderMentions(mentions) {
    document.getElementById('mention-list').innerHTML = mentions.map(row => `
      <div class="result-item">
        <div class="result-title">#${row.mention_id} ${this.escape(row.name || row.document_title || '')}</div>
        <div class="result-meta">doc ${row.document_id} / unit ${row.unit_id || '-'} / ${this.escape(row.role)} / ${this.escape(row.review_status)}</div>
        <div class="result-preview">${this.escape(row.context_snippet || row.heading || '')}</div>
      </div>
    `).join('');
  },

  renderRevisions(revisions) {
    document.getElementById('revision-list').innerHTML = revisions.map(rev => `
      <div class="result-item">
        <div class="result-title">版本 ${rev.revision_id} / ${this.escape(rev.revision_kind)}</div>
        <div class="result-meta">${this.escape(rev.created_by)} / ${this.escape(rev.created_at)}</div>
        <button data-restore="${rev.revision_id}">恢复</button>
      </div>
    `).join('');
    document.querySelectorAll('[data-restore]').forEach(btn => {
      btn.addEventListener('click', () => this.restoreRevision(btn.dataset.restore));
    });
  },

  async loadAudit(targetType, targetId) {
    try {
      const data = await this.api(`/api/admin/audit?target_type=${encodeURIComponent(targetType)}&target_id=${encodeURIComponent(targetId)}&limit=20`);
      document.getElementById('audit-list').innerHTML = data.rows.map(row => `
        <div class="result-item">
          <div class="result-title">${this.escape(row.action)}</div>
          <div class="result-meta">${this.escape(row.actor)} / ${this.escape(row.created_at)}</div>
        </div>
      `).join('');
    } catch {
      document.getElementById('audit-list').innerHTML = '';
    }
  },

  async restoreRevision(revisionId) {
    try {
      const data = await this.api(`/api/admin/revisions/${revisionId}/restore`, { method: 'POST', body: '{}' });
      await this.loadDocument(data.document.document_id);
      this.status('版本已恢复', 'ok');
    } catch (err) {
      this.status(err.message, 'danger');
    }
  },
};

window.addEventListener('DOMContentLoaded', () => Admin.init());
