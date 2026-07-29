-- ============================================================
-- MIGRATION 035: Autonomous AI Auto-Reply & Continuous Learning System
-- ============================================================

-- 1. Garantir que pgvector existe
CREATE EXTENSION IF NOT EXISTS vector;

-- 2. Configuração de Auto-Resposta por Empresa
ALTER TABLE monitored_businesses
  ADD COLUMN IF NOT EXISTS auto_reply_settings JSONB DEFAULT '{
    "enabled": false,
    "mode": "hybrid",
    "signature": "Equipe de Atendimento",
    "tone_of_voice": "hospitalidade_cordial",
    "mention_staff_names": true,
    "auto_publish_min_rating": 4,
    "channels": ["google_maps", "tripadvisor", "facebook", "instagram", "reclame_aqui", "consumidor_gov", "trustpilot", "reddit"]
  }'::jsonb;

-- 3. Colunas de rastreamento de resposta em reviews
ALTER TABLE reviews
  ADD COLUMN IF NOT EXISTS responded_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS response_text TEXT,
  ADD COLUMN IF NOT EXISTS response_status TEXT DEFAULT 'none'
    CHECK (response_status IN ('none', 'draft', 'pending_approval', 'publishing', 'published', 'failed')),
  ADD COLUMN IF NOT EXISTS responded_by UUID; -- NULL se gerado/enviado via IA autônoma

-- 4. Tabela de Memória & Exemplos de Aprendizado por Tenant (Few-Shot RAG)
CREATE TABLE IF NOT EXISTS review_reply_examples (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  business_id         UUID        REFERENCES monitored_businesses(id) ON DELETE CASCADE,
  review_id           UUID        REFERENCES reviews(id) ON DELETE SET NULL,
  channel             source_channel NOT NULL,
  rating              NUMERIC(2,1),
  review_text         TEXT        NOT NULL,
  user_approved_text  TEXT        NOT NULL,
  embedding           vector(768),
  was_edited_by_user  BOOLEAN     NOT NULL DEFAULT false,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_reply_examples_tenant ON review_reply_examples(tenant_id);

-- Índices vetoriais HNSW para busca semântica em tempo real (<10ms)
CREATE INDEX IF NOT EXISTS idx_reply_examples_hnsw
  ON review_reply_examples
  USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

-- 5. Função RPC para buscar exemplos similares de aprendizado do tenant
CREATE OR REPLACE FUNCTION search_reply_examples(
  p_tenant_id        UUID,
  p_query_embedding  vector(768),
  p_match_threshold  FLOAT DEFAULT 0.60,
  p_match_count      INT   DEFAULT 3
)
RETURNS TABLE (
  id                 UUID,
  review_text        TEXT,
  user_approved_text TEXT,
  rating             NUMERIC,
  similarity         FLOAT
)
LANGUAGE sql STABLE AS $$
  SELECT
    e.id,
    e.review_text,
    e.user_approved_text,
    e.rating,
    1 - (e.embedding <=> p_query_embedding) AS similarity
  FROM review_reply_examples e
  WHERE e.tenant_id = p_tenant_id
    AND (e.embedding IS NULL OR 1 - (e.embedding <=> p_query_embedding) >= p_match_threshold)
  ORDER BY (e.embedding <=> p_query_embedding) ASC
  LIMIT p_match_count;
$$;
