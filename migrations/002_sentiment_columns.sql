-- Migration: Add AI Sentiment Analysis columns to reviews table
-- Executar no SQL Editor do Supabase Dashboard
-- Versão corrigida — sem INDEX em created_at (coluna não existe na tabela reviews)

-- 1. Adicionar colunas de análise de sentimento (as 4 colunas novas)
ALTER TABLE reviews
  ADD COLUMN IF NOT EXISTS dissatisfaction_score  INTEGER,
  ADD COLUMN IF NOT EXISTS sentiment_topics       TEXT[],
  ADD COLUMN IF NOT EXISTS sentiment_summary      TEXT,
  ADD COLUMN IF NOT EXISTS sentiment_result       JSONB;

-- 2. Check constraint no score (0 a 100)
ALTER TABLE reviews
  DROP CONSTRAINT IF EXISTS reviews_dissatisfaction_score_check;

ALTER TABLE reviews
  ADD CONSTRAINT reviews_dissatisfaction_score_check
  CHECK (dissatisfaction_score IS NULL OR (dissatisfaction_score >= 0 AND dissatisfaction_score <= 100));

-- 3. Índices de performance (apenas em colunas que existem)
CREATE INDEX IF NOT EXISTS reviews_sentiment_idx         ON reviews (sentiment);
CREATE INDEX IF NOT EXISTS reviews_dissatisfaction_idx   ON reviews (dissatisfaction_score DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS reviews_channel_sent_idx      ON reviews (channel, sentiment);
CREATE INDEX IF NOT EXISTS reviews_published_at_idx      ON reviews (published_at DESC);

-- 4. Verificar resultado
SELECT
  column_name,
  data_type,
  is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'reviews'
ORDER BY ordinal_position;
