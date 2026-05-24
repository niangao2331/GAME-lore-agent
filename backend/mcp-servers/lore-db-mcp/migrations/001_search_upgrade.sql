-- ============================================================================
-- IRIS Search Upgrade Migration 001
-- Adds full-text search, trigram indexes, and AI-search optimizations.
-- Safe to run multiple times (all DDL uses IF NOT EXISTS / IF EXISTS).
-- NO data is removed or modified beyond adding new columns.
-- ============================================================================

-- 1. Extensions --------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- 2. Trigram indexes (accelerates existing ILIKE queries 10-100x) ------------
CREATE INDEX IF NOT EXISTS idx_assets_title_trgm
  ON arknights_lore.assets USING GIN (title gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_assets_subtitle_trgm
  ON arknights_lore.assets USING GIN (subtitle gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_text_contents_full_text_trgm
  ON arknights_lore.text_contents USING GIN (full_text gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_asset_chunks_chunk_text_trgm
  ON arknights_lore.asset_chunks USING GIN (chunk_text gin_trgm_ops);

-- 3. Full-text search vector columns -----------------------------------------
ALTER TABLE arknights_lore.assets
  ADD COLUMN IF NOT EXISTS search_vector tsvector;

ALTER TABLE arknights_lore.text_contents
  ADD COLUMN IF NOT EXISTS search_vector tsvector;

ALTER TABLE arknights_lore.asset_chunks
  ADD COLUMN IF NOT EXISTS search_vector tsvector;

-- 4. Populate search vectors (only NULL rows) --------------------------------
UPDATE arknights_lore.assets
  SET search_vector =
    setweight(to_tsvector('simple', COALESCE(title, '')), 'A') ||
    setweight(to_tsvector('simple', COALESCE(subtitle, '')), 'B')
  WHERE search_vector IS NULL;

UPDATE arknights_lore.text_contents
  SET search_vector = to_tsvector('simple', COALESCE(full_text, ''))
  WHERE search_vector IS NULL;

UPDATE arknights_lore.asset_chunks
  SET search_vector =
    setweight(to_tsvector('simple', COALESCE(heading, '')), 'A') ||
    to_tsvector('simple', COALESCE(chunk_text, ''))
  WHERE search_vector IS NULL;

-- 5. GIN indexes for tsvector columns ----------------------------------------
CREATE INDEX IF NOT EXISTS idx_assets_search_vector
  ON arknights_lore.assets USING GIN (search_vector);

CREATE INDEX IF NOT EXISTS idx_text_contents_search_vector
  ON arknights_lore.text_contents USING GIN (search_vector);

CREATE INDEX IF NOT EXISTS idx_asset_chunks_search_vector
  ON arknights_lore.asset_chunks USING GIN (search_vector);

-- 6. Composite index for common join pattern ---------------------------------
CREATE INDEX IF NOT EXISTS idx_asset_tags_asset_tag
  ON arknights_lore.asset_tags(asset_id, tag_id);

-- 7. Index on narrative_layer for source criticism queries -------------------
CREATE INDEX IF NOT EXISTS idx_text_contents_narrative_layer
  ON arknights_lore.text_contents(narrative_layer);

-- 8. Trigger: auto-update asset search_vector on insert/update ---------------
CREATE OR REPLACE FUNCTION arknights_lore.update_asset_search_vector()
RETURNS TRIGGER AS $$
BEGIN
  NEW.search_vector :=
    setweight(to_tsvector('simple', COALESCE(NEW.title, '')), 'A') ||
    setweight(to_tsvector('simple', COALESCE(NEW.subtitle, '')), 'B');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_asset_search_vector ON arknights_lore.assets;
CREATE TRIGGER trg_asset_search_vector
  BEFORE INSERT OR UPDATE OF title, subtitle ON arknights_lore.assets
  FOR EACH ROW EXECUTE FUNCTION arknights_lore.update_asset_search_vector();

-- 9. Helper function: combined FTS search across all text --------------------
CREATE OR REPLACE FUNCTION arknights_lore.search_fts(
  search_query text,
  max_results integer DEFAULT 50
) RETURNS TABLE(
  asset_id integer,
  title text,
  category_code text,
  category_name text,
  text_preview text,
  rank real,
  source_table text
) AS $$
  WITH query_ts AS (
    SELECT
      CASE
        WHEN $1 ~ '[''&|!():*]' THEN to_tsquery('simple', $1)
        ELSE plainto_tsquery('simple', $1)
      END AS q
  )
  SELECT
    a.asset_id,
    a.title,
    c.category_code,
    c.category_name,
    LEFT(COALESCE(tc.full_text, ac.chunk_text, ''), 200) AS text_preview,
    GREATEST(
      COALESCE(ts_rank(a.search_vector, qt.q), 0),
      COALESCE(ts_rank(tc.search_vector, qt.q), 0),
      COALESCE(ts_rank(ac.search_vector, qt.q), 0)
    ) AS rank,
    CASE
      WHEN tc.search_vector @@ qt.q THEN 'text_content'
      WHEN ac.search_vector @@ qt.q THEN 'asset_chunk'
      WHEN a.search_vector @@ qt.q THEN 'asset_meta'
      ELSE 'fallback'
    END AS source_table
  FROM arknights_lore.assets a
  LEFT JOIN arknights_lore.categories c ON c.category_id = a.category_id
  LEFT JOIN arknights_lore.text_contents tc ON tc.asset_id = a.asset_id
  LEFT JOIN arknights_lore.asset_chunks ac ON ac.asset_id = a.asset_id
  CROSS JOIN query_ts qt
  WHERE a.search_vector @@ qt.q
     OR tc.search_vector @@ qt.q
     OR ac.search_vector @@ qt.q
  ORDER BY rank DESC
  LIMIT max_results;
$$ LANGUAGE sql STABLE;
