-- Migration 038: Upgrade completo do módulo de prospecção (Fases 1-9)
-- Adiciona: cache Kipflow, segmentos ICP, cadência multi-canal, reuniões nativas, ledger de custo, opt-out LGPD

-- ─── 1. Cache de respostas da Kipflow ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.prospect_kipflow_cache (
  cache_key   TEXT          PRIMARY KEY,
  endpoint    TEXT          NOT NULL,
  filter_hash TEXT          NOT NULL,
  payload     JSONB         NOT NULL DEFAULT '{}'::jsonb,
  cost        NUMERIC(10,4) DEFAULT 0,
  created_at  TIMESTAMPTZ   DEFAULT NOW(),
  expires_at  TIMESTAMPTZ   NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_kipflow_cache_expires ON public.prospect_kipflow_cache (expires_at);

-- ─── 2. Segmentos ICP ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.prospect_icp_segments (
  id               UUID          DEFAULT gen_random_uuid() PRIMARY KEY,
  name             TEXT          NOT NULL,
  description      TEXT,
  filter_json      JSONB         NOT NULL DEFAULT '{}'::jsonb,
  target_seniority TEXT[]        DEFAULT '{}',
  target_area      TEXT[]        DEFAULT '{}',
  is_active        BOOLEAN       DEFAULT true,
  created_at       TIMESTAMPTZ   DEFAULT NOW()
);

-- ─── 3. Colunas extras em prospect_companies (se ainda não existirem) ───────
ALTER TABLE public.prospect_companies
  ADD COLUMN IF NOT EXISTS icp_segment_id      UUID       REFERENCES public.prospect_icp_segments(id),
  ADD COLUMN IF NOT EXISTS fit_score            NUMERIC(4,1),
  ADD COLUMN IF NOT EXISTS reputation_snapshot  JSONB      DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS pipeline_stage       TEXT       DEFAULT 'novo';

-- ─── 4. Colunas extras em prospect_decidors ─────────────────────────────────
ALTER TABLE public.prospect_decidors
  ADD COLUMN IF NOT EXISTS seniority             TEXT,
  ADD COLUMN IF NOT EXISTS area                  TEXT,
  ADD COLUMN IF NOT EXISTS priority_score        NUMERIC(4,1) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS email_verified        BOOLEAN      DEFAULT false,
  ADD COLUMN IF NOT EXISTS linkedin_profile_url  TEXT,
  ADD COLUMN IF NOT EXISTS mobile_phone          TEXT,
  ADD COLUMN IF NOT EXISTS ai_approach_script    TEXT;

-- ─── 5. Sequências de cadência ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.prospect_sequences (
  id               UUID    DEFAULT gen_random_uuid() PRIMARY KEY,
  name             TEXT    NOT NULL,
  icp_segment_id   UUID    REFERENCES public.prospect_icp_segments(id),
  active           BOOLEAN DEFAULT true,
  created_at       TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.prospect_sequence_steps (
  id            UUID    DEFAULT gen_random_uuid() PRIMARY KEY,
  sequence_id   UUID    NOT NULL REFERENCES public.prospect_sequences(id) ON DELETE CASCADE,
  step_order    INT     NOT NULL DEFAULT 1,
  channel       TEXT    NOT NULL CHECK (channel IN ('email','whatsapp','linkedin')),
  delay_days    INT     NOT NULL DEFAULT 3,
  subject       TEXT,
  template      TEXT    NOT NULL DEFAULT '',
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- ─── 6. Toques de outreach ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.prospect_touches (
  id                  UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  decidor_id          UUID        REFERENCES public.prospect_decidors(id),
  sequence_step_id    UUID        REFERENCES public.prospect_sequence_steps(id),
  channel             TEXT        NOT NULL,
  status              TEXT        NOT NULL DEFAULT 'agendado'
                                  CHECK (status IN ('agendado','enviado','entregue','respondido','falhou')),
  reply_classified    TEXT,       -- 'interessado' | 'nao_agora' | 'fora_escopo'
  sent_at             TIMESTAMPTZ,
  created_at          TIMESTAMPTZ DEFAULT NOW()
);

-- ─── 7. Reuniões nativas ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.prospect_meetings (
  id              UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id      UUID        REFERENCES public.prospect_companies(id),
  decidor_id      UUID        REFERENCES public.prospect_decidors(id),
  lead_id         UUID        REFERENCES public.prospect_leads(id),         -- link com esteira antiga
  title           TEXT        NOT NULL DEFAULT 'Reunião Comercial',
  description     TEXT,
  scheduled_at    TIMESTAMPTZ NOT NULL,
  duration_min    INT         NOT NULL DEFAULT 30,
  status          TEXT        NOT NULL DEFAULT 'agendada'
                              CHECK (status IN ('agendada','realizada','cancelada','no_show','reagendada')),
  meeting_link    TEXT,       -- Google Meet / Zoom gerado manualmente
  notes           TEXT,       -- Observações pós-reunião
  outcome         TEXT,       -- Resultado: proposta_enviada | demo_realizada | perdido | etc
  created_by      TEXT,       -- user_id do admin que criou
  source          TEXT        DEFAULT 'manual', -- 'manual' | 'cadencia_automatica'
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_meetings_scheduled ON public.prospect_meetings (scheduled_at);
CREATE INDEX IF NOT EXISTS idx_meetings_status    ON public.prospect_meetings (status);
CREATE INDEX IF NOT EXISTS idx_meetings_company   ON public.prospect_meetings (company_id);

-- ─── 8. Opt-out LGPD ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.prospect_optout (
  id          UUID    DEFAULT gen_random_uuid() PRIMARY KEY,
  email       TEXT,
  phone       TEXT,
  reason      TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_optout_email ON public.prospect_optout (email) WHERE email IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_optout_phone ON public.prospect_optout (phone) WHERE phone IS NOT NULL;

-- ─── 9. Ledger de créditos Kipflow ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.prospect_credit_ledger (
  id              UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  related_log_id  UUID        REFERENCES public.prospect_enrichment_logs(id),
  operation       TEXT        NOT NULL DEFAULT 'debit', -- 'debit' | 'credit'
  cost            NUMERIC(10,4) NOT NULL DEFAULT 0,
  balance_after   NUMERIC(10,4),
  description     TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ─── 10. RLS para todas as novas tabelas ─────────────────────────────────────
ALTER TABLE public.prospect_kipflow_cache      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.prospect_icp_segments       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.prospect_sequences          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.prospect_sequence_steps     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.prospect_touches            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.prospect_meetings           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.prospect_optout             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.prospect_credit_ledger      ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admin_Full_Cache"        ON public.prospect_kipflow_cache      FOR ALL USING (true);
CREATE POLICY "Admin_Full_IcpSegments"  ON public.prospect_icp_segments       FOR ALL USING (true);
CREATE POLICY "Admin_Full_Sequences"    ON public.prospect_sequences           FOR ALL USING (true);
CREATE POLICY "Admin_Full_Steps"        ON public.prospect_sequence_steps      FOR ALL USING (true);
CREATE POLICY "Admin_Full_Touches"      ON public.prospect_touches             FOR ALL USING (true);
CREATE POLICY "Admin_Full_Meetings"     ON public.prospect_meetings            FOR ALL USING (true);
CREATE POLICY "Admin_Full_Optout"       ON public.prospect_optout              FOR ALL USING (true);
CREATE POLICY "Admin_Full_Ledger"       ON public.prospect_credit_ledger       FOR ALL USING (true);
