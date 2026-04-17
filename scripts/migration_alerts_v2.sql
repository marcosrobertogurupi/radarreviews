-- 1. Tabela para configurações globais do sistema (acessível por Superadmins)
CREATE TABLE IF NOT EXISTS public.system_settings (
    id TEXT PRIMARY KEY DEFAULT 'global',
    admin_whatsapp TEXT, -- WhatsApp do Marcos (Admin Geral)
    admin_email TEXT,    -- Email do Marcos (Admin Geral)
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- Inserir registro inicial padrão (editável via painel/banco)
INSERT INTO public.system_settings (id, admin_whatsapp, admin_email)
VALUES ('global', '', 'marcosroberto_gurupi@hotmail.com')
ON CONFLICT (id) DO NOTHING;

-- 2. Tabela para evitar duplicidade de alertas atrasados (Fluxo 1)
CREATE TABLE IF NOT EXISTS public.reviews_notified_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    review_id UUID REFERENCES public.reviews(id) ON DELETE CASCADE,
    tenant_id UUID REFERENCES public.tenants(id) ON DELETE CASCADE,
    notified_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(review_id)
);

-- 3. Habilitar RLS
ALTER TABLE public.system_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reviews_notified_log ENABLE ROW LEVEL SECURITY;

-- Superadmins podem tudo em settings
CREATE POLICY "Superadmins manage settings" ON public.system_settings
    FOR ALL USING (
        EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'superadmin')
    );

-- Log de notificações é interno (RLS segue tenant_id para segurança)
CREATE POLICY "Tenants see their notification logs" ON public.reviews_notified_log
    FOR SELECT USING (
        EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND tenant_id = reviews_notified_log.tenant_id)
    );
