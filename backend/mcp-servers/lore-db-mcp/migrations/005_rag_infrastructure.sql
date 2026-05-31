-- ============================================================================
-- IRIS RAG Infrastructure Migration 005
-- Adds pgvector embedding tables, HNSW indexes, embedding jobs outbox,
-- and helper functions for the A+B hybrid retrieval system.
--
-- Design: same-database pgvector sidecar. Database = source of truth,
-- vector layer = derived index. Feature-flagged per stage.
-- ============================================================================

-- 1. Enable pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- 2. Document-level embedding table (for Plan-phase dense recall)
CREATE TABLE IF NOT EXISTS document_embeddings (
    document_id bigint PRIMARY KEY REFERENCES documents(document_id) ON DELETE CASCADE,
    embedding vector(1024) NOT NULL,
    embedding_model text NOT NULL DEFAULT 'bge-m3',
    embedding_version integer NOT NULL DEFAULT 1,
    content_hash text NOT NULL,
    source_updated_at timestamptz NOT NULL DEFAULT now(),
    embedded_at timestamptz NOT NULL DEFAULT now()
);

-- 3. Unit-level embedding table (for Subtask-phase scoped dense recall)
CREATE TABLE IF NOT EXISTS unit_embeddings (
    unit_id bigint PRIMARY KEY REFERENCES text_units(unit_id) ON DELETE CASCADE,
    document_id bigint NOT NULL REFERENCES documents(document_id) ON DELETE CASCADE,
    embedding vector(1024) NOT NULL,
    embedding_model text NOT NULL DEFAULT 'bge-m3',
    embedding_version integer NOT NULL DEFAULT 1,
    content_hash text NOT NULL,
    source_updated_at timestamptz NOT NULL DEFAULT now(),
    embedded_at timestamptz NOT NULL DEFAULT now()
);

-- 4. Embedding jobs outbox — asynchronous pipeline entry point
CREATE TABLE IF NOT EXISTS embedding_jobs (
    job_id bigserial PRIMARY KEY,
    target_type text NOT NULL CHECK (target_type IN ('document', 'text_unit')),
    target_id bigint NOT NULL,
    content_hash text,
    priority smallint NOT NULL DEFAULT 5 CHECK (priority BETWEEN 1 AND 10),
    status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'done', 'failed')),
    error_message text,
    attempt_count smallint NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT now(),
    started_at timestamptz,
    completed_at timestamptz,
    UNIQUE (target_type, target_id)
);

-- 5. HNSW indexes (built after data population for speed)
-- Index creation is deferred — built after backfill, per pgvector best practices.
-- CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_doc_embeddings_hnsw
--   ON document_embeddings USING hnsw (embedding vector_cosine_ops)
--   WITH (m = 16, ef_construction = 64);
--
-- CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_unit_embeddings_hnsw
--   ON unit_embeddings USING hnsw (embedding vector_cosine_ops)
--   WITH (m = 16, ef_construction = 64);

-- 6. Partial HNSW indexes by content type for filtered ANN (optional, create as needed)
-- CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_unit_embeddings_story_hnsw
--   ON unit_embeddings USING hnsw (embedding vector_cosine_ops)
--   WITH (m = 16, ef_construction = 64)
--   WHERE document_id IN (SELECT document_id FROM documents WHERE content_type IN ('mainline_story', 'event_story'));

-- 7. Content hash function for change detection
CREATE OR REPLACE FUNCTION embedding_content_hash(
    p_title text,
    p_subtitle text,
    p_operator_name text,
    p_operator_summary text,
    p_text text,
    p_heading text,
    p_summary text,
    p_summary_short text,
    p_key_terms jsonb
) RETURNS text AS $$
    SELECT md5(
        COALESCE(p_title, '') || '|' ||
        COALESCE(p_subtitle, '') || '|' ||
        COALESCE(p_operator_name, '') || '|' ||
        COALESCE(p_operator_summary, '') || '|' ||
        COALESCE(p_text, '') || '|' ||
        COALESCE(p_heading, '') || '|' ||
        COALESCE(p_summary, '') || '|' ||
        COALESCE(p_summary_short, '') || '|' ||
        COALESCE(p_key_terms::text, '')
    );
$$ LANGUAGE sql IMMUTABLE;

-- 8. Trigger function to queue embedding jobs on content changes
CREATE OR REPLACE FUNCTION queue_embedding_job()
RETURNS TRIGGER AS $$
DECLARE
    new_hash text;
    target_type text;
BEGIN
    target_type := TG_ARGV[0];

    IF target_type = 'document' THEN
        new_hash := embedding_content_hash(
            NEW.title, NEW.subtitle,
            NEW.metadata->>'operator_name', NEW.metadata->>'operator_summary',
            NULL, NULL, NULL, NULL, NULL
        );
    ELSIF target_type = 'text_unit' THEN
        new_hash := embedding_content_hash(
            NULL, NULL, NULL, NULL,
            NEW.text, NEW.heading,
            NEW.metadata->>'summary', NEW.metadata->>'summary_short',
            NEW.metadata->'key_terms'
        );
    ELSE
        RETURN NEW;
    END IF;

    INSERT INTO embedding_jobs (target_type, target_id, content_hash, priority)
    VALUES (target_type,
        CASE WHEN target_type = 'document' THEN NEW.document_id ELSE NEW.unit_id END,
        new_hash, 5)
    ON CONFLICT (target_type, target_id) DO UPDATE
    SET content_hash = EXCLUDED.content_hash,
        status = 'pending',
        attempt_count = 0,
        error_message = NULL,
        created_at = now(),
        started_at = NULL,
        completed_at = NULL
    WHERE embedding_jobs.content_hash IS DISTINCT FROM EXCLUDED.content_hash;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 9. Triggers for auto-queueing (idempotent — drop first then create)
DROP TRIGGER IF EXISTS trg_document_embedding_queue ON documents;
CREATE TRIGGER trg_document_embedding_queue
    AFTER INSERT OR UPDATE OF title, subtitle, metadata ON documents
    FOR EACH ROW EXECUTE FUNCTION queue_embedding_job('document');

DROP TRIGGER IF EXISTS trg_text_unit_embedding_queue ON text_units;
CREATE TRIGGER trg_text_unit_embedding_queue
    AFTER INSERT OR UPDATE OF heading, text, metadata ON text_units
    FOR EACH ROW EXECUTE FUNCTION queue_embedding_job('text_unit');

-- 10. Helper: check if vector layer is ready (has embeddings)
CREATE OR REPLACE FUNCTION rag_is_ready()
RETURNS boolean AS $$
    SELECT EXISTS (SELECT 1 FROM document_embeddings LIMIT 1)
       AND EXISTS (SELECT 1 FROM unit_embeddings LIMIT 1);
$$ LANGUAGE sql STABLE;

-- 11. Helper: get vector staleness stats
CREATE OR REPLACE FUNCTION rag_staleness_stats()
RETURNS TABLE(
    embedding_type text,
    total_count bigint,
    stale_count bigint,
    max_lag interval
) AS $$
    SELECT 'document'::text,
           COUNT(*),
           COUNT(*) FILTER (WHERE embedded_at < source_updated_at),
           MAX(embedded_at - source_updated_at) FILTER (WHERE embedded_at < source_updated_at)
    FROM document_embeddings
    UNION ALL
    SELECT 'text_unit'::text,
           COUNT(*),
           COUNT(*) FILTER (WHERE embedded_at < source_updated_at),
           MAX(embedded_at - source_updated_at) FILTER (WHERE embedded_at < source_updated_at)
    FROM unit_embeddings;
$$ LANGUAGE sql STABLE;

-- 12. RAG feature flags table
CREATE TABLE IF NOT EXISTS rag_feature_flags (
    flag_name text PRIMARY KEY,
    enabled boolean NOT NULL DEFAULT false,
    description text,
    updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO rag_feature_flags (flag_name, enabled, description) VALUES
    ('rag_doc_recall', false, 'Document-level dense recall for Plan phase low-hit supplementation'),
    ('rag_unit_recall', false, 'Unit-level dense recall for scoped Subtask supplementation'),
    ('rag_rerank', false, 'Cross-encoder rerank for A+B merged candidates'),
    ('rag_query_rewrite', false, 'Query rewrite for fuzzy/natural-language queries'),
    ('rag_generation', false, 'Optional LLM answer generation from evidence pack')
ON CONFLICT (flag_name) DO NOTHING;

-- 13. Index on embedding_jobs for worker polling
CREATE INDEX IF NOT EXISTS idx_embedding_jobs_pending
    ON embedding_jobs (status, priority DESC, created_at)
    WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_unit_embeddings_document_id
    ON unit_embeddings (document_id);

-- 14. Backfill: queue all existing documents and text_units for embedding
INSERT INTO embedding_jobs (target_type, target_id, content_hash, priority)
SELECT 'document', d.document_id,
       embedding_content_hash(d.title, d.subtitle,
           d.metadata->>'operator_name', d.metadata->>'operator_summary',
           NULL, NULL, NULL, NULL, NULL),
       7
FROM documents d
ON CONFLICT (target_type, target_id) DO NOTHING;

INSERT INTO embedding_jobs (target_type, target_id, content_hash, priority)
SELECT 'text_unit', tu.unit_id,
       embedding_content_hash(NULL, NULL, NULL, NULL,
           tu.text, tu.heading,
           tu.metadata->>'summary', tu.metadata->>'summary_short',
           tu.metadata->'key_terms'),
       5
FROM text_units tu
WHERE tu.unit_index > 0  -- prioritize chunks over full_text rows
ON CONFLICT (target_type, target_id) DO NOTHING;

-- Also queue full_text rows at lower priority
INSERT INTO embedding_jobs (target_type, target_id, content_hash, priority)
SELECT 'text_unit', tu.unit_id,
       embedding_content_hash(NULL, NULL, NULL, NULL,
           tu.text, tu.heading,
           tu.metadata->>'summary', tu.metadata->>'summary_short',
           tu.metadata->'key_terms'),
       3
FROM text_units tu
WHERE tu.unit_index = 0 OR tu.unit_index IS NULL
ON CONFLICT (target_type, target_id) DO NOTHING;
