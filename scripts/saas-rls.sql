-- 1. Tabela para amarrar os usuários logados às suas empresas
CREATE TABLE IF NOT EXISTS public.user_roles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    tenant_id UUID REFERENCES public.tenants(id) ON DELETE CASCADE,
    role TEXT NOT NULL DEFAULT 'client' CHECK (role IN ('superadmin', 'client')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Ativar RLS
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.monitored_businesses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.channel_connectors ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.alert_events ENABLE ROW LEVEL SECURITY;

-- 2. Políticas (Policies)

-- Superadmin vê tudo, cliente vê só o que é seu:

-- user_roles
CREATE POLICY "Leitura de roles" ON public.user_roles FOR SELECT USING (
    auth.uid() = user_id OR EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'superadmin')
);

-- tenants
CREATE POLICY "Leitura do tenant" ON public.tenants FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'superadmin')
    OR
    EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND tenant_id = id AND role = 'client')
);

-- monitored_businesses
CREATE POLICY "Leitura de empresas" ON public.monitored_businesses FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'superadmin')
    OR
    EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND tenant_id = monitored_businesses.tenant_id AND role = 'client')
);

-- channel_connectors
CREATE POLICY "Leitura de conectores" ON public.channel_connectors FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'superadmin')
    OR
    EXISTS (
        SELECT 1 FROM public.monitored_businesses mb 
        JOIN public.user_roles ur ON ur.tenant_id = mb.tenant_id 
        WHERE mb.id = channel_connectors.business_id AND ur.user_id = auth.uid()
    )
);

-- reviews
CREATE POLICY "Leitura de reviews" ON public.reviews FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'superadmin')
    OR
    EXISTS (
        SELECT 1 FROM public.monitored_businesses mb 
        JOIN public.user_roles ur ON ur.tenant_id = mb.tenant_id 
        WHERE mb.id = reviews.business_id AND ur.user_id = auth.uid()
    )
);

-- alert_events
CREATE POLICY "Leitura de alertas" ON public.alert_events FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'superadmin')
    OR
    EXISTS (
        SELECT 1 FROM public.monitored_businesses mb 
        JOIN public.user_roles ur ON ur.tenant_id = mb.tenant_id 
        WHERE mb.id = alert_events.business_id AND ur.user_id = auth.uid()
    )
);

-- Como você é o desenvolvedor, vamos te dar acesso superadmin IMEDIATO
INSERT INTO public.user_roles (user_id, role)
SELECT id, 'superadmin' FROM auth.users WHERE email = 'marcosroberto_gurupi@hotmail.com'
ON CONFLICT DO NOTHING;
