-- ============================================================================
-- IRIS Admin Editor Migration 002
-- Adds revision, audit, claim, and editable-review support.
-- Safe to run multiple times.
-- ============================================================================

CREATE TABLE IF NOT EXISTS arknights_lore.asset_revisions (
  revision_id BIGSERIAL PRIMARY KEY,
  asset_id BIGINT NOT NULL REFERENCES arknights_lore.assets(asset_id) ON DELETE CASCADE,
  revision_kind VARCHAR(32) NOT NULL DEFAULT 'text',
  title VARCHAR(500),
  subtitle VARCHAR(500),
  full_text TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by VARCHAR(120) NOT NULL DEFAULT 'admin',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  note TEXT
);

CREATE INDEX IF NOT EXISTS idx_asset_revisions_asset_id
  ON arknights_lore.asset_revisions(asset_id, created_at DESC);

CREATE TABLE IF NOT EXISTS arknights_lore.admin_audit_log (
  audit_id BIGSERIAL PRIMARY KEY,
  actor VARCHAR(120) NOT NULL DEFAULT 'admin',
  action VARCHAR(80) NOT NULL,
  target_type VARCHAR(80) NOT NULL,
  target_id TEXT NOT NULL,
  before_data JSONB,
  after_data JSONB,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_admin_audit_target
  ON arknights_lore.admin_audit_log(target_type, target_id, created_at DESC);

CREATE TABLE IF NOT EXISTS arknights_lore.claim_records (
  claim_id BIGSERIAL PRIMARY KEY,
  claim_text TEXT NOT NULL,
  summary TEXT,
  status VARCHAR(32) NOT NULL DEFAULT 'unverified',
  source_type VARCHAR(32) NOT NULL DEFAULT 'manual',
  source_ref TEXT,
  entities JSONB NOT NULL DEFAULT '[]'::jsonb,
  confidence NUMERIC NOT NULL DEFAULT 0.5 CHECK (confidence >= 0 AND confidence <= 1),
  note TEXT,
  created_by VARCHAR(120) NOT NULL DEFAULT 'admin',
  updated_by VARCHAR(120),
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_claim_records_status
  ON arknights_lore.claim_records(status) WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_claim_records_entities
  ON arknights_lore.claim_records USING GIN (entities);

CREATE TABLE IF NOT EXISTS arknights_lore.claim_evidence (
  evidence_id BIGSERIAL PRIMARY KEY,
  claim_id BIGINT NOT NULL REFERENCES arknights_lore.claim_records(claim_id) ON DELETE CASCADE,
  asset_id BIGINT REFERENCES arknights_lore.assets(asset_id) ON DELETE SET NULL,
  chunk_id BIGINT REFERENCES arknights_lore.asset_chunks(chunk_id) ON DELETE SET NULL,
  evidence_type VARCHAR(32) NOT NULL DEFAULT 'supports',
  quote TEXT,
  note TEXT,
  created_by VARCHAR(120) NOT NULL DEFAULT 'admin',
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_claim_evidence_claim_id
  ON arknights_lore.claim_evidence(claim_id) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS arknights_lore.community_documents (
  community_doc_id BIGSERIAL PRIMARY KEY,
  title TEXT NOT NULL,
  source_url TEXT,
  author TEXT,
  source_type VARCHAR(32) NOT NULL DEFAULT 'community',
  raw_text TEXT NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'draft',
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by VARCHAR(120) NOT NULL DEFAULT 'admin',
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE arknights_lore.asset_tags
  ADD COLUMN IF NOT EXISTS asset_tag_id BIGSERIAL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_asset_tags_asset_tag_id
  ON arknights_lore.asset_tags(asset_tag_id);

ALTER TABLE arknights_lore.asset_tags
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

ALTER TABLE arknights_lore.asset_chunks
  ADD COLUMN IF NOT EXISTS review_status VARCHAR(32) NOT NULL DEFAULT 'pending';

ALTER TABLE arknights_lore.asset_chunks
  ADD COLUMN IF NOT EXISTS note TEXT;

ALTER TABLE arknights_lore.asset_chunks
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_asset_chunks_deleted_at
  ON arknights_lore.asset_chunks(asset_id, chunk_index) WHERE deleted_at IS NULL;

CREATE OR REPLACE FUNCTION arknights_lore.admin_touch_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_claim_records_updated_at ON arknights_lore.claim_records;
CREATE TRIGGER trg_claim_records_updated_at
  BEFORE UPDATE ON arknights_lore.claim_records
  FOR EACH ROW EXECUTE FUNCTION arknights_lore.admin_touch_updated_at();

DROP TRIGGER IF EXISTS trg_community_documents_updated_at ON arknights_lore.community_documents;
CREATE TRIGGER trg_community_documents_updated_at
  BEFORE UPDATE ON arknights_lore.community_documents
  FOR EACH ROW EXECUTE FUNCTION arknights_lore.admin_touch_updated_at();
