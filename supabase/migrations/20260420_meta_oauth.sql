-- Migration: Meta OAuth and Review Sentiment Score
-- Description: Adiciona campos para o fluxo OAuth da Meta e para análise rica de sentimento.

-- 1. Alterar channel_connectors
ALTER TABLE channel_connectors
  ADD COLUMN IF NOT EXISTS fb_page_id TEXT,
  ADD COLUMN IF NOT EXISTS fb_page_name TEXT,
  ADD COLUMN IF NOT EXISTS ig_user_id TEXT,
  ADD COLUMN IF NOT EXISTS ig_username TEXT,
  ADD COLUMN IF NOT EXISTS oauth_expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS webhook_subscribed BOOLEAN DEFAULT FALSE;

COMMENT ON COLUMN channel_connectors.fb_page_id IS 'ID da Página do Facebook conectada';
COMMENT ON COLUMN channel_connectors.fb_page_name IS 'Nome da Página para exibição';
COMMENT ON COLUMN channel_connectors.ig_user_id IS 'Instagram Business Account ID';
COMMENT ON COLUMN channel_connectors.ig_username IS 'Username do Instagram para exibição';
COMMENT ON COLUMN channel_connectors.oauth_expires_at IS 'Expiração do long-lived user token (Page token não expira)';
COMMENT ON COLUMN channel_connectors.webhook_subscribed IS 'Se o Webhook Meta já foi configurado para esta página';

-- 2. Alterar reviews
ALTER TABLE reviews
  ADD COLUMN IF NOT EXISTS sentiment_score FLOAT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS satisfaction_level TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS sentiment_summary TEXT DEFAULT NULL;

COMMENT ON COLUMN reviews.sentiment_score IS '0.0 (muito positivo) a 1.0 (muito negativo)';
COMMENT ON COLUMN reviews.satisfaction_level IS 'muito_negativo|negativo|neutro|positivo|muito_positivo';
COMMENT ON COLUMN reviews.sentiment_summary IS 'Resumo gerado pela IA em até 10 palavras';
