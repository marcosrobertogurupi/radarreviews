-- Migration 022: Benchmark Snapshots (F12-E5-T2)
-- Snapshots periódicos da posição do tenant e concorrentes para análise de tendência.

CREATE TABLE IF NOT EXISTS benchmark_snapshots (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  business_id     UUID        NOT NULL REFERENCES monitored_businesses(id) ON DELETE CASCADE,
  -- Dados do tenant neste snapshot
  avg_rating      NUMERIC(3,2),
  total_reviews   INTEGER     NOT NULL DEFAULT 0,
  response_rate   NUMERIC(5,2),  -- % reviews com resposta
  positive_rate   NUMERIC(5,2),  -- % reviews positivos
  -- Dados agregados dos concorrentes cadastrados (média do grupo)
  competitors_avg_rating   NUMERIC(3,2),
  competitors_avg_reviews  NUMERIC(10,2),
  competitor_count         INTEGER NOT NULL DEFAULT 0,
  -- Metadados
  snapshot_date   DATE        NOT NULL DEFAULT CURRENT_DATE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT benchmark_snapshots_biz_date_uq UNIQUE (business_id, snapshot_date)
);

COMMENT ON TABLE benchmark_snapshots IS 'Snapshots semanais da posição do tenant vs concorrentes. Permite análise de tendência de crescimento relativo.';

CREATE INDEX IF NOT EXISTS idx_benchmark_snapshots_tenant ON benchmark_snapshots(tenant_id, snapshot_date DESC);
CREATE INDEX IF NOT EXISTS idx_benchmark_snapshots_business ON benchmark_snapshots(business_id, snapshot_date DESC);

-- RLS
ALTER TABLE benchmark_snapshots ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "benchmark_snapshots_tenant_read" ON benchmark_snapshots;
CREATE POLICY "benchmark_snapshots_tenant_read" ON benchmark_snapshots
  FOR SELECT USING (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid);
