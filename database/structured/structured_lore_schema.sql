-- ============================================================================
-- IRIS Structured Lore Database — Blank Schema
-- ============================================================================
-- 这是一个完全空白的结构化资料库模板。
-- 它的表结构与 lore-db MCP server 完全兼容，注册后即可被 Agent 直接查询。
--
-- 使用方法:
--   1. 在 PostgreSQL 中创建数据库
--   2. 运行此脚本创建所有表、索引、函数
--   3. 使用 INSERT 语句填入你的资料
--   4. 运行 004 和 005 迁移（如果需要搜索优化和 RAG）
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 0. 扩展
-- ---------------------------------------------------------------------------
-- pg_trgm: 用于文本相似度搜索（可选，有则加速 LIKE 查询）
CREATE EXTENSION IF NOT EXISTS pg_trgm;
-- vector: pgvector 扩展，仅当需要 RAG/向量搜索时才需要
-- CREATE EXTENSION IF NOT EXISTS vector;  -- 如需 RAG 功能请手动安装 pgvector

-- ---------------------------------------------------------------------------
-- 1. 文档表 (documents) — 核心表，每行 = 一篇资料
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS documents (
    document_id         bigserial PRIMARY KEY,
    external_key        text UNIQUE,                    -- 外部唯一标识，如 "story_001"
    title               text NOT NULL,                  -- 资料标题
    subtitle            text,                           -- 副标题/章节名
    source_name         text,                           -- 来源名称，如 "主线故事", "活动剧情"
    source_uri          text,                           -- 来源链接/文件路径
    source_tier         smallint DEFAULT 3,             -- 来源可信度分级 (1-5，见下方说明)
    content_type        text DEFAULT 'story',           -- 内容类型 (见下方枚举)
    canon_status        text DEFAULT 'canonical',       -- 正史状态 (canonical/ambiguous/non_canon)
    perspective_scope   text,                           -- 视角范围 (见下方说明)
    metadata            jsonb DEFAULT '{}',             -- 结构化元数据 (JSON，灵活扩展)
    review_status       text DEFAULT 'pending',         -- 审核状态 (pending/approved/rejected)
    ai_usage_notes      text,                           -- AI 使用建议/限制说明
    search_vector       tsvector,                       -- 全文搜索向量 (自动维护)
    created_at          timestamptz NOT NULL DEFAULT now(),
    updated_at          timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE documents IS '资料文档主表，每篇资料一行。metadata 字段存储灵活的结构化数据。';
COMMENT ON COLUMN documents.source_tier IS '来源可信度: 1=游戏内直接剧情(最高), 2=官方设定集/档案, 3=官方宣传/角色介绍, 4=衍生作品/同人设定, 5=玩家推测/社区解读(最低)';
COMMENT ON COLUMN documents.content_type IS '内容类型: story(剧情), operator_profile(角色档案), world_document(世界观文档), event_record(活动记录), voice_line(语音), item_description(物品描述), miscellaneous(杂项)';
COMMENT ON COLUMN documents.canon_status IS '正史状态: canonical(正史), ambiguous(存疑), non_canon(非正史)';
COMMENT ON COLUMN documents.perspective_scope IS '视角: in_universe(角色视角), narrator(叙述者), mixed(混合), unknown(未知)';
COMMENT ON COLUMN documents.metadata IS 'JSONB 元数据，可自由扩展。常用键: top_group, group_name, story_path, operator_name, operator_summary';

-- ---------------------------------------------------------------------------
-- 2. 文本单元表 (text_units) — 文档的段落/片段
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS text_units (
    unit_id             bigserial PRIMARY KEY,
    document_id         bigint NOT NULL REFERENCES documents(document_id) ON DELETE CASCADE,
    unit_index          integer NOT NULL DEFAULT 0,     -- 在文档中的顺序
    unit_kind           text DEFAULT 'paragraph',       -- 单元类型 (见下方枚举)
    heading             text,                           -- 段落标题/小标题
    speaker             text,                           -- 说话人 (对话场景)
    scene_code          text,                           -- 场景编码，如 "ACT_1_SCENE_3"
    text                text NOT NULL,                  -- 正文内容
    source_tier         smallint,                       -- 可覆盖文档级别的来源分级
    content_type        text,                           -- 可覆盖文档级别的内容类型
    is_direct_scene     boolean DEFAULT false,          -- 是否直接剧情场景
    metadata            jsonb DEFAULT '{}',             -- 段落级元数据
    review_status       text DEFAULT 'pending',
    search_vector       tsvector,
    created_at          timestamptz NOT NULL DEFAULT now(),
    updated_at          timestamptz NOT NULL DEFAULT now(),
    UNIQUE(document_id, unit_index)
);

COMMENT ON TABLE text_units IS '文档的文本片段表。一篇文档可拆分为多个 text_units，按 unit_index 排序。';
COMMENT ON COLUMN text_units.unit_kind IS '单元类型: paragraph(段落), dialogue(对话), stage_direction(舞台指示), narration(旁白), heading(标题), summary(摘要), metadata_block(元数据块)';
COMMENT ON COLUMN text_units.metadata IS 'JSONB 元数据。常用键: summary(摘要), summary_short(短摘要), summary_type(摘要类型), summary_confidence(置信度), perspective_note(视角说明), key_terms(关键词数组)';

-- ---------------------------------------------------------------------------
-- 3. 实体表 (entities) — 角色、组织、地点等
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS entities (
    entity_id           bigserial PRIMARY KEY,
    entity_type         text NOT NULL,                  -- 实体类型 (见下方枚举)
    name                text NOT NULL,                  -- 主名称
    name_en             text,                           -- 英文名称
    summary             text,                           -- 实体简介
    metadata            jsonb DEFAULT '{}',
    review_status       text DEFAULT 'pending',
    created_at          timestamptz NOT NULL DEFAULT now(),
    updated_at          timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE entities IS '实体表：角色、组织、地点、物品、概念等。';
COMMENT ON COLUMN entities.entity_type IS '实体类型: character(角色), organization(组织), location(地点), item(物品), concept(概念), event(事件), faction(势力), race(种族), class(职业), title(称号)';

-- ---------------------------------------------------------------------------
-- 4. 实体别名表 (entity_aliases) — 实体的不同叫法
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS entity_aliases (
    alias_id            bigserial PRIMARY KEY,
    entity_id           bigint NOT NULL REFERENCES entities(entity_id) ON DELETE CASCADE,
    alias               text NOT NULL,                  -- 别名
    alias_type          text DEFAULT 'nickname',        -- 别名类型 (见下方枚举)
    metadata            jsonb DEFAULT '{}',
    UNIQUE(entity_id, alias)
);

COMMENT ON COLUMN entity_aliases.alias_type IS '别名类型: name(正式名), nickname(昵称), codename(代号), title(称号), translation(译名), abbreviation(缩写), alias(其他别名)';

-- ---------------------------------------------------------------------------
-- 5. 实体提及表 (entity_mentions) — 实体在文档中的出现
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS entity_mentions (
    mention_id          bigserial PRIMARY KEY,
    entity_id           bigint NOT NULL REFERENCES entities(entity_id) ON DELETE CASCADE,
    document_id         bigint NOT NULL REFERENCES documents(document_id) ON DELETE CASCADE,
    unit_id             bigint REFERENCES text_units(unit_id) ON DELETE CASCADE,
    mention_context     text,                           -- 提及的上下文片段
    review_status       text DEFAULT 'pending',
    created_at          timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE entity_mentions IS '实体提及记录：某个实体在哪篇文档/哪个段落中被提到。用于按实体搜索文档。';

-- ---------------------------------------------------------------------------
-- 6. 关系表 (entity_relations) — 实体之间的关系
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS entity_relations (
    relation_id         bigserial PRIMARY KEY,
    from_entity_id      bigint NOT NULL REFERENCES entities(entity_id) ON DELETE CASCADE,
    to_entity_id        bigint NOT NULL REFERENCES entities(entity_id) ON DELETE CASCADE,
    relation_type       text NOT NULL,                  -- 关系类型 (见下方枚举)
    relation_subtype    text,                           -- 子类型，如 "师生" -> "导师"
    description         text,                           -- 关系描述
    evidence_document_id bigint REFERENCES documents(document_id) ON DELETE SET NULL,
    metadata            jsonb DEFAULT '{}',
    review_status       text DEFAULT 'pending',
    created_at          timestamptz NOT NULL DEFAULT now()
);

COMMENT ON COLUMN entity_relations.relation_type IS '关系类型: ally(盟友), enemy(敌对), family(亲属), colleague(同事), superior(上下级), mentor(师徒), romance(恋爱), acquaintance(相识), neutral(中立), unknown(未知)';

-- ---------------------------------------------------------------------------
-- 7. 事件表 (events) — 时间线上的事件
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS events (
    event_id            bigserial PRIMARY KEY,
    title               text NOT NULL,
    description         text,
    event_time          text,                           -- 时间描述，如 "1097年", "故事第一章"
    event_time_sort     double precision,               -- 排序用数值时间
    location_id         bigint REFERENCES entities(entity_id) ON DELETE SET NULL,
    metadata            jsonb DEFAULT '{}',
    review_status       text DEFAULT 'pending',
    created_at          timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- 8. 事件参与者表 (event_participants)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS event_participants (
    participant_id      bigserial PRIMARY KEY,
    event_id            bigint NOT NULL REFERENCES events(event_id) ON DELETE CASCADE,
    entity_id           bigint NOT NULL REFERENCES entities(entity_id) ON DELETE CASCADE,
    role                text DEFAULT 'participant',    -- 角色: initiator(发起者), target(目标), participant(参与者), witness(见证者), victim(受害者)
    metadata            jsonb DEFAULT '{}'
);

-- ---------------------------------------------------------------------------
-- 9. 声明/主张表 (claims) — 可验证的事实声明
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS claims (
    claim_id            bigserial PRIMARY KEY,
    claim_text          text NOT NULL,                  -- 声明内容
    claim_type          text DEFAULT 'fact',            -- 类型: fact(事实), theory(理论), interpretation(解读), speculation(推测)
    confidence          text DEFAULT 'medium',          -- 置信度: high/medium/low/unknown
    supporting_count    integer DEFAULT 0,
    opposing_count      integer DEFAULT 0,
    metadata            jsonb DEFAULT '{}',
    review_status       text DEFAULT 'pending',
    created_at          timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- 10. 声明证据表 (claim_evidence)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS claim_evidence (
    evidence_id         bigserial PRIMARY KEY,
    claim_id            bigint NOT NULL REFERENCES claims(claim_id) ON DELETE CASCADE,
    document_id         bigint NOT NULL REFERENCES documents(document_id) ON DELETE CASCADE,
    unit_id             bigint REFERENCES text_units(unit_id) ON DELETE CASCADE,
    evidence_type       text DEFAULT 'supporting',      -- supporting(支持) / opposing(反对)
    excerpt             text,                           -- 引用的文本片段
    notes               text,
    created_at          timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- 11. 数据库版本表 (db_version) — 用于自动更新检测
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS db_version (
    key                 text PRIMARY KEY,
    value               text NOT NULL
);
INSERT INTO db_version(key, value) VALUES('schema_version', '1') ON CONFLICT DO NOTHING;

-- ============================================================================
-- 索引
-- ============================================================================

-- documents 索引
CREATE INDEX IF NOT EXISTS idx_documents_title ON documents(title);
CREATE INDEX IF NOT EXISTS idx_documents_source_tier ON documents(source_tier);
CREATE INDEX IF NOT EXISTS idx_documents_content_type ON documents(content_type);
CREATE INDEX IF NOT EXISTS idx_documents_canon_status ON documents(canon_status);
CREATE INDEX IF NOT EXISTS idx_documents_external_key ON documents(external_key);
CREATE INDEX IF NOT EXISTS idx_documents_review_status ON documents(review_status);

-- text_units 索引
CREATE INDEX IF NOT EXISTS idx_text_units_document ON text_units(document_id);
CREATE INDEX IF NOT EXISTS idx_text_units_document_index ON text_units(document_id, unit_index);
CREATE INDEX IF NOT EXISTS idx_text_units_speaker ON text_units(speaker);
CREATE INDEX IF NOT EXISTS idx_text_units_scene ON text_units(scene_code);

-- entities 索引
CREATE INDEX IF NOT EXISTS idx_entities_type ON entities(entity_type);
CREATE INDEX IF NOT EXISTS idx_entities_name ON entities(name);
CREATE INDEX IF NOT EXISTS idx_entities_name_en ON entities(name_en);

-- entity_aliases 索引
CREATE INDEX IF NOT EXISTS idx_entity_aliases_alias ON entity_aliases(alias);
CREATE INDEX IF NOT EXISTS idx_entity_aliases_entity ON entity_aliases(entity_id);

-- entity_mentions 索引
CREATE INDEX IF NOT EXISTS idx_mentions_entity ON entity_mentions(entity_id);
CREATE INDEX IF NOT EXISTS idx_mentions_document ON entity_mentions(document_id);
CREATE INDEX IF NOT EXISTS idx_mentions_unit ON entity_mentions(unit_id);

-- entity_relations 索引
CREATE INDEX IF NOT EXISTS idx_relations_from ON entity_relations(from_entity_id);
CREATE INDEX IF NOT EXISTS idx_relations_to ON entity_relations(to_entity_id);
CREATE INDEX IF NOT EXISTS idx_relations_type ON entity_relations(relation_type);

-- events 索引
CREATE INDEX IF NOT EXISTS idx_events_time_sort ON events(event_time_sort);
CREATE INDEX IF NOT EXISTS idx_events_location ON events(location_id);

-- claims 索引
CREATE INDEX IF NOT EXISTS idx_claims_type ON claims(claim_type);
CREATE INDEX IF NOT EXISTS idx_claims_confidence ON claims(confidence);

-- ============================================================================
-- 触发器：自动更新 updated_at
-- ============================================================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_documents_updated_at ON documents;
CREATE TRIGGER trg_documents_updated_at
    BEFORE UPDATE ON documents
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS trg_text_units_updated_at ON text_units;
CREATE TRIGGER trg_text_units_updated_at
    BEFORE UPDATE ON text_units
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS trg_entities_updated_at ON entities;
CREATE TRIGGER trg_entities_updated_at
    BEFORE UPDATE ON entities
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- 触发器：全文搜索向量自动维护
-- ============================================================================
CREATE OR REPLACE FUNCTION update_document_search_vector()
RETURNS TRIGGER AS $$
BEGIN
    NEW.search_vector :=
        setweight(to_tsvector('simple', COALESCE(NEW.title, '')), 'A') ||
        setweight(to_tsvector('simple', COALESCE(NEW.subtitle, '')), 'B') ||
        setweight(to_tsvector('simple', COALESCE(NEW.metadata->>'operator_name', '')), 'A') ||
        setweight(to_tsvector('simple', COALESCE(NEW.metadata->>'operator_summary', '')), 'B');
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION update_text_unit_search_vector()
RETURNS TRIGGER AS $$
BEGIN
    NEW.search_vector :=
        setweight(to_tsvector('simple', COALESCE(NEW.heading, '')), 'A') ||
        setweight(to_tsvector('simple', COALESCE(NEW.text, '')), 'B') ||
        setweight(to_tsvector('simple', COALESCE(NEW.metadata->>'summary', '')), 'C') ||
        setweight(to_tsvector('simple', COALESCE(NEW.metadata->>'summary_short', '')), 'C');
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_document_search_vector ON documents;
CREATE TRIGGER trg_document_search_vector
    BEFORE INSERT OR UPDATE OF title, subtitle, metadata ON documents
    FOR EACH ROW EXECUTE FUNCTION update_document_search_vector();

DROP TRIGGER IF EXISTS trg_text_unit_search_vector ON text_units;
CREATE TRIGGER trg_text_unit_search_vector
    BEFORE INSERT OR UPDATE OF heading, text, metadata ON text_units
    FOR EACH ROW EXECUTE FUNCTION update_text_unit_search_vector();

-- ============================================================================
-- 搜索优化函数（与 MCP server 兼容的最小版本）
-- ============================================================================

-- 简单版 evidence 搜索函数
CREATE OR REPLACE FUNCTION search_evidence_optimized(
    search_query text,
    source_tiers smallint[] DEFAULT NULL,
    content_types text[] DEFAULT NULL,
    document_ids bigint[] DEFAULT NULL,
    group_names text[] DEFAULT NULL,
    top_groups text[] DEFAULT NULL,
    title_contains text[] DEFAULT NULL,
    max_results integer DEFAULT 30
) RETURNS TABLE(
    unit_id bigint, document_id bigint, unit_index integer,
    unit_kind text, heading text, speaker text, scene_code text,
    text_preview text, summary text, summary_short text,
    summary_type text, summary_confidence text, perspective_note text,
    key_terms jsonb, document_title text, subtitle text,
    source_name text, source_uri text, source_tier smallint,
    content_type text, canon_status text, perspective_scope text,
    operator_name text, operator_summary text,
    top_group text, group_name text, document_story_path jsonb,
    evidence_lane text, lane_priority int, score real
) AS $$
DECLARE
    query_terms text[];
BEGIN
    query_terms := regexp_split_to_array(trim(search_query), '[\s,，、。；;|/]+');

    RETURN QUERY
    SELECT
        tu.unit_id,
        tu.document_id,
        tu.unit_index,
        tu.unit_kind::text,
        tu.heading,
        tu.speaker,
        tu.scene_code,
        LEFT(tu.text, 900) AS text_preview,
        tu.metadata->>'summary' AS summary,
        tu.metadata->>'summary_short' AS summary_short,
        tu.metadata->>'summary_type' AS summary_type,
        tu.metadata->>'summary_confidence' AS summary_confidence,
        tu.metadata->>'perspective_note' AS perspective_note,
        COALESCE(tu.metadata->'key_terms', '[]'::jsonb) AS key_terms,
        d.title AS document_title,
        d.subtitle,
        d.source_name,
        d.source_uri,
        d.source_tier,
        d.content_type::text,
        d.canon_status::text AS canon_status,
        d.perspective_scope,
        d.metadata->>'operator_name' AS operator_name,
        d.metadata->>'operator_summary' AS operator_summary,
        d.metadata->>'top_group' AS top_group,
        d.metadata->>'group_name' AS group_name,
        d.metadata->'story_path' AS document_story_path,
        CASE
            WHEN d.source_tier = 1 THEN 'story'
            WHEN d.source_tier = 2 THEN 'official_record'
            WHEN d.source_tier = 3 THEN 'in_universe_publication'
            ELSE 'weak_or_character_voice'
        END AS evidence_lane,
        CASE WHEN d.source_tier = 1 THEN 1 WHEN d.source_tier = 2 THEN 2 WHEN d.source_tier = 3 THEN 3 ELSE 5 END AS lane_priority,
        (CASE WHEN d.title ILIKE ANY(ARRAY(SELECT '%' || t || '%' FROM unnest(query_terms) t)) THEN 90 ELSE 0 END +
         CASE WHEN tu.heading ILIKE ANY(ARRAY(SELECT '%' || t || '%' FROM unnest(query_terms) t)) THEN 45 ELSE 0 END +
         CASE WHEN tu.metadata->>'summary_short' ILIKE ANY(ARRAY(SELECT '%' || t || '%' FROM unnest(query_terms) t)) THEN 55 ELSE 0 END +
         CASE WHEN tu.metadata->>'summary' ILIKE ANY(ARRAY(SELECT '%' || t || '%' FROM unnest(query_terms) t)) THEN 40 ELSE 0 END +
         CASE WHEN tu.text ILIKE ANY(ARRAY(SELECT '%' || t || '%' FROM unnest(query_terms) t)) THEN 12 ELSE 0 END +
         CASE WHEN d.source_tier = 1 THEN 35 WHEN d.source_tier = 2 THEN 25 WHEN d.source_tier = 3 THEN 10 ELSE 0 END)::real AS score
    FROM text_units tu
    JOIN documents d ON d.document_id = tu.document_id
    WHERE (
        d.title ILIKE ANY(ARRAY(SELECT '%' || t || '%' FROM unnest(query_terms) t))
        OR tu.heading ILIKE ANY(ARRAY(SELECT '%' || t || '%' FROM unnest(query_terms) t))
        OR tu.metadata->>'summary_short' ILIKE ANY(ARRAY(SELECT '%' || t || '%' FROM unnest(query_terms) t))
        OR tu.metadata->>'summary' ILIKE ANY(ARRAY(SELECT '%' || t || '%' FROM unnest(query_terms) t))
        OR tu.text ILIKE ANY(ARRAY(SELECT '%' || t || '%' FROM unnest(query_terms) t))
    )
    AND (source_tiers IS NULL OR d.source_tier = ANY(source_tiers))
    AND (content_types IS NULL OR d.content_type = ANY(content_types))
    AND (document_ids IS NULL OR d.document_id = ANY(document_ids))
    AND (group_names IS NULL OR d.metadata->>'group_name' = ANY(group_names))
    AND (top_groups IS NULL OR d.metadata->>'top_group' = ANY(top_groups))
    AND (title_contains IS NULL OR d.title ILIKE ANY(ARRAY(SELECT '%' || t || '%' FROM unnest(title_contains) t)))
    ORDER BY score DESC, d.source_tier ASC, tu.unit_index ASC
    LIMIT max_results;
END;
$$ LANGUAGE plpgsql STABLE;

-- 简单版 browse tree 函数
CREATE OR REPLACE FUNCTION browse_tree_optimized(
    query_terms text[] DEFAULT NULL,
    source_tiers smallint[] DEFAULT NULL,
    content_types text[] DEFAULT NULL,
    top_groups text[] DEFAULT NULL,
    group_names text[] DEFAULT NULL,
    only_relevant boolean DEFAULT false,
    max_results integer DEFAULT 300
) RETURNS TABLE(
    document_id bigint, title text, subtitle text,
    source_tier smallint, content_type text,
    top_group text, group_name text, story_path jsonb,
    unit_count int, summarized_unit_count int, relevant_unit_count int
) AS $$
BEGIN
    RETURN QUERY
    WITH doc_stats AS (
        SELECT
            d.document_id,
            d.title,
            d.subtitle,
            d.source_tier,
            d.content_type::text,
            d.metadata->>'top_group' AS tg,
            d.metadata->>'group_name' AS gn,
            COALESCE(d.metadata->'story_path', '[]'::jsonb) AS sp,
            COUNT(tu.unit_id)::int AS uc,
            COUNT(*) FILTER (WHERE tu.metadata ? 'summary')::int AS sc
        FROM documents d
        LEFT JOIN text_units tu ON tu.document_id = d.document_id
        GROUP BY d.document_id
    )
    SELECT
        ds.document_id,
        ds.title,
        ds.subtitle,
        ds.source_tier,
        ds.content_type,
        ds.tg,
        ds.gn,
        ds.sp,
        ds.uc,
        ds.sc,
        CASE
            WHEN query_terms IS NULL OR array_length(query_terms, 1) IS NULL THEN 0::int
            ELSE (
                SELECT COUNT(*)::int FROM text_units tu
                WHERE tu.document_id = ds.document_id
                AND (tu.heading ILIKE ANY(query_terms)
                     OR tu.text ILIKE ANY(query_terms)
                     OR tu.metadata->>'summary' ILIKE ANY(query_terms)
                     OR tu.metadata->>'summary_short' ILIKE ANY(query_terms))
            )
        END
    FROM doc_stats ds
    WHERE (source_tiers IS NULL OR ds.source_tier = ANY(source_tiers))
      AND (content_types IS NULL OR ds.content_type = ANY(content_types))
      AND (top_groups IS NULL OR ds.tg = ANY(top_groups))
      AND (group_names IS NULL OR ds.gn = ANY(group_names))
      AND (NOT only_relevant OR query_terms IS NULL OR EXISTS (
          SELECT 1 FROM text_units tu
          WHERE tu.document_id = ds.document_id
          AND (tu.heading ILIKE ANY(query_terms)
               OR tu.text ILIKE ANY(query_terms)
               OR tu.metadata->>'summary' ILIKE ANY(query_terms)
               OR tu.metadata->>'summary_short' ILIKE ANY(query_terms))
      ))
    ORDER BY
        CASE WHEN query_terms IS NULL THEN 0 ELSE
            CASE WHEN EXISTS (
                SELECT 1 FROM text_units tu
                WHERE tu.document_id = ds.document_id
                AND (tu.heading ILIKE ANY(query_terms)
                     OR tu.text ILIKE ANY(query_terms))
            ) THEN 1 ELSE 0 END
        END DESC,
        ds.source_tier ASC, ds.title ASC
    LIMIT max_results;
END;
$$ LANGUAGE plpgsql STABLE;

-- 简单版实体解析函数
CREATE OR REPLACE FUNCTION resolve_entities_optimized(
    search_query text,
    max_results integer DEFAULT 10
) RETURNS TABLE(
    entity_id bigint, entity_type text, name text,
    name_en text, summary text, review_status text,
    aliases jsonb, match_score numeric, document_count int
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        e.entity_id,
        e.entity_type::text,
        e.name,
        e.name_en,
        e.summary,
        e.review_status::text,
        COALESCE((
            SELECT jsonb_agg(a.alias)
            FROM entity_aliases a
            WHERE a.entity_id = e.entity_id
        ), '[]'::jsonb) AS aliases,
        MAX(GREATEST(
            CASE WHEN e.name = search_query THEN 100 ELSE 0 END,
            CASE WHEN e.name_en = search_query THEN 98 ELSE 0 END,
            CASE WHEN ea.alias = search_query THEN 95 ELSE 0 END,
            CASE WHEN e.name ILIKE '%' || search_query || '%' THEN 82 ELSE 0 END,
            CASE WHEN e.name_en ILIKE '%' || search_query || '%' THEN 78 ELSE 0 END,
            CASE WHEN ea.alias ILIKE '%' || search_query || '%' THEN 76 ELSE 0 END
        ))::numeric AS match_score,
        COUNT(DISTINCT em.document_id)::int AS document_count
    FROM entities e
    LEFT JOIN entity_aliases ea ON ea.entity_id = e.entity_id
    LEFT JOIN entity_mentions em ON em.entity_id = e.entity_id
    WHERE e.name ILIKE '%' || search_query || '%'
       OR e.name_en ILIKE '%' || search_query || '%'
       OR ea.alias ILIKE '%' || search_query || '%'
    GROUP BY e.entity_id
    ORDER BY match_score DESC, document_count DESC, e.name
    LIMIT max_results;
END;
$$ LANGUAGE plpgsql STABLE;
