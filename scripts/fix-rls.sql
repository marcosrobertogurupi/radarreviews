-- 1. Deletar as políticas antigas para podermos recriá-las limpas
DROP POLICY IF EXISTS "Leitura de roles" ON public.user_roles;
DROP POLICY IF EXISTS "Leitura do tenant" ON public.tenants;
DROP POLICY IF EXISTS "Leitura de empresas" ON public.monitored_businesses;
DROP POLICY IF EXISTS "Leitura de conectores" ON public.channel_connectors;
DROP POLICY IF EXISTS "Leitura de reviews" ON public.reviews;
DROP POLICY IF EXISTS "Leitura de alertas" ON public.alert_events;

-- 2. Criar uma função ignoradora de RLS (Security Definer) para evitar loop infinito
CREATE OR REPLACE FUNCTION public.is_superadmin()
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.user_roles 
    WHERE user_id = auth.uid() AND role = 'superadmin'
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 3. Recriar a política da user_roles (usuário só vê sua própria role para evitar auto-loop)
CREATE POLICY "Leitura de roles" ON public.user_roles FOR SELECT USING (
    auth.uid() = user_id
);

-- 4. Criar permissões para o Superadmin fazer QUALQUER COISA (Insert, Update, Delete)
CREATE POLICY "Superadmin ALL tenants" ON public.tenants FOR ALL USING (public.is_superadmin());
CREATE POLICY "Superadmin ALL businesses" ON public.monitored_businesses FOR ALL USING (public.is_superadmin());
CREATE POLICY "Superadmin ALL connectors" ON public.channel_connectors FOR ALL USING (public.is_superadmin());
CREATE POLICY "Superadmin ALL reviews" ON public.reviews FOR ALL USING (public.is_superadmin());
CREATE POLICY "Superadmin ALL alerts" ON public.alert_events FOR ALL USING (public.is_superadmin());

-- 5. Criar permissões RESTritas (Só de leitura) pros Clientes verem apenas seus dados
CREATE POLICY "Client SELECT tenants" ON public.tenants FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND tenant_id = id AND role = 'client')
);

CREATE POLICY "Client SELECT businesses" ON public.monitored_businesses FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND tenant_id = monitored_businesses.tenant_id AND role = 'client')
);

CREATE POLICY "Client SELECT connectors" ON public.channel_connectors FOR SELECT USING (
    EXISTS (
        SELECT 1 FROM public.monitored_businesses mb 
        JOIN public.user_roles ur ON ur.tenant_id = mb.tenant_id 
        WHERE mb.id = channel_connectors.business_id AND ur.user_id = auth.uid()
    )
);

CREATE POLICY "Client SELECT reviews" ON public.reviews FOR SELECT USING (
    EXISTS (
        SELECT 1 FROM public.monitored_businesses mb 
        JOIN public.user_roles ur ON ur.tenant_id = mb.tenant_id 
        WHERE mb.id = reviews.business_id AND ur.user_id = auth.uid()
    )
);

CREATE POLICY "Client SELECT alerts" ON public.alert_events FOR SELECT USING (
    EXISTS (
        SELECT 1 FROM public.monitored_businesses mb 
        JOIN public.user_roles ur ON ur.tenant_id = mb.tenant_id 
        WHERE mb.id = alert_events.business_id AND ur.user_id = auth.uid()
    )
);
