-- ============================================================================
-- IRIS Query Optimization Migration 004
-- Adds full-text search columns, expression indexes, materialized views,
-- and helper functions to accelerate the primary search and browse paths.
-- Safe to run multiple times (all DDL uses IF NOT EXISTS / IF EXISTS).
-- ============================================================================

-- 1. Ensure pg_trgm extension is available for trigram indexes
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- 2. Full-text search vector columns for fast pre-filtering
--    Using 'simple' configuration for mixed Chinese/English content

ALTER TABLE documents ADD COLUMN IF NOT EXISTS search_vector tsvector;
ALTER TABLE text_units ADD COLUMN IF NOT EXISTS search_vector tsvector;

-- 3. Update functions for search vectors

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

-- 4. Triggers to auto-update search vectors on insert/update

DROP TRIGGER IF EXISTS trg_document_search_vector ON documents;
CREATE TRIGGER trg_document_search_vector
  BEFORE INSERT OR UPDATE OF title, subtitle, metadata ON documents
  FOR EACH ROW EXECUTE FUNCTION update_document_search_vector();

DROP TRIGGER IF EXISTS trg_text_unit_search_vector ON text_units;
CREATE TRIGGER trg_text_unit_search_vector
  BEFORE INSERT OR UPDATE OF heading, text, metadata ON text_units
  FOR EACH ROW EXECUTE FUNCTION update_text_unit_search_vector();

-- 5. Populate existing search vectors (only NULL rows, batched to reduce lock time)

UPDATE documents
SET search_vector =
  setweight(to_tsvector('simple', COALESCE(title, '')), 'A') ||
  setweight(to_tsvector('simple', COALESCE(subtitle, '')), 'B') ||
  setweight(to_tsvector('simple', COALESCE(metadata->>'operator_name', '')), 'A') ||
  setweight(to_tsvector('simple', COALESCE(metadata->>'operator_summary', '')), 'B')
WHERE search_vector IS NULL;

UPDATE text_units
SET search_vector =
  setweight(to_tsvector('simple', COALESCE(heading, '')), 'A') ||
  setweight(to_tsvector('simple', COALESCE(text, '')), 'B') ||
  setweight(to_tsvector('simple', COALESCE(metadata->>'summary', '')), 'C') ||
  setweight(to_tsvector('simple', COALESCE(metadata->>'summary_short', '')), 'C')
WHERE search_vector IS NULL;

-- 6. GIN indexes for full-text search vectors

CREATE INDEX IF NOT EXISTS idx_documents_search_vector
  ON documents USING GIN (search_vector);

CREATE INDEX IF NOT EXISTS idx_text_units_search_vector
  ON text_units USING GIN (search_vector);

-- 7. Trigram expression indexes for metadata ILIKE queries
--    These accelerate the metadata->>'field' ILIKE ANY(...) patterns

CREATE INDEX IF NOT EXISTS idx_text_units_summary_trgm
  ON text_units USING GIN ((metadata->>'summary') gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_text_units_summary_short_trgm
  ON text_units USING GIN ((metadata->>'summary_short') gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_documents_operator_name_trgm
  ON documents USING GIN ((metadata->>'operator_name') gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_documents_operator_summary_trgm
  ON documents USING GIN ((metadata->>'operator_summary') gin_trgm_ops);

-- 8. Partial indexes for commonly filtered conditions

-- Accelerate summary presence checks and indexed summary reads
CREATE INDEX IF NOT EXISTS idx_text_units_with_summary
  ON text_units(document_id, unit_index)
  WHERE metadata ? 'summary';

-- 9. Composite indexes for common join + filter + sort patterns

-- Documents: tier/type filter + document_id for JOINs
CREATE INDEX IF NOT EXISTS idx_documents_tier_type_id
  ON documents(source_tier, content_type, document_id);

-- Text units: document join + tier/type filter + unit order
CREATE INDEX IF NOT EXISTS idx_text_units_doc_tier_type_index
  ON text_units(document_id, source_tier, content_type, unit_index);

-- 10. Document stats materialized view for tree browsing
--     Pre-computes the expensive aggregations in handleBrowseTree

CREATE MATERIALIZED VIEW IF NOT EXISTS document_stats AS
SELECT
  d.document_id,
  d.title,
  d.subtitle,
  d.source_tier,
  d.content_type,
  d.canon_status,
  d.perspective_scope,
  d.metadata->>'top_group' AS top_group,
  d.metadata->>'group_name' AS group_name,
  COALESCE(d.metadata->'story_path', '[]'::jsonb) AS story_path,
  d.metadata->>'operator_name' AS operator_name,
  d.metadata->>'operator_summary' AS operator_summary,
  COUNT(tu.unit_id)::int AS unit_count,
  COUNT(*) FILTER (WHERE tu.metadata ? 'summary')::int AS summarized_unit_count
FROM documents d
LEFT JOIN text_units tu ON tu.document_id = d.document_id
GROUP BY d.document_id;

CREATE UNIQUE INDEX IF NOT EXISTS idx_document_stats_id
  ON document_stats(document_id);

CREATE INDEX IF NOT EXISTS idx_document_stats_tier_type
  ON document_stats(source_tier, content_type);

CREATE INDEX IF NOT EXISTS idx_document_stats_top_group
  ON document_stats(top_group) WHERE top_group IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_document_stats_group_name
  ON document_stats(group_name) WHERE group_name IS NOT NULL;

-- 11. Helper function: refresh document_stats concurrently

CREATE OR REPLACE FUNCTION refresh_document_stats()
RETURNS void AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY document_stats;
END;
$$ LANGUAGE plpgsql;

-- 12. Helper function: convert text array to tsquery for multi-term FTS
--     This produces a tsquery that matches ANY of the provided terms,
--     suitable for pre-filtering before trigram-based ranking.

CREATE OR REPLACE FUNCTION array_to_tsquery(terms text[])
RETURNS tsquery AS $$
DECLARE
  q tsquery := ''::tsquery;
  term_q tsquery;
  t text;
BEGIN
  FOR t IN SELECT unnest(terms) LOOP
    t := trim(regexp_replace(t, '[&|!():*''"\\]', ' ', 'g'));
    IF length(t) > 0 THEN
      term_q := plainto_tsquery('simple', t);
      IF term_q = ''::tsquery THEN
        CONTINUE;
      END IF;

      IF q = ''::tsquery THEN
        q := term_q;
      ELSE
        q := q || term_q;
      END IF;
    END IF;
  END LOOP;
  RETURN q;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- 13. Optimized evidence search function
--     Uses full-text search for fast pre-filtering, then trigram similarity
--     for ranking. Falls back to plain ILIKE when FTS returns no hits.

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
  unit_id bigint,
  document_id bigint,
  unit_index integer,
  unit_kind text,
  heading text,
  speaker text,
  scene_code text,
  text_preview text,
  summary text,
  summary_short text,
  summary_type text,
  summary_confidence text,
  perspective_note text,
  key_terms jsonb,
  document_title text,
  subtitle text,
  source_name text,
  source_uri text,
  source_tier smallint,
  content_type text,
  canon_status text,
  perspective_scope text,
  operator_name text,
  operator_summary text,
  top_group text,
  group_name text,
  document_story_path jsonb,
  evidence_lane text,
  lane_priority int,
  score real
) AS $$
DECLARE
  query_terms text[];
  query_ts tsquery;
  use_fts boolean;
BEGIN
  query_terms := regexp_split_to_array(trim(search_query), '[\s,，、。；;|/]+');
  query_ts := array_to_tsquery(query_terms);
  use_fts := query_ts <> ''::tsquery;

  RETURN QUERY
  WITH matched AS (
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
      d.canon_status,
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
      CASE WHEN use_fts AND (d.search_vector @@ query_ts OR tu.search_vector @@ query_ts) THEN 100 ELSE 0 END +
      CASE WHEN d.title ILIKE ANY(ARRAY(SELECT '%' || t || '%' FROM unnest(query_terms) t)) THEN 90 ELSE 0 END +
      CASE WHEN d.metadata->>'operator_name' ILIKE ANY(ARRAY(SELECT '%' || t || '%' FROM unnest(query_terms) t)) THEN 95 ELSE 0 END +
      CASE WHEN d.metadata->>'operator_summary' ILIKE ANY(ARRAY(SELECT '%' || t || '%' FROM unnest(query_terms) t)) THEN 75 ELSE 0 END +
      CASE WHEN tu.heading ILIKE ANY(ARRAY(SELECT '%' || t || '%' FROM unnest(query_terms) t)) THEN 45 ELSE 0 END +
      CASE WHEN tu.metadata->>'summary_short' ILIKE ANY(ARRAY(SELECT '%' || t || '%' FROM unnest(query_terms) t)) THEN 55 ELSE 0 END +
      CASE WHEN tu.metadata->>'summary' ILIKE ANY(ARRAY(SELECT '%' || t || '%' FROM unnest(query_terms) t)) THEN 40 ELSE 0 END +
      CASE WHEN tu.text ILIKE ANY(ARRAY(SELECT '%' || t || '%' FROM unnest(query_terms) t)) THEN 12 ELSE 0 END +
      CASE WHEN EXISTS (
        SELECT 1 FROM jsonb_array_elements_text(COALESCE(tu.metadata->'key_terms', '[]'::jsonb)) kt
        WHERE kt.term ILIKE ANY(ARRAY(SELECT '%' || t || '%' FROM unnest(query_terms) t))
      ) THEN 65 ELSE 0 END +
      CASE WHEN d.source_tier = 1 THEN 35 WHEN d.source_tier = 2 THEN 25 WHEN d.source_tier = 3 THEN 10 ELSE 0 END +
      CASE WHEN d.content_type = 'operator_profile' AND (
        d.metadata->>'operator_summary' ILIKE ANY(ARRAY(SELECT '%' || t || '%' FROM unnest(query_terms) t))
        OR d.metadata->>'operator_name' ILIKE ANY(ARRAY(SELECT '%' || t || '%' FROM unnest(query_terms) t))
      ) THEN 40 ELSE 0 END +
      CASE WHEN tu.metadata ? 'summary' THEN 30 ELSE 0 END AS score
    FROM text_units tu
    JOIN documents d ON d.document_id = tu.document_id
    WHERE (
      NOT use_fts
      OR d.search_vector @@ query_ts
      OR tu.search_vector @@ query_ts
      OR EXISTS (
        SELECT 1 FROM unnest(query_terms) t
        WHERE d.title ILIKE '%' || t || '%'
           OR d.metadata->>'operator_name' ILIKE '%' || t || '%'
           OR d.metadata->>'operator_summary' ILIKE '%' || t || '%'
           OR tu.heading ILIKE '%' || t || '%'
           OR tu.metadata->>'summary_short' ILIKE '%' || t || '%'
           OR tu.metadata->>'summary' ILIKE '%' || t || '%'
           OR tu.text ILIKE '%' || t || '%'
      )
    )
    AND (source_tiers IS NULL OR d.source_tier = ANY(source_tiers))
    AND (content_types IS NULL OR d.content_type = ANY(content_types))
    AND (document_ids IS NULL OR d.document_id = ANY(document_ids))
    AND (group_names IS NULL OR d.metadata->>'group_name' = ANY(group_names))
    AND (top_groups IS NULL OR d.metadata->>'top_group' = ANY(top_groups))
    AND (title_contains IS NULL OR d.title ILIKE ANY(ARRAY(SELECT '%' || t || '%' FROM unnest(title_contains) t)))
  ),
  diversified AS (
    SELECT matched.*,
           row_number() OVER (PARTITION BY evidence_lane ORDER BY score DESC, source_tier ASC, unit_index ASC) AS lane_rank
    FROM matched
  )
  SELECT * FROM diversified
  ORDER BY lane_rank ASC, lane_priority ASC, score DESC, unit_id ASC
  LIMIT max_results;
END;
$$ LANGUAGE plpgsql STABLE;

-- 14. Optimized tree browse function
--     Uses document_stats materialized view to avoid real-time aggregation.

CREATE OR REPLACE FUNCTION browse_tree_optimized(
  query_terms text[] DEFAULT NULL,
  source_tiers smallint[] DEFAULT NULL,
  content_types text[] DEFAULT NULL,
  top_groups text[] DEFAULT NULL,
  group_names text[] DEFAULT NULL,
  only_relevant boolean DEFAULT false,
  max_results integer DEFAULT 300
) RETURNS TABLE(
  document_id bigint,
  title text,
  subtitle text,
  source_tier smallint,
  content_type text,
  top_group text,
  group_name text,
  story_path jsonb,
  unit_count int,
  summarized_unit_count int,
  relevant_unit_count int
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    ds.document_id,
    ds.title,
    ds.subtitle,
    ds.source_tier,
    ds.content_type,
    ds.top_group,
    ds.group_name,
    ds.story_path,
    ds.unit_count,
    ds.summarized_unit_count,
    CASE
      WHEN query_terms IS NULL OR array_length(query_terms, 1) IS NULL THEN 0::int
      ELSE (
        SELECT COUNT(*)::int
        FROM text_units tu
        WHERE tu.document_id = ds.document_id
          AND (
            tu.heading ILIKE ANY(query_terms)
            OR tu.text ILIKE ANY(query_terms)
            OR tu.metadata->>'summary' ILIKE ANY(query_terms)
            OR tu.metadata->>'summary_short' ILIKE ANY(query_terms)
            OR EXISTS (
              SELECT 1 FROM jsonb_array_elements_text(COALESCE(tu.metadata->'key_terms', '[]'::jsonb)) kt
              WHERE kt.term ILIKE ANY(query_terms)
            )
          )
      )
    END AS relevant_unit_count
  FROM document_stats ds
  WHERE (source_tiers IS NULL OR ds.source_tier = ANY(source_tiers))
    AND (content_types IS NULL OR ds.content_type = ANY(content_types))
    AND (top_groups IS NULL OR ds.top_group = ANY(top_groups))
    AND (group_names IS NULL OR ds.group_name = ANY(group_names))
    AND (
      NOT only_relevant
      OR query_terms IS NULL
      OR EXISTS (
        SELECT 1 FROM text_units tu
        WHERE tu.document_id = ds.document_id
          AND (
            tu.heading ILIKE ANY(query_terms)
            OR tu.text ILIKE ANY(query_terms)
            OR tu.metadata->>'summary' ILIKE ANY(query_terms)
            OR tu.metadata->>'summary_short' ILIKE ANY(query_terms)
            OR EXISTS (
              SELECT 1 FROM jsonb_array_elements_text(COALESCE(tu.metadata->'key_terms', '[]'::jsonb)) kt
              WHERE kt.term ILIKE ANY(query_terms)
            )
          )
      )
    )
  ORDER BY
    CASE WHEN query_terms IS NULL THEN 0 ELSE
      CASE WHEN EXISTS (
        SELECT 1 FROM text_units tu
        WHERE tu.document_id = ds.document_id
          AND (
            tu.heading ILIKE ANY(query_terms)
            OR tu.text ILIKE ANY(query_terms)
            OR tu.metadata->>'summary' ILIKE ANY(query_terms)
            OR tu.metadata->>'summary_short' ILIKE ANY(query_terms)
            OR EXISTS (
              SELECT 1 FROM jsonb_array_elements_text(COALESCE(tu.metadata->'key_terms', '[]'::jsonb)) kt
              WHERE kt.term ILIKE ANY(query_terms)
            )
          )
      ) THEN 1 ELSE 0 END
    END DESC,
    ds.source_tier ASC,
    ds.title ASC
  LIMIT max_results;
END;
$$ LANGUAGE plpgsql STABLE;

-- 15. Optimized entity resolution function
--     Uses trigram similarity index for fuzzy matching with better performance.

CREATE OR REPLACE FUNCTION resolve_entities_optimized(
  search_query text,
  max_results integer DEFAULT 10
) RETURNS TABLE(
  entity_id bigint,
  entity_type text,
  name text,
  name_en text,
  summary text,
  review_status text,
  aliases jsonb,
  match_score numeric,
  document_count int
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    e.entity_id,
    e.entity_type,
    e.name,
    e.name_en,
    e.summary,
    e.review_status,
    COALESCE(jsonb_agg(DISTINCT ea.alias) FILTER (WHERE ea.alias IS NOT NULL), '[]'::jsonb) AS aliases,
    MAX(GREATEST(
      CASE WHEN e.name = search_query THEN 100 ELSE 0 END,
      CASE WHEN e.name_en = search_query THEN 98 ELSE 0 END,
      CASE WHEN ea.alias = search_query THEN 95 ELSE 0 END,
      CASE WHEN e.name ILIKE '%' || search_query || '%' THEN 82 ELSE 0 END,
      CASE WHEN e.name_en ILIKE '%' || search_query || '%' THEN 78 ELSE 0 END,
      CASE WHEN ea.alias ILIKE '%' || search_query || '%' THEN 76 ELSE 0 END,
      similarity(e.name, search_query) * 60,
      similarity(COALESCE(e.name_en, ''), search_query) * 55,
      similarity(COALESCE(ea.alias, ''), search_query) * 50
    )) AS match_score,
    ((
      SELECT COUNT(DISTINCT em.document_id)::int
      FROM entity_mentions em
      WHERE em.entity_id = e.entity_id
    ) + (
      SELECT COUNT(DISTINCT d.document_id)::int
      FROM documents d
      WHERE d.metadata->>'operator_name' = e.name
    )) AS document_count
  FROM entities e
  LEFT JOIN entity_aliases ea ON ea.entity_id = e.entity_id
  WHERE e.name ILIKE '%' || search_query || '%'
     OR e.name_en ILIKE '%' || search_query || '%'
     OR ea.alias ILIKE '%' || search_query || '%'
     OR similarity(e.name, search_query) > 0.2
     OR similarity(COALESCE(e.name_en, ''), search_query) > 0.2
     OR similarity(COALESCE(ea.alias, ''), search_query) > 0.2
  GROUP BY e.entity_id, e.entity_type, e.name, e.name_en, e.summary, e.review_status
  ORDER BY match_score DESC, document_count DESC, e.name
  LIMIT max_results;
END;
$$ LANGUAGE plpgsql STABLE;

-- 16. Stats helper: estimate table sizes and index usage for monitoring

CREATE OR REPLACE FUNCTION get_table_index_stats()
RETURNS TABLE(
  table_name text,
  row_estimate bigint,
  total_size text,
  index_size text,
  index_count bigint
) AS $$
  SELECT
    c.relname::text AS table_name,
    c.reltuples::bigint AS row_estimate,
    pg_size_pretty(pg_total_relation_size(c.oid)) AS total_size,
    pg_size_pretty(pg_indexes_size(c.oid)) AS index_size,
    (SELECT COUNT(*) FROM pg_index i WHERE i.indrelid = c.oid)::bigint AS index_count
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relkind = 'r'
    AND c.relname IN ('documents', 'text_units', 'entities', 'entity_aliases', 'entity_mentions', 'claims', 'claim_evidence', 'events', 'event_participants', 'entity_relations', 'research_sessions', 'research_subtasks', 'evidence_notes', 'topic_briefs')
  ORDER BY pg_total_relation_size(c.oid) DESC;
$$ LANGUAGE sql STABLE;
