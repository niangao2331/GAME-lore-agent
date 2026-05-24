const Admin = {
  token: localStorage.getItem('iris_admin_token') || '',
  currentAsset: null,
  currentClaim: null,
  labels: {
    status: {
      pending: '待审核',
      approved: '已确认',
      needs_review: '需复核',
      rejected: '已驳回',
      unverified: '未核验',
      verified: '已核验',
      inferred: '推断成立',
      disputed: '存在争议',
      outdated: '已过时'
    },
    revisionKind: {
      text_edit: '正文编辑',
      metadata_edit: '元数据编辑',
      restore: '版本恢复'
    },
    action: {
      update_asset: '更新资料',
      update_asset_text: '更新正文',
      rebuild_chunks: '重建分段',
      create_asset_tag: '新增标签',
      update_asset_tag: '更新标签',
      delete_asset_tag: '驳回标签',
      create_claim: '新增命题',
      update_claim: '更新命题',
      add_claim_evidence: '绑定证据',
      delete_claim_evidence: '移除证据',
      restore_revision: '恢复版本'
    }
  },

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

    document.getElementById('search-assets').addEventListener('click', () => this.searchAssets());
    document.getElementById('search-claims').addEventListener('click', () => this.searchClaims());
    document.getElementById('new-claim').addEventListener('click', () => this.newClaim());
    document.getElementById('save-asset').addEventListener('click', () => this.saveAsset());
    document.getElementById('save-text').addEventListener('click', () => this.saveText());
    document.getElementById('rebuild-chunks').addEventListener('click', () => this.rebuildChunks());
    document.getElementById('add-tag').addEventListener('click', () => this.addTag());
    document.getElementById('save-claim').addEventListener('click', () => this.saveClaim());
    document.getElementById('add-evidence').addEventListener('click', () => this.addEvidence());

    this.searchAssets();
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

  label(group, value) {
    return this.labels[group]?.[value] || value || '';
  },

  escape(value) {
    return String(value ?? '').replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  },

  switchTab(tab) {
    document.querySelectorAll('.tab').forEach(btn => btn.classList.toggle('active', btn.dataset.tab === tab));
    document.getElementById('asset-search').classList.toggle('hidden', tab !== 'assets');
    document.getElementById('claim-search').classList.toggle('hidden', tab !== 'claims');
  },

  async searchAssets() {
    try {
      this.status('正在搜索资料');
      const params = new URLSearchParams();
      const q = document.getElementById('asset-query').value.trim();
      const category = document.getElementById('asset-category').value.trim();
      const tag = document.getElementById('asset-tag').value.trim();
      if (q) params.set('query', q);
      if (category) params.set('category', category);
      if (tag) params.set('tag', tag);
      const data = await this.api(`/api/admin/assets?${params}`);
      const list = document.getElementById('asset-results');
      list.innerHTML = data.rows.map(row => `
        <div class="result-item" data-asset-id="${row.asset_id}">
          <div class="result-title">#${row.asset_id} ${this.escape(row.title)}</div>
          <div class="result-meta">${this.escape(row.category_code || '')} / ${this.escape(row.carrier_type || '')} / ${this.escape(row.narrative_layer || '')}</div>
          <div class="result-preview">${this.escape(row.text_preview || '')}</div>
        </div>
      `).join('');
      list.querySelectorAll('[data-asset-id]').forEach(el => {
        el.addEventListener('click', () => this.loadAsset(el.dataset.assetId));
      });
      this.status(`找到资料：${data.rows.length}`, 'ok');
    } catch (err) {
      this.status(err.message, 'danger');
    }
  },

  async loadAsset(assetId) {
    try {
      this.status(`正在加载资料 ${assetId}`);
      const data = await this.api(`/api/admin/assets/${assetId}`);
      this.currentAsset = data;
      this.currentClaim = null;
      document.getElementById('empty-state').classList.add('hidden');
      document.getElementById('asset-editor').classList.remove('hidden');
      document.getElementById('claim-editor').classList.add('hidden');

      const a = data.asset;
      document.getElementById('asset-id').textContent = `资料 ${a.asset_id}`;
      document.getElementById('asset-title').value = a.title || '';
      document.getElementById('asset-subtitle').value = a.subtitle || '';
      document.getElementById('asset-source-name').value = a.source_name || '';
      document.getElementById('asset-source-url').value = a.source_url || '';
      document.getElementById('asset-carrier-type').value = a.carrier_type || '';
      document.getElementById('asset-narrative-layer').value = a.narrative_layer || '';
      document.getElementById('asset-character-name').value = a.character_name || '';
      document.getElementById('asset-activity-name').value = a.activity_name || '';
      document.getElementById('asset-mission-code').value = a.mission_code || '';
      document.getElementById('asset-text').value = a.full_text || '';

      this.renderTags(data.tags);
      this.renderChunks(data.chunks);
      this.renderRevisions(data.revisions);
      this.renderAssetClaims(data.claims);
      await this.loadAudit('asset', a.asset_id);
      this.status('资料已加载', 'ok');
    } catch (err) {
      this.status(err.message, 'danger');
    }
  },

  renderTags(tags) {
    document.getElementById('tag-list').innerHTML = tags.map(tag => `
      <div class="tag-card ${tag.review_status === 'rejected' ? 'rejected' : ''}">
        <div class="tag-main">#${tag.asset_tag_id} [${this.escape(tag.dim_code)}] ${this.escape(tag.tag_value)}</div>
        <div class="result-meta">置信度 ${tag.confidence} / ${this.escape(tag.annotated_by)} / ${this.escape(this.label('status', tag.review_status))}</div>
        <div class="tag-controls">
          <input data-tag-note="${tag.asset_tag_id}" value="${this.escape(tag.note || '')}" placeholder="备注">
          <select data-tag-status="${tag.asset_tag_id}">
            ${['pending','approved','needs_review','rejected'].map(s => `<option value="${s}" ${s === tag.review_status ? 'selected' : ''}>${this.label('status', s)}</option>`).join('')}
          </select>
          <button data-tag-save="${tag.asset_tag_id}">保存</button>
          <button data-tag-delete="${tag.asset_tag_id}" class="danger">驳回</button>
        </div>
      </div>
    `).join('');
    document.querySelectorAll('[data-tag-save]').forEach(btn => {
      btn.addEventListener('click', () => this.saveTag(btn.dataset.tagSave));
    });
    document.querySelectorAll('[data-tag-delete]').forEach(btn => {
      btn.addEventListener('click', () => this.deleteTag(btn.dataset.tagDelete));
    });
  },

  renderChunks(chunks) {
    document.getElementById('chunk-list').innerHTML = chunks.map(chunk => `
      <div class="chunk-card">
        <div class="chunk-main">分段 ${chunk.chunk_id} / 序号 ${chunk.chunk_index} / ${this.escape(this.label('status', chunk.review_status))} ${chunk.deleted_at ? '/ 已删除' : ''}</div>
        <div class="result-preview">${this.escape((chunk.chunk_text || '').slice(0, 500))}</div>
      </div>
    `).join('');
  },

  renderRevisions(revisions) {
    document.getElementById('revision-list').innerHTML = revisions.map(rev => `
      <div class="result-item">
        <div class="result-title">版本 ${rev.revision_id}</div>
        <div class="result-meta">${this.escape(this.label('revisionKind', rev.revision_kind))} / ${this.escape(rev.created_at)}</div>
        <button data-restore="${rev.revision_id}">恢复</button>
      </div>
    `).join('');
    document.querySelectorAll('[data-restore]').forEach(btn => {
      btn.addEventListener('click', () => this.restoreRevision(btn.dataset.restore));
    });
  },

  renderAssetClaims(claims) {
    document.getElementById('asset-claims').innerHTML = claims.map(claim => `
      <div class="result-item">
        <div class="result-title">命题 ${claim.claim_id} / ${this.escape(this.label('status', claim.status))}</div>
        <div class="result-preview">${this.escape(claim.claim_text)}</div>
      </div>
    `).join('');
  },

  async loadAudit(targetType, targetId) {
    const data = await this.api(`/api/admin/audit?target_type=${encodeURIComponent(targetType)}&target_id=${encodeURIComponent(targetId)}&limit=20`);
    document.getElementById('audit-list').innerHTML = data.rows.map(row => `
      <div class="result-item">
        <div class="result-title">${this.escape(this.label('action', row.action))}</div>
        <div class="result-meta">${this.escape(row.actor)} / ${this.escape(row.created_at)}</div>
      </div>
    `).join('');
  },

  async saveAsset() {
    if (!this.currentAsset) return;
    const id = this.currentAsset.asset.asset_id;
    try {
      await this.api(`/api/admin/assets/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          title: document.getElementById('asset-title').value,
          subtitle: document.getElementById('asset-subtitle').value,
          source_name: document.getElementById('asset-source-name').value,
          source_url: document.getElementById('asset-source-url').value,
          carrier_type: document.getElementById('asset-carrier-type').value,
          narrative_layer: document.getElementById('asset-narrative-layer').value,
          character_name: document.getElementById('asset-character-name').value,
          activity_name: document.getElementById('asset-activity-name').value,
          mission_code: document.getElementById('asset-mission-code').value
        })
      });
      this.status('元数据已保存', 'ok');
      await this.loadAsset(id);
    } catch (err) {
      this.status(err.message, 'danger');
    }
  },

  async saveText() {
    if (!this.currentAsset) return;
    const id = this.currentAsset.asset.asset_id;
    try {
      await this.api(`/api/admin/assets/${id}/text`, {
        method: 'PATCH',
        body: JSON.stringify({ full_text: document.getElementById('asset-text').value, note: '管理台正文编辑' })
      });
      this.status('正文已保存，分段已重建', 'ok');
      await this.loadAsset(id);
    } catch (err) {
      this.status(err.message, 'danger');
    }
  },

  async rebuildChunks() {
    if (!this.currentAsset) return;
    const id = this.currentAsset.asset.asset_id;
    try {
      await this.api(`/api/admin/assets/${id}/rebuild-chunks`, { method: 'POST', body: '{}' });
      this.status('分段已重建', 'ok');
      await this.loadAsset(id);
    } catch (err) {
      this.status(err.message, 'danger');
    }
  },

  async addTag() {
    if (!this.currentAsset) return;
    const id = this.currentAsset.asset.asset_id;
    try {
      await this.api(`/api/admin/assets/${id}/tags`, {
        method: 'POST',
        body: JSON.stringify({
          dim_code: document.getElementById('tag-dim').value.trim(),
          tag_value: document.getElementById('tag-value').value.trim(),
          note: '管理台人工标签'
        })
      });
      document.getElementById('tag-value').value = '';
      this.status('标签已添加', 'ok');
      await this.loadAsset(id);
    } catch (err) {
      this.status(err.message, 'danger');
    }
  },

  async saveTag(assetTagId) {
    try {
      await this.api(`/api/admin/asset-tags/${assetTagId}`, {
        method: 'PATCH',
        body: JSON.stringify({
          review_status: document.querySelector(`[data-tag-status="${assetTagId}"]`).value,
          note: document.querySelector(`[data-tag-note="${assetTagId}"]`).value,
          annotated_by: 'human'
        })
      });
      this.status('标签已保存', 'ok');
      await this.loadAsset(this.currentAsset.asset.asset_id);
    } catch (err) {
      this.status(err.message, 'danger');
    }
  },

  async deleteTag(assetTagId) {
    try {
      await this.api(`/api/admin/asset-tags/${assetTagId}`, { method: 'DELETE' });
      this.status('标签已驳回', 'ok');
      await this.loadAsset(this.currentAsset.asset.asset_id);
    } catch (err) {
      this.status(err.message, 'danger');
    }
  },

  async searchClaims() {
    try {
      const params = new URLSearchParams();
      const q = document.getElementById('claim-query').value.trim();
      const status = document.getElementById('claim-status-filter').value;
      if (q) params.set('query', q);
      if (status) params.set('status', status);
      const data = await this.api(`/api/admin/claims?${params}`);
      const list = document.getElementById('claim-results');
      list.innerHTML = data.rows.map(row => `
        <div class="result-item" data-claim='${this.escape(JSON.stringify(row))}'>
          <div class="result-title">#${row.claim_id} ${this.escape(this.label('status', row.status))}</div>
          <div class="result-preview">${this.escape(row.claim_text)}</div>
        </div>
      `).join('');
      list.querySelectorAll('[data-claim]').forEach(el => {
        el.addEventListener('click', () => this.loadClaim(JSON.parse(el.dataset.claim)));
      });
      this.status(`找到命题：${data.rows.length}`, 'ok');
    } catch (err) {
      this.status(err.message, 'danger');
    }
  },

  newClaim() {
    this.loadClaim({
      claim_id: null,
      claim_text: '',
      summary: '',
      status: 'unverified',
      source_type: 'manual',
      source_ref: '',
      entities: [],
      confidence: 0.5,
      note: ''
    });
  },

  loadClaim(claim) {
    this.currentClaim = claim;
    this.currentAsset = null;
    document.getElementById('empty-state').classList.add('hidden');
    document.getElementById('asset-editor').classList.add('hidden');
    document.getElementById('claim-editor').classList.remove('hidden');
    document.getElementById('claim-id').textContent = claim.claim_id ? `命题 ${claim.claim_id}` : '新建命题';
    document.getElementById('claim-text').value = claim.claim_text || '';
    document.getElementById('claim-summary').value = claim.summary || '';
    document.getElementById('claim-status').value = claim.status || 'unverified';
    document.getElementById('claim-source-type').value = claim.source_type || 'manual';
    document.getElementById('claim-source-ref').value = claim.source_ref || '';
    document.getElementById('claim-entities').value = JSON.stringify(claim.entities || []);
    document.getElementById('claim-confidence').value = claim.confidence ?? 0.5;
    document.getElementById('claim-note').value = claim.note || '';
  },

  async saveClaim() {
    const body = {
      claim_text: document.getElementById('claim-text').value,
      summary: document.getElementById('claim-summary').value,
      status: document.getElementById('claim-status').value,
      source_type: document.getElementById('claim-source-type').value,
      source_ref: document.getElementById('claim-source-ref').value,
      entities: JSON.parse(document.getElementById('claim-entities').value || '[]'),
      confidence: Number(document.getElementById('claim-confidence').value || 0.5),
      note: document.getElementById('claim-note').value
    };
    try {
      if (this.currentClaim?.claim_id) {
        await this.api(`/api/admin/claims/${this.currentClaim.claim_id}`, { method: 'PATCH', body: JSON.stringify(body) });
      } else {
        const data = await this.api('/api/admin/claims', { method: 'POST', body: JSON.stringify(body) });
        this.currentClaim = data.claim;
      }
      await this.searchClaims();
      this.status('命题已保存', 'ok');
    } catch (err) {
      this.status(err.message, 'danger');
    }
  },

  async addEvidence() {
    if (!this.currentAsset) return;
    const claimId = document.getElementById('evidence-claim-id').value.trim();
    if (!claimId) return;
    const chunkId = document.getElementById('evidence-chunk-id').value.trim();
    try {
      await this.api(`/api/admin/claims/${claimId}/evidence`, {
        method: 'POST',
        body: JSON.stringify({
          asset_id: this.currentAsset.asset.asset_id,
          chunk_id: chunkId || null,
          evidence_type: 'supports'
        })
      });
      this.status('证据已绑定', 'ok');
      await this.loadAsset(this.currentAsset.asset.asset_id);
    } catch (err) {
      this.status(err.message, 'danger');
    }
  },

  async restoreRevision(revisionId) {
    try {
      const data = await this.api(`/api/admin/revisions/${revisionId}/restore`, { method: 'POST', body: '{}' });
      this.status('版本已恢复', 'ok');
      await this.loadAsset(data.asset.asset_id);
    } catch (err) {
      this.status(err.message, 'danger');
    }
  }
};

window.addEventListener('DOMContentLoaded', () => Admin.init());
