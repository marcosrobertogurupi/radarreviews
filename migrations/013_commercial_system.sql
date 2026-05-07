-- Migration 013: Área Comercial e Funil de Reputação Polimórfica

-- 1. Adicionar data de controle temporal nas campanhas de prospecção outbound
ALTER TABLE public.prospect_campaigns
  ADD COLUMN IF NOT EXISTS campaign_date DATE DEFAULT CURRENT_DATE;

COMMENT ON COLUMN public.prospect_campaigns.campaign_date
  IS 'Data de referência da campanha para controle temporal dos disparos outbound';

-- 2. Criar os ENUMs necessários para os scores comerciais
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'commercial_channel_type') THEN
    CREATE TYPE commercial_channel_type AS ENUM (
      'google_maps',
      'reclame_aqui',
      'consumidor_gov',
      'tripadvisor',
      'booking',
      'ifood',
      'anatel',
      'ans',
      'outro'
    );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'commercial_target_type') THEN
    CREATE TYPE commercial_target_type AS ENUM ('company', 'branch');
  END IF;
END$$;

-- 3. Criar a tabela polimórfica de scores de reputação
CREATE TABLE IF NOT EXISTS public.commercial_channel_scores (
  id                 UUID                        PRIMARY KEY DEFAULT gen_random_uuid(),
  target_type        commercial_target_type      NOT NULL,
  target_id          UUID                        NOT NULL,
  channel            commercial_channel_type     NOT NULL,
  score              NUMERIC(4,2),
  score_max          NUMERIC(4,2)                NOT NULL DEFAULT 5.0,
  reputation_label   TEXT,
  review_highlight   TEXT,
  review_sentiment   TEXT                        CHECK (review_sentiment IN ('positive','negative','neutral')),
  source_url         TEXT,
  collected_at       DATE                        DEFAULT CURRENT_DATE,
  created_at         TIMESTAMPTZ                 NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ                 NOT NULL DEFAULT NOW(),

  CONSTRAINT uq_target_channel UNIQUE (target_type, target_id, channel)
);

COMMENT ON TABLE  public.commercial_channel_scores IS 'Notas por canal de reputação. Polimórfico: target_type+target_id aponta para company ou branch.';
COMMENT ON COLUMN public.commercial_channel_scores.score_max IS 'Teto da escala do canal (5.0 para Google Maps, 10.0 para Reclame Aqui). Permite normalização.';

-- 4. Criar trigger de updated_at para a tabela de scores
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS trg_commercial_channel_scores_updated_at ON public.commercial_channel_scores;
CREATE TRIGGER trg_commercial_channel_scores_updated_at
  BEFORE UPDATE ON public.commercial_channel_scores
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- 5. Configurar Row Level Security (RLS) e Políticas
ALTER TABLE public.commercial_channel_scores ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admin_Full_Access_CommercialScores" ON public.commercial_channel_scores;
CREATE POLICY "Admin_Full_Access_CommercialScores"
  ON public.commercial_channel_scores
  FOR ALL
  USING (auth.jwt() ->> 'role' IN ('admin', 'operador'))
  WITH CHECK (auth.jwt() ->> 'role' IN ('admin', 'operador'));
