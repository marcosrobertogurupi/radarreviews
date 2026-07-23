-- Migration 033: Cotas de IA e logs de uso por tenant

-- 1. Novos campos na tabela tenants
ALTER TABLE tenants 
  ADD COLUMN IF NOT EXISTS ai_quota_limit integer NOT NULL DEFAULT 500000,
  ADD COLUMN IF NOT EXISTS ai_quota_used integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS ai_blocked boolean NOT NULL DEFAULT false;

-- 2. Tabela de logs de uso de IA por tenant
CREATE TABLE IF NOT EXISTS tenant_ai_usage_logs (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  request_type text NOT NULL, -- 'sentiment', 'copilot', 'support_triage', 'prescriptive'
  model_used text NOT NULL,   -- 'gemini-2.5-flash', 'claude-3-5-haiku-20241022', etc.
  prompt_tokens integer NOT NULL DEFAULT 0,
  completion_tokens integer NOT NULL DEFAULT 0,
  estimated_cost_usd numeric(10,6) NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tenant_ai_usage_tenant_id ON tenant_ai_usage_logs(tenant_id);
CREATE INDEX IF NOT EXISTS idx_tenant_ai_usage_created_at ON tenant_ai_usage_logs(created_at DESC);

-- RLS
ALTER TABLE tenant_ai_usage_logs ENABLE ROW LEVEL SECURITY;

DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE policyname = 'tenant_isolation_ai_usage' AND tablename = 'tenant_ai_usage_logs'
  ) THEN
    CREATE POLICY "tenant_isolation_ai_usage" ON tenant_ai_usage_logs
      FOR ALL USING (tenant_id = auth_tenant_id());
  END IF;
END $$;
