-- Migração 032: Tabela de Concorrentes (Benchmarking) e RLS
-- Garante a criação da tabela competitor_businesses, colunas de cache e RLS completo.

CREATE TABLE IF NOT EXISTS public.competitor_businesses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID REFERENCES public.monitored_businesses(id) ON DELETE CASCADE,
  tenant_id UUID REFERENCES public.tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  place_id TEXT NOT NULL,
  last_stats JSONB DEFAULT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT competitor_businesses_biz_place_uq UNIQUE(business_id, place_id)
);

COMMENT ON TABLE public.competitor_businesses IS 'Empresas concorrentes cadastradas para comparação de performance no Benchmarking.';
COMMENT ON COLUMN public.competitor_businesses.last_stats IS 'Cache das últimas estatísticas coletadas (rating, review_count, updated_at).';

-- Índices de performance
CREATE INDEX IF NOT EXISTS idx_competitor_business ON public.competitor_businesses(business_id);
CREATE INDEX IF NOT EXISTS idx_competitor_tenant ON public.competitor_businesses(tenant_id);

-- Permissões de tabela
GRANT ALL ON public.competitor_businesses TO anon, authenticated, service_role;

-- Configuração de RLS
ALTER TABLE public.competitor_businesses ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "competitor_businesses_tenant_all" ON public.competitor_businesses;
DROP POLICY IF EXISTS "competitor_businesses_service_role" ON public.competitor_businesses;

CREATE POLICY "competitor_businesses_tenant_all" ON public.competitor_businesses
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_roles
      WHERE user_id = auth.uid() AND role = 'superadmin'
    )
    OR
    tenant_id IN (
      SELECT tenant_id FROM public.tenant_users
      WHERE user_id = auth.uid()
    )
    OR
    business_id IN (
      SELECT id FROM public.monitored_businesses
      WHERE tenant_id IN (
        SELECT tenant_id FROM public.tenant_users WHERE user_id = auth.uid()
      )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.user_roles
      WHERE user_id = auth.uid() AND role = 'superadmin'
    )
    OR
    tenant_id IN (
      SELECT tenant_id FROM public.tenant_users
      WHERE user_id = auth.uid()
    )
    OR
    business_id IN (
      SELECT id FROM public.monitored_businesses
      WHERE tenant_id IN (
        SELECT tenant_id FROM public.tenant_users WHERE user_id = auth.uid()
      )
    )
  );

CREATE POLICY "competitor_businesses_service_role" ON public.competitor_businesses
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);
