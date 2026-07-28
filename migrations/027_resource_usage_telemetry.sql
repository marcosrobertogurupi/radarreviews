-- ============================================================
-- MIGRATION 027: TELEMETRIA DE USO DE RECURSOS E FINOPS
-- Rastreamento de custos (Railway, Apify, Firecrawl, Gemini, Vercel)
-- ============================================================

-- 1. Tabela de logs detalhados de consumo por recurso
CREATE TABLE IF NOT EXISTS resource_usage_logs (
  id                  uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id           uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  connector_id        uuid REFERENCES channel_connectors(id) ON DELETE SET NULL,
  provider            text NOT NULL, -- 'railway' | 'apify' | 'firecrawl' | 'gemini' | 'vercel'
  metric_type         text NOT NULL, -- 'tokens' | 'executions' | 'requests' | 'cpu_ram_seconds'
  metric_quantity     numeric NOT NULL,
  estimated_cost_usd  numeric(10, 6) NOT NULL DEFAULT 0,
  metadata            jsonb DEFAULT '{}',
  created_at          timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE resource_usage_logs IS 'Registros granulares de telemetria e custo de consumo de recursos por assinante.';

-- Índices de consulta de telemetria
CREATE INDEX IF NOT EXISTS idx_resource_usage_tenant_date ON resource_usage_logs(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_resource_usage_provider ON resource_usage_logs(provider, created_at DESC);

-- 2. Tabela de limites de orçamento e alertas por tenant
CREATE TABLE IF NOT EXISTS tenant_budget_limits (
  id                  uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id           uuid UNIQUE NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  monthly_budget_usd  numeric(10, 2) NOT NULL DEFAULT 10.00,
  max_apify_monthly   integer NOT NULL DEFAULT 100,
  max_gemini_tokens   integer NOT NULL DEFAULT 500000,
  is_alert_active     boolean NOT NULL DEFAULT true,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE tenant_budget_limits IS 'Configurações de teto orçamentário e limites de uso por tenant.';

-- Habilitar RLS
ALTER TABLE resource_usage_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_budget_limits ENABLE ROW LEVEL SECURITY;

-- Políticas RLS para serviço (Service role tem acesso total)
DROP POLICY IF EXISTS "Service role full access resource_usage_logs" ON resource_usage_logs;
CREATE POLICY "Service role full access resource_usage_logs" ON resource_usage_logs
  FOR ALL USING (true);

DROP POLICY IF EXISTS "Service role full access tenant_budget_limits" ON tenant_budget_limits;
CREATE POLICY "Service role full access tenant_budget_limits" ON tenant_budget_limits
  FOR ALL USING (true);
