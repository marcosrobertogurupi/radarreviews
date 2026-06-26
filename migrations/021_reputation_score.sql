-- Migration 021: Reputation Score Engine (F12-E8)
-- Adiciona has_response/responded_at em reviews (F12-E8-T2)
-- Cria tabelas reputation_scores e reputation_score_history (F12-E8-T3)

-- ── 1. Campos de taxa de resposta na tabela reviews ──────────────────────────
ALTER TABLE reviews
  ADD COLUMN IF NOT EXISTS has_response   BOOLEAN     NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS responded_at   TIMESTAMPTZ;

COMMENT ON COLUMN reviews.has_response IS 'Indica se o review recebeu resposta pública (manual ou automática).';
COMMENT ON COLUMN reviews.responded_at IS 'Timestamp da publicação da resposta.';

-- ── 2. Tabela reputation_scores ──────────────────────────────────────────────
-- Armazena o score consolidado mais recente por business/tenant
CREATE TABLE IF NOT EXISTS reputation_scores (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  business_id           UUID        NOT NULL REFERENCES monitored_businesses(id) ON DELETE CASCADE,
  score                 INTEGER     NOT NULL DEFAULT 0 CHECK (score >= 0 AND score <= 1000),
  -- Componentes individuais (0-100 cada, ponderados na fórmula)
  component_rating      NUMERIC(5,2) NOT NULL DEFAULT 0,  -- 30%: rating médio
  component_sentiment   NUMERIC(5,2) NOT NULL DEFAULT 0,  -- 20%: % reviews positivos
  component_volume      NUMERIC(5,2) NOT NULL DEFAULT 0,  -- 10%: volume normalizado
  component_response    NUMERIC(5,2) NOT NULL DEFAULT 0,  -- 10%: taxa de resposta
  component_reclame     NUMERIC(5,2) NOT NULL DEFAULT 0,  -- 10%: % resolvidos Reclame Aqui
  component_consumidor  NUMERIC(5,2) NOT NULL DEFAULT 0,  -- 10%: % resolvidos Consumidor.gov
  component_trend       NUMERIC(5,2) NOT NULL DEFAULT 0,  -- 10%: tendência 90 dias
  -- Metadata
  reviews_analyzed      INTEGER     NOT NULL DEFAULT 0,
  period_days           INTEGER     NOT NULL DEFAULT 90,
  calculated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT reputation_scores_business_uq UNIQUE (business_id)
);

COMMENT ON TABLE reputation_scores IS 'Score de reputação consolidado por empresa (0-1000). Recalculado periodicamente.';

-- ── 3. Tabela reputation_score_history ───────────────────────────────────────
-- Snapshots históricos para calcular tendência
CREATE TABLE IF NOT EXISTS reputation_score_history (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  business_id   UUID        NOT NULL REFERENCES monitored_businesses(id) ON DELETE CASCADE,
  score         INTEGER     NOT NULL CHECK (score >= 0 AND score <= 1000),
  snapshot_date DATE        NOT NULL DEFAULT CURRENT_DATE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT reputation_score_history_biz_date_uq UNIQUE (business_id, snapshot_date)
);

COMMENT ON TABLE reputation_score_history IS 'Histórico diário de snapshots do Reputation Score para análise de tendência.';

-- ── 4. Índices ────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_reputation_scores_tenant ON reputation_scores(tenant_id);
CREATE INDEX IF NOT EXISTS idx_reputation_scores_business ON reputation_scores(business_id);
CREATE INDEX IF NOT EXISTS idx_reputation_score_history_biz ON reputation_score_history(business_id, snapshot_date DESC);
CREATE INDEX IF NOT EXISTS idx_reviews_has_response ON reviews(tenant_id, has_response);

-- ── 5. Trigger updated_at ─────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION update_reputation_scores_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_reputation_scores_updated_at ON reputation_scores;
CREATE TRIGGER trg_reputation_scores_updated_at
  BEFORE UPDATE ON reputation_scores
  FOR EACH ROW EXECUTE FUNCTION update_reputation_scores_updated_at();

-- ── 6. RLS ────────────────────────────────────────────────────────────────────
ALTER TABLE reputation_scores ENABLE ROW LEVEL SECURITY;
ALTER TABLE reputation_score_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "reputation_scores_tenant_read" ON reputation_scores;
DROP POLICY IF EXISTS "reputation_score_history_tenant_read" ON reputation_score_history;

-- Tenant lê somente seus próprios dados via anon key + RLS
CREATE POLICY "reputation_scores_tenant_read" ON reputation_scores
  FOR SELECT USING (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid);

CREATE POLICY "reputation_score_history_tenant_read" ON reputation_score_history
  FOR SELECT USING (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid);
