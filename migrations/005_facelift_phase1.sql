-- Migração 005: Facelift do Dashboard (Fase 1)
-- Adiciona suporte a Temas de IA, Urgência de Alertas e Benchmarking

-- 1. Tabela para Cache de Temas Analisados pela IA
CREATE TABLE IF NOT EXISTS review_topics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID REFERENCES monitored_businesses(id) ON DELETE CASCADE,
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  topics JSONB NOT NULL, -- [{ "tema": "atendimento", "positivo": 10, "negativo": 2 }, ...]
  generated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(business_id, period_start, period_end)
);

COMMENT ON TABLE review_topics IS 'Armazena o agrupamento de temas recorrentes detectados pela IA.';

-- 2. Evolução da Tabela de Regras de Alerta (Urgência e Risco)
ALTER TABLE alert_rules
  ADD COLUMN IF NOT EXISTS urgency_level TEXT DEFAULT 'atencao' CHECK (urgency_level IN ('urgente', 'atencao', 'informativo')),
  ADD COLUMN IF NOT EXISTS risk_keywords TEXT[] DEFAULT ARRAY['PROCON','processo','advogado','IDEC','Juizado Especial','denúncia'],
  ADD COLUMN IF NOT EXISTS quiet_hours_start INT DEFAULT 22,
  ADD COLUMN IF NOT EXISTS quiet_hours_end INT DEFAULT 7;

COMMENT ON COLUMN alert_rules.urgency_level IS 'Classificação do alerta: urgente (imediato), atencao (resumo), informativo (painel).';
COMMENT ON COLUMN alert_rules.risk_keywords IS 'Palavras que disparam alerta URGENTE independente da nota.';

-- 3. Preparação para Benchmarking (Fase 2)
ALTER TABLE monitored_businesses
  ADD COLUMN IF NOT EXISTS is_competitor BOOLEAN DEFAULT false;

COMMENT ON COLUMN monitored_businesses.is_competitor IS 'Flag para identificar se a empresa é um concorrente monitorado.';

-- 4. Índices para Performance do Dashboard
CREATE INDEX IF NOT EXISTS idx_topics_business ON review_topics(business_id);
CREATE INDEX IF NOT EXISTS idx_reviews_tenant_published ON reviews(tenant_id, published_at DESC);
