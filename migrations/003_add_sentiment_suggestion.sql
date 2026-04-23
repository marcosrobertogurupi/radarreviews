-- Migration: Add missing sentiment columns to reviews table
-- Executar no SQL Editor do Supabase

ALTER TABLE reviews 
  ADD COLUMN IF NOT EXISTS sentiment_suggestion TEXT;

-- Garantir que os índices existam para performance
CREATE INDEX IF NOT EXISTS reviews_sentiment_idx ON reviews (sentiment);
