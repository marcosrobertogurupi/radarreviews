-- Migration 023: Review Funnel (F12-E3-T3)
-- Funil de geração de reviews via QR code / link curto / landing de triagem.
-- Clientes insatisfeitos → ticket privado (nunca vão para review público).
-- Clientes satisfeitos → redirecionados para link de review público.

-- ── 1. Campanhas de review ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS review_campaigns (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  business_id   UUID        NOT NULL REFERENCES monitored_businesses(id) ON DELETE CASCADE,
  name          TEXT        NOT NULL,
  status        TEXT        NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'archived')),
  -- URL pública de review (Google, TripAdvisor, etc.)
  review_url    TEXT        NOT NULL,
  -- Personalização da landing
  landing_title TEXT        NOT NULL DEFAULT 'Como foi sua experiência?',
  landing_logo_url TEXT,
  -- Limiar: nota >= threshold → positivo → redireciona para review_url
  satisfaction_threshold INTEGER NOT NULL DEFAULT 4 CHECK (satisfaction_threshold BETWEEN 1 AND 5),
  -- Configuração de ticket para insatisfeitos
  create_ticket_on_negative BOOLEAN NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE review_campaigns IS 'Campanhas de ativação de reviews com triagem de satisfação (F12-E3-T3).';

-- ── 2. QR codes / links curtos ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS review_qr_codes (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  campaign_id   UUID        NOT NULL REFERENCES review_campaigns(id) ON DELETE CASCADE,
  short_code    TEXT        NOT NULL UNIQUE,  -- slug da URL curta (ex: "xA3b")
  label         TEXT,                         -- rótulo interno (ex: "Caixa 1", "Mesa 5")
  scans         INTEGER     NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE review_qr_codes IS 'QR codes e links curtos vinculados a campanhas de review.';
CREATE INDEX IF NOT EXISTS idx_review_qr_codes_short_code ON review_qr_codes(short_code);

-- ── 3. Respostas da landing de triagem ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS review_requests (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  campaign_id     UUID        NOT NULL REFERENCES review_campaigns(id) ON DELETE CASCADE,
  qr_code_id      UUID        REFERENCES review_qr_codes(id),
  -- Resultado da triagem
  satisfaction    INTEGER     CHECK (satisfaction BETWEEN 1 AND 5),
  outcome         TEXT        CHECK (outcome IN ('redirected_to_review', 'ticket_created', 'abandoned')),
  -- Se gerou ticket
  ticket_id       UUID,       -- FK lógica para support_tickets (sem FK hard para evitar acoplamento)
  -- Rastreabilidade (sem PII — apenas IP anonimizado e user-agent)
  ip_hash         TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE review_requests IS 'Registro de cada passagem pelo funil de triagem de reviews.';
CREATE INDEX IF NOT EXISTS idx_review_requests_campaign ON review_requests(campaign_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_review_requests_tenant ON review_requests(tenant_id, created_at DESC);

-- ── 4. RLS ────────────────────────────────────────────────────────────────────
ALTER TABLE review_campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE review_qr_codes  ENABLE ROW LEVEL SECURITY;
ALTER TABLE review_requests  ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "review_campaigns_tenant" ON review_campaigns;
DROP POLICY IF EXISTS "review_qr_codes_tenant"  ON review_qr_codes;
DROP POLICY IF EXISTS "review_requests_tenant"  ON review_requests;

CREATE POLICY "review_campaigns_tenant" ON review_campaigns
  FOR ALL USING (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid);

CREATE POLICY "review_qr_codes_tenant" ON review_qr_codes
  FOR ALL USING (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid);

CREATE POLICY "review_requests_tenant" ON review_requests
  FOR SELECT USING (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid);

-- ── 5. Trigger updated_at em review_campaigns ─────────────────────────────────
CREATE OR REPLACE FUNCTION update_review_campaigns_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

DROP TRIGGER IF EXISTS trg_review_campaigns_updated_at ON review_campaigns;
CREATE TRIGGER trg_review_campaigns_updated_at
  BEFORE UPDATE ON review_campaigns
  FOR EACH ROW EXECUTE FUNCTION update_review_campaigns_updated_at();
