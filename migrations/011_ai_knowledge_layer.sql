-- pgvector já disponível no Supabase
CREATE EXTENSION IF NOT EXISTS vector;

-- ============================================================
-- DOCUMENTOS DE CONHECIMENTO (gerados automaticamente pela IA)
-- ============================================================
CREATE TABLE support_knowledge_docs (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id         UUID        REFERENCES ticket_categories(id),
  title               TEXT        NOT NULL,
  problem_description TEXT        NOT NULL,
  problem_variants    TEXT[]      DEFAULT '{}',
  solution_steps      JSONB       NOT NULL DEFAULT '[]',
  solution_summary    TEXT        NOT NULL,
  tags                TEXT[]      DEFAULT '{}',
  keywords            TEXT[]      DEFAULT '{}',
  source_ticket_ids   UUID[]      DEFAULT '{}',
  resolution_count    INTEGER     NOT NULL DEFAULT 1,
  avg_csat            NUMERIC(3,2),
  confidence_score    NUMERIC(4,3) NOT NULL DEFAULT 0.700,
  status              TEXT        NOT NULL DEFAULT 'draft'
                      CHECK (status IN ('draft','active','archived','needs_review')),
  auto_published      BOOLEAN     NOT NULL DEFAULT FALSE,
  reviewed_by         UUID        REFERENCES auth.users(id),
  reviewed_at         TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_kb_docs_category ON support_knowledge_docs(category_id) WHERE status = 'active';
CREATE INDEX idx_kb_docs_status   ON support_knowledge_docs(status);

-- FK da tabela de tickets para o doc usado pela IA
ALTER TABLE support_tickets
  ADD CONSTRAINT fk_ticket_ai_doc
  FOREIGN KEY (ai_doc_used_id) REFERENCES support_knowledge_docs(id) ON DELETE SET NULL;

-- ============================================================
-- EMBEDDINGS VETORIAIS (768 dims — Gemini text-embedding-004)
-- ============================================================
CREATE TABLE support_knowledge_embeddings (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  doc_id     UUID        NOT NULL REFERENCES support_knowledge_docs(id) ON DELETE CASCADE,
  content    TEXT        NOT NULL,
  embedding  vector(768) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- HNSW index — busca de similaridade cosine em <10ms para KB de até 100k docs
CREATE INDEX idx_kb_embeddings_hnsw
  ON support_knowledge_embeddings
  USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

-- ============================================================
-- FUNÇÃO DE BUSCA SEMÂNTICA
-- ============================================================
CREATE OR REPLACE FUNCTION search_knowledge(
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
  resolution_count INT
)
LANGUAGE sql STABLE AS $$
  SELECT
    d.id,
    d.title,
    d.solution_summary,
    d.solution_steps,
    1 - (e.embedding <=> query_embedding) AS similarity,
    d.confidence_score,
    d.resolution_count
  FROM support_knowledge_embeddings e
  JOIN support_knowledge_docs d ON d.id = e.doc_id
  WHERE d.status = 'active'
    AND (filter_category IS NULL OR d.category_id = filter_category)
    AND 1 - (e.embedding <=> query_embedding) >= match_threshold
  ORDER BY e.embedding <=> query_embedding
  LIMIT match_count;
$$;

-- ============================================================
-- INTERAÇÕES DA IA (log de cada ação do agente)
-- ============================================================
CREATE TABLE ticket_ai_interactions (
  id               UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id        UUID    NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
  interaction_type TEXT    NOT NULL
                   CHECK (interaction_type IN (
                     'triage','knowledge_search','autonomous_response',
                     'draft_suggestion','satisfaction_check','auto_close',
                     'escalation_decision','learning_extraction'
                   )),
  query_text       TEXT,
  matched_doc_ids  UUID[]  DEFAULT '{}',
  top_similarity   NUMERIC(4,3),
  confidence_tier  TEXT    CHECK (confidence_tier IN ('T1','T2','T3')),
  generated_response TEXT,
  model_used       TEXT    DEFAULT 'gemini-flash',
  prompt_tokens    INTEGER,
  completion_tokens INTEGER,
  outcome          TEXT    CHECK (outcome IN (
    'sent_autonomously','draft_shown','routed_to_human',
    'customer_satisfied','customer_not_satisfied','timeout_closed',
    'knowledge_extracted','knowledge_updated'
  )),
  outcome_csat     SMALLINT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_ai_interactions_ticket ON ticket_ai_interactions(ticket_id, created_at);

-- ============================================================
-- FILA DE APRENDIZADO
-- ============================================================
CREATE TABLE support_learning_queue (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id    UUID        NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE UNIQUE,
  priority     SMALLINT    NOT NULL DEFAULT 5,
  attempts     SMALLINT    NOT NULL DEFAULT 0,
  last_error   TEXT,
  scheduled_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_learning_queue_pending
  ON support_learning_queue(priority, scheduled_at)
  WHERE processed_at IS NULL;

-- trigger updated_at para knowledge_docs
CREATE TRIGGER set_kb_doc_updated_at
  BEFORE UPDATE ON support_knowledge_docs
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
