-- ============================================================================
-- Lore Database v2: evidence-first sidecar schema
-- Builds arknights_lore_v2 from the legacy arknights_lore schema without
-- removing or mutating legacy data.
-- ============================================================================

CREATE SCHEMA IF NOT EXISTS arknights_lore_v2;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE OR REPLACE FUNCTION arknights_lore_v2.classify_source_tier(
  title text,
  carrier_type text,
  narrative_layer text,
  category_code text
) RETURNS smallint AS $$
BEGIN
  IF title LIKE '大地巡旅:%'
     OR carrier_type IN ('oracle', 'terra_chapter', 'terra_qna', 'terra_note', 'news')
     OR category_code LIKE 'terra_%'
     OR category_code LIKE 'org_%'
     OR narrative_layer = 'META' THEN
    RETURN 3;
  ELSIF carrier_type IN (
    'archive_basic', 'archive_clinical', 'archive_record_1', 'archive_record_2',
    'archive_record_3', 'archive_record_4', 'archive_promotion', 'oprecord',
    'module_story'
  ) THEN
    RETURN 2;
  ELSIF carrier_type IN ('mainline', 'sidestory', 'vignette', 'other_story') THEN
    RETURN 1;
  ELSIF carrier_type = 'archive_voice' THEN
    RETURN 4;
  ELSIF carrier_type IN ('dev_letter', 'derived_work') THEN
    RETURN 5;
  ELSE
    RETURN 4;
  END IF;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

CREATE OR REPLACE FUNCTION arknights_lore_v2.classify_content_type(
  title text,
  carrier_type text,
  category_code text
) RETURNS text AS $$
BEGIN
  IF title LIKE '大地巡旅:%'
     OR carrier_type IN ('oracle', 'terra_chapter', 'terra_qna', 'terra_note', 'news')
     OR category_code LIKE 'terra_%'
     OR category_code LIKE 'org_%' THEN
    RETURN 'in_universe_publication';
  ELSIF carrier_type IN ('mainline', 'sidestory', 'vignette', 'other_story') THEN
    RETURN 'story_scene';
  ELSIF carrier_type IN ('oprecord', 'module_story') THEN
    RETURN carrier_type;
  ELSIF carrier_type LIKE 'archive_%' THEN
    RETURN 'operator_record';
  ELSIF carrier_type = 'enemy' THEN
    RETURN 'enemy_profile';
  ELSIF carrier_type IN ('item_material', 'item_collectible', 'furniture', 'skin', 'stage_desc', 'mail', 'base_dialogue') THEN
    RETURN 'system_text';
  ELSIF carrier_type = 'dev_letter' THEN
    RETURN 'creator_commentary';
  ELSE
    RETURN COALESCE(NULLIF(carrier_type, ''), 'other');
  END IF;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

CREATE TABLE IF NOT EXISTS arknights_lore_v2.entities (
  entity_id BIGSERIAL PRIMARY KEY,
  legacy_entity_id BIGINT UNIQUE,
  entity_type VARCHAR(40) NOT NULL,
  name TEXT NOT NULL,
  name_en TEXT,
  summary TEXT,
  properties JSONB NOT NULL DEFAULT '{}'::jsonb,
  review_status VARCHAR(32) NOT NULL DEFAULT 'seeded',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(entity_type, name)
);

CREATE TABLE IF NOT EXISTS arknights_lore_v2.entity_aliases (
  alias_id BIGSERIAL PRIMARY KEY,
  entity_id BIGINT NOT NULL REFERENCES arknights_lore_v2.entities(entity_id) ON DELETE CASCADE,
  alias TEXT NOT NULL,
  alias_kind VARCHAR(32) NOT NULL DEFAULT 'alias',
  source VARCHAR(32) NOT NULL DEFAULT 'legacy_seed',
  confidence NUMERIC NOT NULL DEFAULT 1 CHECK (confidence >= 0 AND confidence <= 1),
  UNIQUE(entity_id, alias)
);

CREATE TABLE IF NOT EXISTS arknights_lore_v2.documents (
  document_id BIGSERIAL PRIMARY KEY,
  legacy_asset_id BIGINT UNIQUE,
  domain_code VARCHAR(80) NOT NULL DEFAULT 'arknights',
  title TEXT NOT NULL,
  subtitle TEXT,
  source_name TEXT,
  source_uri TEXT,
  category_code TEXT,
  category_name TEXT,
  source_tier SMALLINT NOT NULL CHECK (source_tier BETWEEN 1 AND 5),
  content_type VARCHAR(80) NOT NULL,
  canon_status VARCHAR(32) NOT NULL DEFAULT 'official',
  in_universe_author_entity_id BIGINT REFERENCES arknights_lore_v2.entities(entity_id) ON DELETE SET NULL,
  perspective_scope TEXT,
  provenance_hash TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS arknights_lore_v2.text_units (
  unit_id BIGSERIAL PRIMARY KEY,
  document_id BIGINT NOT NULL REFERENCES arknights_lore_v2.documents(document_id) ON DELETE CASCADE,
  legacy_asset_id BIGINT,
  legacy_chunk_id BIGINT,
  unit_index INTEGER NOT NULL,
  unit_kind VARCHAR(40) NOT NULL DEFAULT 'chunk',
  heading TEXT,
  speaker TEXT,
  scene_code TEXT,
  text TEXT NOT NULL,
  source_tier SMALLINT NOT NULL CHECK (source_tier BETWEEN 1 AND 5),
  content_type VARCHAR(80) NOT NULL,
  is_direct_scene BOOLEAN NOT NULL DEFAULT false,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(document_id, unit_index)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_lore_v2_text_units_legacy_chunk
  ON arknights_lore_v2.text_units(legacy_chunk_id)
  WHERE legacy_chunk_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_lore_v2_text_units_legacy_chunk_full
  ON arknights_lore_v2.text_units(legacy_chunk_id);

CREATE TABLE IF NOT EXISTS arknights_lore_v2.entity_mentions (
  mention_id BIGSERIAL PRIMARY KEY,
  entity_id BIGINT NOT NULL REFERENCES arknights_lore_v2.entities(entity_id) ON DELETE CASCADE,
  document_id BIGINT NOT NULL REFERENCES arknights_lore_v2.documents(document_id) ON DELETE CASCADE,
  unit_id BIGINT REFERENCES arknights_lore_v2.text_units(unit_id) ON DELETE SET NULL,
  role VARCHAR(40) NOT NULL DEFAULT 'mentioned',
  salience NUMERIC NOT NULL DEFAULT 0.5 CHECK (salience >= 0 AND salience <= 1),
  title_match BOOLEAN NOT NULL DEFAULT false,
  direct_action BOOLEAN NOT NULL DEFAULT false,
  context_snippet TEXT,
  annotated_by VARCHAR(40) NOT NULL DEFAULT 'legacy_seed',
  review_status VARCHAR(32) NOT NULL DEFAULT 'seeded',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(entity_id, document_id, unit_id, role)
);

CREATE TABLE IF NOT EXISTS arknights_lore_v2.claims (
  claim_id BIGSERIAL PRIMARY KEY,
  claim_text TEXT NOT NULL,
  summary TEXT,
  subject_entity_id BIGINT REFERENCES arknights_lore_v2.entities(entity_id) ON DELETE SET NULL,
  claim_type VARCHAR(60) NOT NULL DEFAULT 'fact',
  status VARCHAR(32) NOT NULL DEFAULT 'unverified',
  confidence NUMERIC NOT NULL DEFAULT 0.5 CHECK (confidence >= 0 AND confidence <= 1),
  source VARCHAR(40) NOT NULL DEFAULT 'manual_seed',
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(claim_text)
);

CREATE TABLE IF NOT EXISTS arknights_lore_v2.claim_evidence (
  evidence_id BIGSERIAL PRIMARY KEY,
  claim_id BIGINT NOT NULL REFERENCES arknights_lore_v2.claims(claim_id) ON DELETE CASCADE,
  document_id BIGINT REFERENCES arknights_lore_v2.documents(document_id) ON DELETE SET NULL,
  unit_id BIGINT REFERENCES arknights_lore_v2.text_units(unit_id) ON DELETE SET NULL,
  evidence_type VARCHAR(32) NOT NULL CHECK (evidence_type IN ('supports', 'refutes', 'qualifies', 'context')),
  source_tier SMALLINT CHECK (source_tier BETWEEN 1 AND 5),
  quote TEXT,
  note TEXT,
  confidence NUMERIC NOT NULL DEFAULT 0.5 CHECK (confidence >= 0 AND confidence <= 1),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS arknights_lore_v2.events (
  event_id BIGSERIAL PRIMARY KEY,
  event_name TEXT NOT NULL,
  event_type VARCHAR(60) NOT NULL DEFAULT 'story_event',
  summary TEXT,
  source_tier SMALLINT NOT NULL DEFAULT 1 CHECK (source_tier BETWEEN 1 AND 5),
  primary_document_id BIGINT REFERENCES arknights_lore_v2.documents(document_id) ON DELETE SET NULL,
  timeline_label TEXT,
  timeline_sort_key NUMERIC,
  review_status VARCHAR(32) NOT NULL DEFAULT 'seeded',
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE(event_name)
);

CREATE TABLE IF NOT EXISTS arknights_lore_v2.event_participants (
  event_id BIGINT NOT NULL REFERENCES arknights_lore_v2.events(event_id) ON DELETE CASCADE,
  entity_id BIGINT NOT NULL REFERENCES arknights_lore_v2.entities(entity_id) ON DELETE CASCADE,
  role VARCHAR(60) NOT NULL DEFAULT 'participant',
  confidence NUMERIC NOT NULL DEFAULT 0.5 CHECK (confidence >= 0 AND confidence <= 1),
  PRIMARY KEY(event_id, entity_id, role)
);

CREATE TABLE IF NOT EXISTS arknights_lore_v2.entity_relations (
  relation_id BIGSERIAL PRIMARY KEY,
  source_entity_id BIGINT NOT NULL REFERENCES arknights_lore_v2.entities(entity_id) ON DELETE CASCADE,
  target_entity_id BIGINT NOT NULL REFERENCES arknights_lore_v2.entities(entity_id) ON DELETE CASCADE,
  relation_type VARCHAR(80) NOT NULL,
  evidence_document_id BIGINT REFERENCES arknights_lore_v2.documents(document_id) ON DELETE SET NULL,
  evidence_unit_id BIGINT REFERENCES arknights_lore_v2.text_units(unit_id) ON DELETE SET NULL,
  confidence NUMERIC NOT NULL DEFAULT 0.5 CHECK (confidence >= 0 AND confidence <= 1),
  review_status VARCHAR(32) NOT NULL DEFAULT 'seeded',
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  CHECK (source_entity_id <> target_entity_id),
  UNIQUE(source_entity_id, target_entity_id, relation_type)
);

CREATE TABLE IF NOT EXISTS arknights_lore_v2.topic_packs (
  topic_pack_id BIGSERIAL PRIMARY KEY,
  topic_code VARCHAR(100) NOT NULL UNIQUE,
  topic_name TEXT NOT NULL,
  description TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS arknights_lore_v2.golden_queries (
  golden_query_id BIGSERIAL PRIMARY KEY,
  topic_pack_id BIGINT REFERENCES arknights_lore_v2.topic_packs(topic_pack_id) ON DELETE CASCADE,
  query_text TEXT NOT NULL,
  expected_behavior TEXT NOT NULL,
  UNIQUE(query_text)
);

CREATE INDEX IF NOT EXISTS idx_lore_v2_documents_tier_type
  ON arknights_lore_v2.documents(source_tier, content_type);
CREATE INDEX IF NOT EXISTS idx_lore_v2_documents_title_trgm
  ON arknights_lore_v2.documents USING GIN (title arknights_lore.gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_lore_v2_text_units_text_trgm
  ON arknights_lore_v2.text_units USING GIN (text arknights_lore.gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_lore_v2_text_units_doc_index
  ON arknights_lore_v2.text_units(document_id, unit_index);
CREATE INDEX IF NOT EXISTS idx_lore_v2_entities_name_trgm
  ON arknights_lore_v2.entities USING GIN (name arknights_lore.gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_lore_v2_aliases_alias_trgm
  ON arknights_lore_v2.entity_aliases USING GIN (alias arknights_lore.gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_lore_v2_mentions_entity
  ON arknights_lore_v2.entity_mentions(entity_id, salience DESC);
CREATE INDEX IF NOT EXISTS idx_lore_v2_claim_subject
  ON arknights_lore_v2.claims(subject_entity_id, status);

INSERT INTO arknights_lore_v2.entities(legacy_entity_id, entity_type, name, name_en, summary, properties, review_status)
SELECT entity_id, entity_type, name, name_en, summary, properties, 'seeded'
FROM arknights_lore.entities
ON CONFLICT (legacy_entity_id) DO UPDATE SET
  entity_type = EXCLUDED.entity_type,
  name = EXCLUDED.name,
  name_en = EXCLUDED.name_en,
  summary = EXCLUDED.summary,
  properties = EXCLUDED.properties,
  updated_at = now();

INSERT INTO arknights_lore_v2.entity_aliases(entity_id, alias, alias_kind, source, confidence)
SELECT entity_id, name, 'primary', 'legacy_seed', 1
FROM arknights_lore_v2.entities
ON CONFLICT (entity_id, alias) DO NOTHING;

INSERT INTO arknights_lore_v2.entity_aliases(entity_id, alias, alias_kind, source, confidence)
SELECT entity_id, name_en, 'english', 'legacy_seed', 0.95
FROM arknights_lore_v2.entities
WHERE name_en IS NOT NULL AND btrim(name_en) <> ''
ON CONFLICT (entity_id, alias) DO NOTHING;

INSERT INTO arknights_lore_v2.entity_aliases(entity_id, alias, alias_kind, source, confidence)
SELECT ve.entity_id, alias, 'alias', 'legacy_seed', 0.9
FROM arknights_lore.entities le
JOIN arknights_lore_v2.entities ve ON ve.legacy_entity_id = le.entity_id
CROSS JOIN LATERAL unnest(le.aliases) AS alias
WHERE alias IS NOT NULL AND btrim(alias) <> ''
ON CONFLICT (entity_id, alias) DO NOTHING;

INSERT INTO arknights_lore_v2.documents(
  legacy_asset_id, domain_code, title, subtitle, source_name, source_uri,
  category_code, category_name, source_tier, content_type, canon_status,
  perspective_scope, provenance_hash, metadata
)
SELECT
  a.asset_id,
  d.domain_code,
  a.title,
  a.subtitle,
  a.source_name,
  COALESCE(a.source_url, a.source_path, a.object_uri),
  c.category_code,
  c.category_name,
  arknights_lore_v2.classify_source_tier(a.title, tc.carrier_type, tc.narrative_layer, c.category_code),
  arknights_lore_v2.classify_content_type(a.title, tc.carrier_type, c.category_code),
  CASE WHEN a.source_name ILIKE '%官方%' THEN 'official' ELSE 'mirrored_official' END,
  CASE
    WHEN a.title LIKE '大地巡旅:%' THEN 'in-universe publication; author-limited public account, not omniscient plot truth'
    WHEN tc.narrative_layer = 'META' THEN 'meta or in-universe contextual account; calibrate against direct story'
    WHEN tc.carrier_type = 'archive_voice' THEN 'character speech; evidence of claim or belief, not automatically fact'
    ELSE NULL
  END,
  md5(COALESCE(a.external_key, a.source_url, a.source_path, a.title || ':' || a.asset_id::text)),
  jsonb_build_object(
    'legacy_external_key', a.external_key,
    'legacy_asset_kind', a.asset_kind,
    'legacy_carrier_type', tc.carrier_type,
    'legacy_narrative_layer', tc.narrative_layer,
    'legacy_metadata', a.metadata,
    'legacy_text_metadata', tc.text_metadata
  )
FROM arknights_lore.assets a
JOIN arknights_lore.domains d ON d.domain_id = a.domain_id
LEFT JOIN arknights_lore.categories c ON c.category_id = a.category_id
LEFT JOIN arknights_lore.text_contents tc ON tc.asset_id = a.asset_id
ON CONFLICT (legacy_asset_id) DO UPDATE SET
  title = EXCLUDED.title,
  subtitle = EXCLUDED.subtitle,
  source_name = EXCLUDED.source_name,
  source_uri = EXCLUDED.source_uri,
  category_code = EXCLUDED.category_code,
  category_name = EXCLUDED.category_name,
  source_tier = EXCLUDED.source_tier,
  content_type = EXCLUDED.content_type,
  canon_status = EXCLUDED.canon_status,
  perspective_scope = EXCLUDED.perspective_scope,
  provenance_hash = EXCLUDED.provenance_hash,
  metadata = EXCLUDED.metadata,
  updated_at = now();

INSERT INTO arknights_lore_v2.text_units(
  document_id, legacy_asset_id, legacy_chunk_id, unit_index, unit_kind,
  heading, speaker, scene_code, text, source_tier, content_type,
  is_direct_scene, metadata
)
SELECT
  d.document_id,
  ch.asset_id,
  ch.chunk_id,
  ch.chunk_index,
  CASE WHEN ch.speaker IS NOT NULL THEN 'speech_or_scene' ELSE 'chunk' END,
  ch.heading,
  ch.speaker,
  COALESCE((regexp_match(d.title, '^([A-Z0-9]+(?:-[A-Z0-9]+)?)'))[1], d.category_code),
  ch.chunk_text,
  d.source_tier,
  d.content_type,
  d.source_tier = 1,
  jsonb_build_object(
    'legacy_start_offset', ch.start_offset,
    'legacy_end_offset', ch.end_offset,
    'legacy_review_status', ch.review_status,
    'legacy_metadata', ch.metadata
  )
FROM arknights_lore.asset_chunks ch
JOIN arknights_lore_v2.documents d ON d.legacy_asset_id = ch.asset_id
WHERE ch.deleted_at IS NULL
ON CONFLICT (legacy_chunk_id) DO UPDATE SET
  unit_index = EXCLUDED.unit_index,
  unit_kind = EXCLUDED.unit_kind,
  heading = EXCLUDED.heading,
  speaker = EXCLUDED.speaker,
  scene_code = EXCLUDED.scene_code,
  text = EXCLUDED.text,
  source_tier = EXCLUDED.source_tier,
  content_type = EXCLUDED.content_type,
  is_direct_scene = EXCLUDED.is_direct_scene,
  metadata = EXCLUDED.metadata,
  updated_at = now();

INSERT INTO arknights_lore_v2.text_units(
  document_id, legacy_asset_id, legacy_chunk_id, unit_index, unit_kind,
  heading, speaker, scene_code, text, source_tier, content_type,
  is_direct_scene, metadata
)
SELECT
  d.document_id,
  d.legacy_asset_id,
  NULL,
  0,
  'full_text',
  d.title,
  NULL,
  COALESCE((regexp_match(d.title, '^([A-Z0-9]+(?:-[A-Z0-9]+)?)'))[1], d.category_code),
  tc.full_text,
  d.source_tier,
  d.content_type,
  d.source_tier = 1,
  '{}'::jsonb
FROM arknights_lore_v2.documents d
JOIN arknights_lore.text_contents tc ON tc.asset_id = d.legacy_asset_id
WHERE NOT EXISTS (
  SELECT 1 FROM arknights_lore_v2.text_units tu WHERE tu.document_id = d.document_id
)
ON CONFLICT (document_id, unit_index) DO NOTHING;

INSERT INTO arknights_lore_v2.entity_mentions(
  entity_id, document_id, unit_id, role, salience, title_match, direct_action,
  context_snippet, annotated_by, review_status
)
SELECT
  ve.entity_id,
  vd.document_id,
  COALESCE(vu.unit_id, first_unit.unit_id),
  COALESCE(NULLIF(em.role, ''), 'mentioned'),
  GREATEST(
    LEAST(
      COALESCE(em.confidence::numeric, 0.5)
      + CASE WHEN vd.title ILIKE '%' || ve.name || '%' THEN 0.25 ELSE 0 END
      + CASE WHEN vd.source_tier = 1 THEN 0.10 ELSE 0 END,
      1
    ),
    0
  ),
  vd.title ILIKE '%' || ve.name || '%',
  vd.source_tier = 1 AND COALESCE(NULLIF(em.role, ''), 'mentioned') <> 'mentioned',
  em.context_snippet,
  em.annotated_by,
  'seeded'
FROM arknights_lore.entity_mentions em
JOIN arknights_lore_v2.entities ve ON ve.legacy_entity_id = em.entity_id
JOIN arknights_lore_v2.documents vd ON vd.legacy_asset_id = em.asset_id
LEFT JOIN arknights_lore_v2.text_units vu ON vu.legacy_chunk_id = em.chunk_id
LEFT JOIN LATERAL (
  SELECT unit_id
  FROM arknights_lore_v2.text_units tu
  WHERE tu.document_id = vd.document_id
  ORDER BY unit_index
  LIMIT 1
) first_unit ON TRUE
ON CONFLICT (entity_id, document_id, unit_id, role) DO UPDATE SET
  salience = GREATEST(arknights_lore_v2.entity_mentions.salience, EXCLUDED.salience),
  title_match = arknights_lore_v2.entity_mentions.title_match OR EXCLUDED.title_match,
  direct_action = arknights_lore_v2.entity_mentions.direct_action OR EXCLUDED.direct_action,
  context_snippet = COALESCE(arknights_lore_v2.entity_mentions.context_snippet, EXCLUDED.context_snippet);

INSERT INTO arknights_lore_v2.topic_packs(topic_code, topic_name, description, metadata)
VALUES
  ('rhine_lab', '莱茵生命', 'High-value regression topic for Rhine Lab faction truth versus public/in-universe accounts.', '{}'::jsonb),
  ('kristen', '克丽斯腾', 'High-value regression topic for Kristen Wright fate, motives, and Lone Trail evidence.', '{}'::jsonb),
  ('saria', '塞雷娅', 'High-value regression topic for Saria role, position, and relationships.', '{}'::jsonb),
  ('rhine_events', '孤星/绿野幻梦/未许之地', 'Rhine Lab event chain regression pack.', '{}'::jsonb)
ON CONFLICT (topic_code) DO UPDATE SET
  topic_name = EXCLUDED.topic_name,
  description = EXCLUDED.description;

INSERT INTO arknights_lore_v2.golden_queries(topic_pack_id, query_text, expected_behavior)
SELECT tp.topic_pack_id, q.query_text, q.expected_behavior
FROM arknights_lore_v2.topic_packs tp
JOIN (VALUES
  ('rhine_lab', '莱茵生命', 'Return Tier 1/Tier 2 story or records before Tier 3 大地巡旅; include perspective warnings for in-universe publications.'),
  ('rhine_lab', '莱茵生命 总辖 失踪', 'Do not answer from 大地巡旅 alone; retrieve story evidence around Saria/Kristen and later status changes.'),
  ('rhine_lab', '大地巡旅 莱茵生命', 'Identify 大地巡旅 as in-universe author-limited account, not omniscient truth.'),
  ('saria', '塞雷娅 总辖', 'Prioritize story evidence and operator records; distinguish title/position from dialogue claims.'),
  ('kristen', '克丽斯腾 去向', 'Retrieve direct story evidence before summaries or enemy/system profiles.'),
  ('rhine_events', '炎魔事件', 'Connect event evidence across Rhine Lab stories and character records, with uncertainty boundaries.')
) AS q(topic_code, query_text, expected_behavior) ON q.topic_code = tp.topic_code
ON CONFLICT (query_text) DO UPDATE SET
  expected_behavior = EXCLUDED.expected_behavior,
  topic_pack_id = EXCLUDED.topic_pack_id;

INSERT INTO arknights_lore_v2.claims(claim_text, summary, subject_entity_id, claim_type, status, confidence, source, metadata)
SELECT
  seed.claim_text,
  seed.summary,
  e.entity_id,
  seed.claim_type,
  'unverified',
  0.4,
  'curated_seed',
  jsonb_build_object('needs_human_review', true, 'topic', seed.topic)
FROM (VALUES
  ('莱茵生命总辖相关变动需要用剧情材料校准，不能只依据大地巡旅。', 'Rhine Lab leadership/status claims need plot corroboration.', '莱茵生命', 'source_criticism', 'rhine_lab'),
  ('塞雷娅在后续剧情中被称作莱茵生命总辖。', 'Saria is addressed as Rhine Lab director in later story material.', '塞雷娅', 'position_change', 'saria'),
  ('克丽斯腾的最终去向应以孤星等直接剧情证据为主。', 'Kristen fate/location should be grounded in direct story evidence.', '克丽斯腾', 'fate', 'kristen')
) AS seed(claim_text, summary, entity_name, claim_type, topic)
LEFT JOIN arknights_lore_v2.entities e ON e.name = seed.entity_name
ON CONFLICT (claim_text) DO UPDATE SET
  summary = EXCLUDED.summary,
  subject_entity_id = EXCLUDED.subject_entity_id,
  claim_type = EXCLUDED.claim_type,
  metadata = EXCLUDED.metadata,
  updated_at = now();
