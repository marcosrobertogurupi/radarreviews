-- ============================================================
-- FUNÇÃO DE BUSCA SEMÂNTICA EM TODOS OS STATUS DE CONHECIMENTO
-- ============================================================
CREATE OR REPLACE FUNCTION search_knowledge_all_status(
  query_embedding vector(768),
  match_threshold FLOAT   DEFAULT 0.65,
  match_count     INT     DEFAULT 5,
  filter_category UUID    DEFAULT NULL
)
RETURNS TABLE (
  doc_id           UUID,
  title            TEXT,
  solution_summary TEXT,
  solution_steps   JSONB,
  similarity       FLOAT,
  confidence_score NUMERIC,
  resolution_count INT,
  status           TEXT
)
LANGUAGE sql STABLE AS $$
  SELECT
    d.id,
    d.title,
    d.solution_summary,
    d.solution_steps,
    1 - (e.embedding <=> query_embedding) AS similarity,
    d.confidence_score,
    d.resolution_count,
    d.status
  FROM support_knowledge_embeddings e
  JOIN support_knowledge_docs d ON d.id = e.doc_id
  WHERE (filter_category IS NULL OR d.category_id = filter_category)
    AND 1 - (e.embedding <=> query_embedding) >= match_threshold
  ORDER BY e.embedding <=> query_embedding
  LIMIT match_count;
$$;
