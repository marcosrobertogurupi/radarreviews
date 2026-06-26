-- ============================================================
-- MÓDULO DE PARCEIROS — ATUALIZAÇÃO DE TIER, PIX E IMPERSONATION
-- ============================================================

-- 1. Adicionar colunas tier e pix_key na tabela partners
ALTER TABLE partners ADD COLUMN IF NOT EXISTS tier TEXT DEFAULT 'bronze' CHECK (tier IN ('bronze', 'silver', 'gold'));
ALTER TABLE partners ADD COLUMN IF NOT EXISTS pix_key TEXT;

-- 2. Tabela de Sessões de Impersonação (SSO Seguro)
CREATE TABLE IF NOT EXISTS partner_impersonation_sessions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id  UUID NOT NULL REFERENCES partners(id) ON DELETE CASCADE,
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  token       TEXT NOT NULL UNIQUE,
  expires_at  TIMESTAMPTZ NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by  UUID REFERENCES auth.users(id) ON DELETE SET NULL
);

-- 3. Habilitar RLS e Policies para partner_impersonation_sessions
ALTER TABLE partner_impersonation_sessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "impersonation_select_own" ON partner_impersonation_sessions;
CREATE POLICY "impersonation_select_own" ON partner_impersonation_sessions
  FOR SELECT USING (created_by = auth.uid());

DROP POLICY IF EXISTS "impersonation_insert_own" ON partner_impersonation_sessions;
CREATE POLICY "impersonation_insert_own" ON partner_impersonation_sessions
  FOR INSERT WITH CHECK (created_by = auth.uid());
