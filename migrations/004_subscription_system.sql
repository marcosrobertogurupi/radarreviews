-- Migração 004: Sistema de Assinaturas (Asaas) e Parceiros
-- Adiciona suporte a trial, fidelidade e gestão de parceiros

-- 1. Evolução da tabela de Tenants (Assinantes)
ALTER TABLE tenants 
ADD COLUMN IF NOT EXISTS asaas_customer_id TEXT,
ADD COLUMN IF NOT EXISTS asaas_subscription_id TEXT,
ADD COLUMN IF NOT EXISTS subscription_status TEXT DEFAULT 'trial' CHECK (subscription_status IN ('trial', 'active', 'past_due', 'suspended', 'canceled')),
ADD COLUMN IF NOT EXISTS billing_method TEXT DEFAULT 'pix' CHECK (billing_method IN ('pix', 'credit_card')),
ADD COLUMN IF NOT EXISTS trial_ends_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS fidelity_months INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS fidelity_start_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS admin_whatsapp TEXT,
ADD COLUMN IF NOT EXISTS admin_email TEXT;

-- 2. Tabela de Parceiros (Agências e Vendedores)
CREATE TABLE IF NOT EXISTS partners (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('agency', 'vendedor')),
  tier TEXT DEFAULT 'bronze' CHECK (tier IN ('bronze', 'silver', 'gold')),
  pix_key TEXT,
  total_commission_earned DECIMAL(12,2) DEFAULT 0,
  balance_available DECIMAL(12,2) DEFAULT 0,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- 3. Tabela de Indicações (Referrals)
CREATE TABLE IF NOT EXISTS referrals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id UUID REFERENCES partners(id),
  tenant_id UUID REFERENCES tenants(id),
  status TEXT DEFAULT 'pending_trial' CHECK (status IN ('pending_trial', 'active', 'clawback', 'expired')),
  commission_rate_entry DECIMAL(5,2), -- % na entrada
  commission_rate_recurring DECIMAL(5,2), -- % na recorrência
  clawback_ends_at TIMESTAMPTZ, -- Fim do período de 90 dias
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 4. Tabela de Histórico de Comissões
CREATE TABLE IF NOT EXISTS commissions_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id UUID REFERENCES partners(id),
  referral_id UUID REFERENCES referrals(id),
  amount DECIMAL(12,2) NOT NULL,
  type TEXT CHECK (type IN ('entry', 'recurring', 'bonus')),
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'canceled')),
  paid_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Índices para performance
CREATE INDEX IF NOT EXISTS idx_tenants_asaas_customer ON tenants(asaas_customer_id);
CREATE INDEX IF NOT EXISTS idx_referrals_partner ON referrals(partner_id);
CREATE INDEX IF NOT EXISTS idx_referrals_tenant ON referrals(tenant_id);
