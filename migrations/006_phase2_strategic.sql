-- Migração 006: Fase 2 — Features Estratégicas
-- Adiciona suporte a Resposta Direta, Benchmarking e Widgets

-- 1. Campos para controle de respostas enviadas
ALTER TABLE reviews
  ADD COLUMN IF NOT EXISTS responded_at TIMESTAMPTZ DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS response_text TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS responded_by TEXT DEFAULT NULL;

COMMENT ON COLUMN reviews.responded_at IS 'Data/hora em que a resposta foi publicada via Reputei.';
COMMENT ON COLUMN reviews.response_text IS 'Conteúdo da resposta enviada ao canal original.';

-- 2. Tabela de Concorrentes (Benchmarking)
CREATE TABLE IF NOT EXISTS competitor_businesses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID REFERENCES monitored_businesses(id) ON DELETE CASCADE,
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  place_id TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(business_id, place_id)
);

COMMENT ON TABLE competitor_businesses IS 'Empresas concorrentes cadastradas para comparação de performance.';

-- 3. Widget de Reviews para Site
ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS widget_token UUID DEFAULT gen_random_uuid(),
  ADD COLUMN IF NOT EXISTS widget_config JSONB DEFAULT '{ "theme": "light", "limit": 5, "show_score": true }';

CREATE INDEX IF NOT EXISTS idx_tenants_widget_token ON tenants(widget_token);

-- 4. Modo Agência
ALTER TABLE tenant_users
  ADD COLUMN IF NOT EXISTS managed_tenant_ids UUID[] DEFAULT NULL;

COMMENT ON COLUMN tenant_users.managed_tenant_ids IS 'Lista de IDs de tenants que este usuário agência pode gerenciar.';

-- 5. Índices Extras
CREATE INDEX IF NOT EXISTS idx_competitor_business ON competitor_businesses(business_id);
CREATE INDEX IF NOT EXISTS idx_reviews_responded ON reviews(responded_at) WHERE responded_at IS NOT NULL;
