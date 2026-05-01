-- ─────────────────────────────────────────────────────────────────
-- Migração: tabelas plans e plan_benefits
-- Executar no SQL Editor do Supabase
-- ─────────────────────────────────────────────────────────────────

-- 1. Tabela principal de planos
CREATE TABLE IF NOT EXISTS plans (
  id            UUID          DEFAULT gen_random_uuid() PRIMARY KEY,
  slug          TEXT          UNIQUE NOT NULL,
  name          TEXT          NOT NULL,
  description   TEXT,
  price_monthly NUMERIC(10,2) NOT NULL DEFAULT 0,
  max_channels  INTEGER       NOT NULL DEFAULT 3,
  color         TEXT          NOT NULL DEFAULT '#6b7280',
  is_active     BOOLEAN       NOT NULL DEFAULT true,
  is_public     BOOLEAN       NOT NULL DEFAULT true,
  is_popular    BOOLEAN       NOT NULL DEFAULT false,
  sort_order    INTEGER       NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ   DEFAULT NOW()
);

-- 2. Tabela de benefícios (1 linha por benefício)
CREATE TABLE IF NOT EXISTS plan_benefits (
  id          UUID    DEFAULT gen_random_uuid() PRIMARY KEY,
  plan_id     UUID    NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
  description TEXT    NOT NULL,
  sort_order  INTEGER NOT NULL DEFAULT 0
);

-- 3. RLS — leitura pública, escrita via service_role (API)
ALTER TABLE plans         ENABLE ROW LEVEL SECURITY;
ALTER TABLE plan_benefits ENABLE ROW LEVEL SECURITY;

CREATE POLICY "plans_public_read"         ON plans         FOR SELECT USING (true);
CREATE POLICY "plan_benefits_public_read" ON plan_benefits FOR SELECT USING (true);

-- 4. Seed dos planos base
INSERT INTO plans (slug, name, price_monthly, max_channels, color, is_public, is_popular, sort_order) VALUES
  ('trial',      'Trial',      0,    3,  '#6b7280', false, false, 0),
  ('basico',     'Básico',     139,  3,  '#06b6d4', true,  false, 1),
  ('completo',   'Completo',   199,  8,  '#6366f1', true,  true,  2),
  ('enterprise', 'Enterprise', 1500, 99, '#f59e0b', true,  false, 3)
ON CONFLICT (slug) DO NOTHING;

-- 5. Benefícios — Básico
INSERT INTO plan_benefits (plan_id, description, sort_order)
SELECT p.id, b.desc_text, b.ord
FROM plans p, (VALUES
  (1, '3 canais monitorados'),
  (2, '500 reviews/mês'),
  (3, 'Alertas por e-mail'),
  (4, 'Relatórios semanais')
) AS b(ord, desc_text)
WHERE p.slug = 'basico';

-- 6. Benefícios — Completo
INSERT INTO plan_benefits (plan_id, description, sort_order)
SELECT p.id, b.desc_text, b.ord
FROM plans p, (VALUES
  (1, '8 canais monitorados'),
  (2, 'Reviews ilimitados'),
  (3, 'IA Copilot'),
  (4, 'Alertas avançados (WhatsApp)')
) AS b(ord, desc_text)
WHERE p.slug = 'completo';

-- 7. Benefícios — Enterprise
INSERT INTO plan_benefits (plan_id, description, sort_order)
SELECT p.id, b.desc_text, b.ord
FROM plans p, (VALUES
  (1, 'Canais ilimitados'),
  (2, 'Reviews ilimitados'),
  (3, 'IA Copilot + Suporte dedicado'),
  (4, 'Alertas avançados (WhatsApp)'),
  (5, 'API de integração personalizada')
) AS b(ord, desc_text)
WHERE p.slug = 'enterprise';

