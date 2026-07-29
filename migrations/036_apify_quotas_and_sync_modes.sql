-- Migration 036: Cotas de Apify, Modos de Sync e Tipos de Job para Coleta Sustentável

-- 1. Tabela de Cotas por Tenant e Canal
CREATE TABLE IF NOT EXISTS tenant_scrape_quotas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  channel TEXT NOT NULL,
  plan_slug TEXT NOT NULL DEFAULT 'basico',
  monthly_review_budget INTEGER NOT NULL DEFAULT 1000,
  consumed_this_cycle INTEGER NOT NULL DEFAULT 0,
  cycle_reset_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '30 days'),
  hard_cap BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(tenant_id, channel)
);

CREATE INDEX IF NOT EXISTS idx_tenant_scrape_quotas_tenant ON tenant_scrape_quotas(tenant_id);

-- RLS para tenant_scrape_quotas
ALTER TABLE tenant_scrape_quotas ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenants podem visualizar suas proprias cotas"
  ON tenant_scrape_quotas FOR SELECT
  USING (tenant_id = auth.uid());

CREATE POLICY "Service role tem acesso total a tenant_scrape_quotas"
  ON tenant_scrape_quotas FOR ALL
  USING (true)
  WITH CHECK (true);

-- 2. Adicionar sync_mode em channel_connectors se não existir
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'channel_connectors' AND column_name = 'sync_mode'
  ) THEN
    ALTER TABLE channel_connectors 
    ADD COLUMN sync_mode TEXT CHECK (sync_mode IN ('oauth_api', 'scrape')) DEFAULT 'scrape';
  END IF;
END $$;

-- 3. Adicionar campos de controle e auditoria de custo em sync_jobs
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'sync_jobs' AND column_name = 'job_type'
  ) THEN
    ALTER TABLE sync_jobs 
    ADD COLUMN job_type TEXT CHECK (job_type IN ('backfill', 'incremental')) NOT NULL DEFAULT 'incremental';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'sync_jobs' AND column_name = 'estimated_cost_usd'
  ) THEN
    ALTER TABLE sync_jobs ADD COLUMN estimated_cost_usd NUMERIC(10, 4);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'sync_jobs' AND column_name = 'actual_cost_usd'
  ) THEN
    ALTER TABLE sync_jobs ADD COLUMN actual_cost_usd NUMERIC(10, 4);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'sync_jobs' AND column_name = 'skip_reason'
  ) THEN
    ALTER TABLE sync_jobs ADD COLUMN skip_reason TEXT;
  END IF;
END $$;
