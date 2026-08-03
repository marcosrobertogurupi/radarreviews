-- Migration 003: Módulo de Prospecção & Enriquecimento Kipflow
-- Data: 2026-08-03

CREATE TABLE IF NOT EXISTS prospect_companies (
  id                  uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id           uuid REFERENCES tenants(id) ON DELETE CASCADE, -- NULL se for prospect global do admin
  name                text NOT NULL,
  cnpj                text,
  domain              text,
  trade_name          text,
  segment             text,
  size                text,
  estimated_revenue   text,
  city                text,
  state               text,
  phone               text,
  email               text,
  website_url         text,
  linkedin_url        text,
  status              text NOT NULL DEFAULT 'new', -- new | enriched | contacted | qualified | converted | rejected
  is_enriched         boolean NOT NULL DEFAULT false,
  enriched_at         timestamptz,
  icp_score           numeric(3,1) DEFAULT 0.0, -- 0-10
  ai_analysis         jsonb DEFAULT '{}',
  raw_kipflow_data    jsonb DEFAULT '{}',
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE prospect_companies IS 'Empresas alvo para prospecção no painel Admin / CRM de Vendas.';

CREATE TABLE IF NOT EXISTS prospect_decidors (
  id                  uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  prospect_company_id uuid NOT NULL REFERENCES prospect_companies(id) ON DELETE CASCADE,
  name                text NOT NULL,
  role                text,
  department          text,
  linkedin_url        text,
  linkedin_id         text,
  email               text,
  is_email_verified   boolean DEFAULT false,
  phone               text,
  mobile_phone        text,
  ai_approach_script  text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE prospect_decidors IS 'Decisores e contatos chave identificados para cada prospect.';

CREATE TABLE IF NOT EXISTS prospect_enrichment_logs (
  id                  uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  prospect_company_id uuid NOT NULL REFERENCES prospect_companies(id) ON DELETE CASCADE,
  status              text NOT NULL, -- success | error | partial
  source              text NOT NULL DEFAULT 'kipflow',
  details             jsonb DEFAULT '{}',
  error_message       text,
  created_at          timestamptz NOT NULL DEFAULT now()
);

-- Índices para otimização de busca
CREATE INDEX IF NOT EXISTS idx_prospect_companies_cnpj ON prospect_companies(cnpj);
CREATE INDEX IF NOT EXISTS idx_prospect_companies_domain ON prospect_companies(domain);
CREATE INDEX IF NOT EXISTS idx_prospect_companies_status ON prospect_companies(status);
CREATE INDEX IF NOT EXISTS idx_prospect_decidors_company ON prospect_decidors(prospect_company_id);
