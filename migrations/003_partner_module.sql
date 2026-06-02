-- ============================================================
-- REPUTEI — MÓDULO DE PARCEIROS (PARTNER PORTAL)
-- Phase 1: Database Schema
-- ============================================================

-- ------------------------------------------------------------
-- 1. ENUMS
-- ------------------------------------------------------------
DO $$ BEGIN
  CREATE TYPE partner_status AS ENUM ('active', 'inactive', 'suspended');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE partner_type AS ENUM ('agency', 'consultant', 'sales_rep');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE commission_status AS ENUM ('pending', 'approved', 'paid', 'cancelled');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- ------------------------------------------------------------
-- 2. PARTNERS TABLE
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS partners (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                   uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name                      text NOT NULL,
  email                     text NOT NULL UNIQUE,
  phone                     text,
  company_name              text,
  partner_type              partner_type NOT NULL DEFAULT 'agency',
  commission_setup_rate     numeric(5,2) NOT NULL DEFAULT 20.00 CHECK (commission_setup_rate >= 0 AND commission_setup_rate <= 100),
  commission_recurring_rate numeric(5,2) NOT NULL DEFAULT 10.00 CHECK (commission_recurring_rate >= 0 AND commission_recurring_rate <= 100),
  status                    partner_status NOT NULL DEFAULT 'active',
  notes                     text,
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now(),
  
  CONSTRAINT partners_user_id_uq UNIQUE (user_id)
);

ALTER TABLE partners ENABLE ROW LEVEL SECURITY;

-- Parceiro vê apenas o próprio perfil
DO $$ BEGIN
  CREATE POLICY "partner_select_own" ON partners FOR SELECT
    USING (user_id = auth.uid());
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- Apenas admin (service_role) pode inserir/atualizar/deletar
DO $$ BEGIN
  CREATE POLICY "partner_admin_all" ON partners FOR ALL
    USING (auth.role() = 'service_role');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- ------------------------------------------------------------
-- 3. ALTER TENANTS TABLE
-- ------------------------------------------------------------
ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS partner_id uuid REFERENCES partners(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS partner_commission_locked boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_tenants_partner_id ON tenants(partner_id);

-- ------------------------------------------------------------
-- 4. COMMISSIONS TABLE
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS commissions (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id       uuid NOT NULL REFERENCES partners(id) ON DELETE CASCADE,
  tenant_id        uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  reference_month  date NOT NULL COMMENT 'Primeiro dia do mês de referência (ex: 2024-04-01)',
  plan_name        text NOT NULL,
  plan_value       numeric(10,2) NOT NULL,
  is_setup         boolean NOT NULL DEFAULT false,
  commission_rate  numeric(5,2) NOT NULL,
  commission_value numeric(10,2) GENERATED ALWAYS AS (plan_value * commission_rate / 100) STORED,
  status           commission_status NOT NULL DEFAULT 'pending',
  approved_at      timestamptz,
  paid_at          timestamptz,
  notes            text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT commissions_uq UNIQUE (partner_id, tenant_id, reference_month, is_setup)
);

ALTER TABLE commissions ENABLE ROW LEVEL SECURITY;

-- Parceiro vê apenas as próprias comissões
DO $$ BEGIN
  CREATE POLICY "commission_select_own" ON commissions FOR SELECT
    USING (
      partner_id IN (
        SELECT id FROM partners WHERE user_id = auth.uid()
      )
    );
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- Apenas service_role gerencia comissões
DO $$ BEGIN
  CREATE POLICY "commission_admin_all" ON commissions FOR ALL
    USING (auth.role() = 'service_role');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- ------------------------------------------------------------
-- 5. PARTNER DASHBOARD VIEW
-- ------------------------------------------------------------
CREATE OR REPLACE VIEW partner_dashboard_summary AS
SELECT
  p.id                                      AS partner_id,
  p.user_id,
  p.name                                    AS partner_name,
  p.partner_type,
  p.commission_setup_rate,
  p.commission_recurring_rate,
  COUNT(DISTINCT t.id)                      AS total_clients,
  COUNT(DISTINCT t.id) FILTER (
    WHERE t.is_active = true
  )                                         AS active_clients,
  COUNT(DISTINCT t.id) FILTER (
    WHERE t.plan = 'free' OR t.plan = 'starter'
  )                                         AS trial_clients,
  COALESCE(SUM(c.plan_value)
    FILTER (WHERE c.reference_month = date_trunc('month', now())::date
      AND c.status != 'cancelled' AND c.is_setup = false), 0)      AS current_month_mrr,
  COALESCE(SUM(c.commission_value)
    FILTER (WHERE c.status = 'pending'), 0) AS pending_commission,
  COALESCE(SUM(c.commission_value)
    FILTER (WHERE c.status = 'approved'), 0) AS approved_commission,
  COALESCE(SUM(c.commission_value)
    FILTER (WHERE c.status = 'paid'), 0)    AS total_paid_commission
FROM partners p
LEFT JOIN tenants t ON t.partner_id = p.id
LEFT JOIN commissions c ON c.partner_id = p.id
GROUP BY p.id, p.user_id, p.name, p.partner_type, p.commission_setup_rate, p.commission_recurring_rate;

ALTER VIEW partner_dashboard_summary OWNER TO authenticated;

-- ------------------------------------------------------------
-- 6. RPC: PARTNER_REGISTER_TENANT
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION partner_register_tenant(
  p_partner_id     uuid,
  p_business_name  text,
  p_email          text,
  p_phone          text DEFAULT NULL,
  p_plan_slug      text DEFAULT 'starter'
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_tenant_id uuid;
  v_partner_user_id uuid;
  v_slug text;
BEGIN
  -- Validar que o parceiro existe e está ativo
  SELECT user_id INTO v_partner_user_id
    FROM partners
   WHERE id = p_partner_id AND status = 'active';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Parceiro inativo ou inexistente: %', p_partner_id;
  END IF;

  -- Validar que o chamador é o próprio parceiro
  IF v_partner_user_id != auth.uid() THEN
    RAISE EXCEPTION 'Acesso negado: parceiro não corresponde ao usuário autenticado';
  END IF;

  -- Generate slug from business name
  v_slug := lower(regexp_replace(p_business_name, '[^a-zA-Z0-9]+', '-', 'g'));

  -- Criar o tenant vinculado
  INSERT INTO tenants (
    name, slug, plan, is_active, partner_id, created_at
  )
  VALUES (
    p_business_name, v_slug, p_plan_slug, true, p_partner_id, now()
  )
  RETURNING id INTO v_tenant_id;

  RETURN v_tenant_id;
END;
$$;

-- ------------------------------------------------------------
-- 7. TRIGGERS UPDATED_AT
-- ------------------------------------------------------------
DO $$ BEGIN
  CREATE TRIGGER trg_partners_updated_at
    BEFORE UPDATE ON partners
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TRIGGER trg_commissions_updated_at
    BEFORE UPDATE ON commissions
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
