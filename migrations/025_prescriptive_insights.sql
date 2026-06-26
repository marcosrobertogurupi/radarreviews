-- Migration 025: Prescriptive Insights (F12-E7)
-- Cria tabela prescriptive_insights para armazenar recomendações prescritivas geradas pela IA

CREATE TABLE IF NOT EXISTS prescriptive_insights (
  id                  UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID          NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  business_id         UUID          REFERENCES monitored_businesses(id) ON DELETE CASCADE,
  title               TEXT          NOT NULL,
  description         TEXT          NOT NULL,
  action_plan         TEXT          NOT NULL,
  confidence_score    INTEGER       NOT NULL DEFAULT 100 CHECK (confidence_score >= 0 AND confidence_score <= 100),
  status              TEXT          NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'implemented', 'ignored')),
  impact_measured     BOOLEAN       NOT NULL DEFAULT false,
  metadata            JSONB         NOT NULL DEFAULT '{}',
  created_at          TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ   NOT NULL DEFAULT now()
);

COMMENT ON TABLE prescriptive_insights IS 'Recomendações prescritivas acionáveis geradas pela IA por rede/unidade.';

-- Índices para melhorar a performance das consultas de leitura do portal
CREATE INDEX IF NOT EXISTS idx_prescriptive_insights_tenant ON prescriptive_insights(tenant_id);
CREATE INDEX IF NOT EXISTS idx_prescriptive_insights_business ON prescriptive_insights(business_id);

-- Trigger de updated_at
CREATE OR REPLACE FUNCTION update_prescriptive_insights_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_prescriptive_insights_updated_at ON prescriptive_insights;
CREATE TRIGGER trg_prescriptive_insights_updated_at
  BEFORE UPDATE ON prescriptive_insights
  FOR EACH ROW EXECUTE FUNCTION update_prescriptive_insights_updated_at();

-- Habilitar RLS e criar políticas para leitura e atualização no portal
ALTER TABLE prescriptive_insights ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "prescriptive_insights_tenant_read" ON prescriptive_insights;
DROP POLICY IF EXISTS "prescriptive_insights_tenant_write" ON prescriptive_insights;

-- O assinante só lê os insights do próprio tenant
CREATE POLICY "prescriptive_insights_tenant_read" ON prescriptive_insights
  FOR SELECT USING (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid);

-- O assinante pode atualizar status (ex.: marcar como 'implemented' ou 'ignored')
CREATE POLICY "prescriptive_insights_tenant_write" ON prescriptive_insights
  FOR UPDATE USING (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid)
  WITH CHECK (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid);
