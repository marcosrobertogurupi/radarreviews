-- Migração: Sistema de Prospecção & Campanhas Outbound

CREATE TABLE IF NOT EXISTS public.prospect_campaigns (
  id           UUID          DEFAULT gen_random_uuid() PRIMARY KEY,
  slug         TEXT          UNIQUE NOT NULL,
  name         TEXT          NOT NULL,
  description  TEXT,
  total_leads  INTEGER       DEFAULT 0,
  is_active    BOOLEAN       DEFAULT true,
  created_at   TIMESTAMPTZ   DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.prospect_leads (
  id             UUID          DEFAULT gen_random_uuid() PRIMARY KEY,
  campaign_id    UUID          NOT NULL REFERENCES public.prospect_campaigns(id) ON DELETE CASCADE,
  segment_id     TEXT          NOT NULL, -- ex: 'seg_plano_saude'
  company_name   TEXT          NOT NULL,
  contact_name   TEXT,
  phone          TEXT,
  email          TEXT,
  city           TEXT,
  target_role    TEXT,
  variables      JSONB         DEFAULT '{}'::jsonb, -- ex: { "nota_google": 4.2, "qtd_reclamacoes": 15 }
  status         TEXT          NOT NULL DEFAULT 'new', -- 'new' | 'contacted' | 'responded' | 'converted' | 'failed'
  created_at     TIMESTAMPTZ   DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.prospect_templates (
  id             UUID          DEFAULT gen_random_uuid() PRIMARY KEY,
  campaign_id    UUID          NOT NULL REFERENCES public.prospect_campaigns(id) ON DELETE CASCADE,
  segment_id     TEXT          NOT NULL,
  channel        TEXT          NOT NULL, -- 'email' | 'whatsapp' | 'whatsapp_retomada'
  subject        TEXT,         -- Apenas para e-mail
  body           TEXT          NOT NULL,
  created_at     TIMESTAMPTZ   DEFAULT NOW(),
  CONSTRAINT unique_camp_seg_chan UNIQUE (campaign_id, segment_id, channel)
);

CREATE TABLE IF NOT EXISTS public.prospect_followup_queue (
  id             UUID          DEFAULT gen_random_uuid() PRIMARY KEY,
  lead_id        UUID          NOT NULL REFERENCES public.prospect_leads(id) ON DELETE CASCADE,
  channel        TEXT          NOT NULL, -- 'email' | 'whatsapp'
  step           INTEGER       NOT NULL, -- 2 ou 3
  scheduled_at   TIMESTAMPTZ   NOT NULL, -- Data/Hora prevista de envio
  status         TEXT          NOT NULL DEFAULT 'pending', -- 'pending' | 'sent' | 'failed' | 'canceled'
  error_message  TEXT,
  sent_at        TIMESTAMPTZ,
  created_at     TIMESTAMPTZ   DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.prospect_dispatch_logs (
  id             UUID          DEFAULT gen_random_uuid() PRIMARY KEY,
  lead_id        UUID          NOT NULL REFERENCES public.prospect_leads(id) ON DELETE CASCADE,
  channel        TEXT          NOT NULL, -- 'email' | 'whatsapp'
  step           INTEGER       NOT NULL,
  status         TEXT          NOT NULL, -- 'success' | 'failed'
  response_body  TEXT,
  created_at     TIMESTAMPTZ   DEFAULT NOW()
);

-- Habilitar RLS nas novas tabelas
ALTER TABLE public.prospect_campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.prospect_leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.prospect_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.prospect_followup_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.prospect_dispatch_logs ENABLE ROW LEVEL SECURITY;

-- Políticas de RLS de Acesso Total para Administradores
CREATE POLICY "Admin_Full_Access_Campaigns" ON public.prospect_campaigns FOR ALL USING (true);
CREATE POLICY "Admin_Full_Access_Leads" ON public.prospect_leads FOR ALL USING (true);
CREATE POLICY "Admin_Full_Access_Templates" ON public.prospect_templates FOR ALL USING (true);
CREATE POLICY "Admin_Full_Access_Followups" ON public.prospect_followup_queue FOR ALL USING (true);
CREATE POLICY "Admin_Full_Access_Logs" ON public.prospect_dispatch_logs FOR ALL USING (true);
