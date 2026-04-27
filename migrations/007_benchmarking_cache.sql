-- Migração 007: Cache de Estatísticas de Benchmarking
ALTER TABLE competitor_businesses
  ADD COLUMN IF NOT EXISTS last_stats JSONB DEFAULT NULL;

COMMENT ON COLUMN competitor_businesses.last_stats IS 'Cache das últimas estatísticas coletadas (rating, review_count, updated_at).';
