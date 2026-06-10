-- Migracao 017: Tabela de Planos e Beneficios
-- Cria as tabelas plans e plan_benefits (se nao existirem)
-- e insere/atualiza os dados iniciais dos planos do Reputei

-- 1. Tabela principal de planos
CREATE TABLE IF NOT EXISTS plans (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug           TEXT NOT NULL UNIQUE,
  name           TEXT NOT NULL,
  description    TEXT,
  price_monthly  DECIMAL(10,2) NOT NULL DEFAULT 0,
  max_channels   INTEGER NOT NULL DEFAULT 3,
  color          TEXT NOT NULL DEFAULT '#6b7280',
  is_active      BOOLEAN NOT NULL DEFAULT true,
  is_public      BOOLEAN NOT NULL DEFAULT true,
  is_popular     BOOLEAN NOT NULL DEFAULT false,
  sort_order     INTEGER NOT NULL DEFAULT 0,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2. Tabela de beneficios vinculados a cada plano
CREATE TABLE IF NOT EXISTS plan_benefits (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id      UUID NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
  description  TEXT NOT NULL,
  sort_order   INTEGER NOT NULL DEFAULT 0
);

-- 3. Indices
CREATE INDEX IF NOT EXISTS idx_plans_slug ON plans(slug);
CREATE INDEX IF NOT EXISTS idx_plan_benefits_plan ON plan_benefits(plan_id, sort_order);

-- 4. Trigger updated_at para plans
CREATE OR REPLACE FUNCTION update_plans_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_plans_updated_at ON plans;
CREATE TRIGGER trg_plans_updated_at
  BEFORE UPDATE ON plans
  FOR EACH ROW EXECUTE FUNCTION update_plans_updated_at();

-- 5. RLS
ALTER TABLE plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE plan_benefits ENABLE ROW LEVEL SECURITY;

-- Remove policies antigas se ja existirem (evita erro de duplicata)
DROP POLICY IF EXISTS "plans_public_read" ON plans;
DROP POLICY IF EXISTS "plan_benefits_public_read" ON plan_benefits;

-- Recria policies
CREATE POLICY "plans_public_read" ON plans
  FOR SELECT USING (is_active = true AND is_public = true);

CREATE POLICY "plan_benefits_public_read" ON plan_benefits
  FOR SELECT USING (
    plan_id IN (SELECT id FROM plans WHERE is_active = true AND is_public = true)
  );

-- ---------------------------------------------------------------
-- 6. Dados iniciais — 4 planos do Reputei (upsert seguro)
-- ---------------------------------------------------------------

INSERT INTO plans (slug, name, description, price_monthly, max_channels, color, is_active, is_public, is_popular, sort_order)
VALUES
  ('trial',      'Trial',       'Periodo de avaliacao gratuita de 7 dias.',  0.00,    3,   '#64748b', true, false, false, 0),
  ('basico',     'Basico',      'Para pequenos negocios locais.',           139.00,    3,   '#10b981', true, true,  false, 1),
  ('completo',   'Completo',    'Monitoramento total + IA.',                199.00,    8,   '#6366f1', true, true,  true,  2),
  ('custom',     'Custom',      'Flexibilidade para sua marca.',            149.00,    5,   '#f59e0b', true, true,  false, 3),
  ('enterprise', 'Enterprise',  'Escala e performance maxima.',           1500.00,  999,   '#ef4444', true, true,  false, 4)
ON CONFLICT (slug) DO UPDATE SET
  name          = EXCLUDED.name,
  description   = EXCLUDED.description,
  price_monthly = EXCLUDED.price_monthly,
  max_channels  = EXCLUDED.max_channels,
  color         = EXCLUDED.color,
  is_popular    = EXCLUDED.is_popular,
  sort_order    = EXCLUDED.sort_order,
  updated_at    = now();

-- ---------------------------------------------------------------
-- 7. Beneficios de cada plano (limpa e reinsere)
-- ---------------------------------------------------------------
DELETE FROM plan_benefits
WHERE plan_id IN (
  SELECT id FROM plans WHERE slug IN ('basico','completo','custom','enterprise')
);

-- Basico
INSERT INTO plan_benefits (plan_id, description, sort_order)
SELECT p.id, b.description, b.sort_order FROM plans p
CROSS JOIN (VALUES
  (1, '3 canais monitorados'),
  (2, '500 reviews/mes'),
  (3, 'Google Maps & TripAdvisor'),
  (4, 'Alertas por e-mail'),
  (5, 'Relatorios semanais'),
  (6, 'Suporte por e-mail')
) AS b(sort_order, description)
WHERE p.slug = 'basico';

-- Completo
INSERT INTO plan_benefits (plan_id, description, sort_order)
SELECT p.id, b.description, b.sort_order FROM plans p
CROSS JOIN (VALUES
  (1, '8 canais monitorados'),
  (2, 'Reviews ilimitados'),
  (3, 'Todos os canais disponiveis'),
  (4, 'IA Copilot incluso'),
  (5, 'Alertas via WhatsApp/SMS'),
  (6, 'Suporte prioritario')
) AS b(sort_order, description)
WHERE p.slug = 'completo';

-- Custom
INSERT INTO plan_benefits (plan_id, description, sort_order)
SELECT p.id, b.description, b.sort_order FROM plans p
CROSS JOIN (VALUES
  (1, 'Canais sob demanda'),
  (2, 'Reviews ilimitados'),
  (3, 'IA Copilot incluso'),
  (4, 'Relatorios personalizados'),
  (5, 'Multi-unidades'),
  (6, 'Gerente de conta')
) AS b(sort_order, description)
WHERE p.slug = 'custom';

-- Enterprise
INSERT INTO plan_benefits (plan_id, description, sort_order)
SELECT p.id, b.description, b.sort_order FROM plans p
CROSS JOIN (VALUES
  (1, 'Canais ilimitados'),
  (2, 'SLA garantido'),
  (3, 'Integracoes via API/Webhooks'),
  (4, 'Suporte 24/7 dedicado'),
  (5, 'Consultoria trimestral'),
  (6, 'Desconto por volume')
) AS b(sort_order, description)
WHERE p.slug = 'enterprise';
