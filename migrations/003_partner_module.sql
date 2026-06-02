-- ============================================================
-- REPUTEI — MÓDULO DE PARCEIROS (PARTNER PORTAL)
-- Phase 1: Database Schema
-- ============================================================

-- ------------------------------------------------------------
-- FIX DE PERMISSÕES DO SUPABASE (Garante que o painel consiga rodar)
-- ------------------------------------------------------------
GRANT ALL ON SCHEMA public TO postgres;
GRANT ALL ON SCHEMA public TO authenticated;
GRANT ALL ON SCHEMA public TO service_role;

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
  id uuid PRIMARY KEY DEFAULT gen_random_uuid()
);

-- Adicionamos as colunas com ALTER TABLE IF NOT EXISTS para o caso da tabela já ter sido criada parcialmente antes
ALTER TABLE partners ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE partners ADD COLUMN IF NOT EXISTS name text;
ALTER TABLE partners ADD COLUMN IF NOT EXISTS email text;
ALTER TABLE partners ADD COLUMN IF NOT EXISTS phone text;
ALTER TABLE partners ADD COLUMN IF NOT EXISTS company_name text;
ALTER TABLE partners ADD COLUMN IF NOT EXISTS partner_type partner_type DEFAULT 'agency';
ALTER TABLE partners ADD COLUMN IF NOT EXISTS commission_setup_rate numeric(5,2) DEFAULT 20.00 CHECK (commission_setup_rate >= 0 AND commission_setup_rate <= 100);
ALTER TABLE partners ADD COLUMN IF NOT EXISTS commission_recurring_rate numeric(5,2) DEFAULT 10.00 CHECK (commission_recurring_rate >= 0 AND commission_recurring_rate <= 100);
ALTER TABLE partners ADD COLUMN IF NOT EXISTS status partner_status DEFAULT 'active';
ALTER TABLE partners ADD COLUMN IF NOT EXISTS notes text;
ALTER TABLE partners ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now();
ALTER TABLE partners ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();

DO $$ BEGIN
  ALTER TABLE partners ADD CONSTRAINT partners_user_id_uq UNIQUE (user_id);
EXCEPTION WHEN others THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE partners ADD CONSTRAINT partners_email_uq UNIQUE (email);
EXCEPTION WHEN others THEN null; END $$;

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
  id uuid PRIMARY KEY DEFAULT gen_random_uuid()
);

ALTER TABLE commissions ADD COLUMN IF NOT EXISTS partner_id uuid REFERENCES partners(id) ON DELETE CASCADE;
ALTER TABLE commissions ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES tenants(id) ON DELETE CASCADE;
ALTER TABLE commissions ADD COLUMN IF NOT EXISTS reference_month date;
ALTER TABLE commissions ADD COLUMN IF NOT EXISTS plan_name text;
ALTER TABLE commissions ADD COLUMN IF NOT EXISTS plan_value numeric(10,2);
ALTER TABLE commissions ADD COLUMN IF NOT EXISTS is_setup boolean DEFAULT false;
ALTER TABLE commissions ADD COLUMN IF NOT EXISTS commission_rate numeric(5,2);
ALTER TABLE commissions ADD COLUMN IF NOT EXISTS commission_value numeric(10,2) GENERATED ALWAYS AS (plan_value * commission_rate / 100) STORED;
ALTER TABLE commissions ADD COLUMN IF NOT EXISTS status commission_status DEFAULT 'pending';
ALTER TABLE commissions ADD COLUMN IF NOT EXISTS approved_at timestamptz;
ALTER TABLE commissions ADD COLUMN IF NOT EXISTS paid_at timestamptz;
ALTER TABLE commissions ADD COLUMN IF NOT EXISTS notes text;
ALTER TABLE commissions ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now();
ALTER TABLE commissions ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();

DO $$ BEGIN
  ALTER TABLE commissions ADD CONSTRAINT commissions_uq UNIQUE (partner_id, tenant_id, reference_month, is_setup);
EXCEPTION WHEN others THEN null; END $$;

COMMENT ON COLUMN commissions.reference_month IS 'Primeiro dia do mês de referência (ex: 2024-04-01)';

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
