-- Migration 030: Correção de RLS para review_stats_daily (libera leitura para superadmin)

-- 1. Remover políticas existentes restritivas
DROP POLICY IF EXISTS "tenant_isolation" ON public.review_stats_daily;
DROP POLICY IF EXISTS "review_stats_daily_tenant_isolation" ON public.review_stats_daily;

-- 2. Criar nova política permitindo leitura para superadmin e isolamento padrão para clientes do portal
CREATE POLICY "review_stats_daily_tenant_isolation"
  ON public.review_stats_daily
  FOR SELECT
  TO authenticated
  USING (
    -- Superadmin do painel admin (tabela user_roles)
    EXISTS (
      SELECT 1 FROM public.user_roles
      WHERE user_id = auth.uid() AND role = 'superadmin'
    )
    OR
    -- Cliente do portal (tabela tenant_users)
    tenant_id IN (
      SELECT tenant_id FROM public.tenant_users
      WHERE user_id = auth.uid()
    )
  );
