-- ============================================================
-- FIX: Restaurar acesso de escrita do painel admin (superadmin)
--
-- O script fix-portal-rls.sql removeu as políticas ALL do superadmin
-- e criou apenas SELECT, bloqueando INSERT/UPDATE/DELETE no admin.
-- Este script restaura os acessos de escrita necessários.
--
-- Executar no Supabase SQL Editor
-- ============================================================

-- ── channel_connectors ──────────────────────────────────────

-- Superadmin pode fazer tudo em conectores (criar, editar, deletar)
DROP POLICY IF EXISTS "connectors_admin_all" ON public.channel_connectors;
CREATE POLICY "connectors_admin_all"
  ON public.channel_connectors
  FOR ALL
  TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'superadmin')
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'superadmin')
  );


-- ── monitored_businesses ────────────────────────────────────

-- Superadmin pode fazer tudo em empresas monitoradas
DROP POLICY IF EXISTS "businesses_admin_all" ON public.monitored_businesses;
CREATE POLICY "businesses_admin_all"
  ON public.monitored_businesses
  FOR ALL
  TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'superadmin')
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'superadmin')
  );


-- ── tenants ─────────────────────────────────────────────────

-- Garantir que superadmin pode criar/editar/deletar tenants
DROP POLICY IF EXISTS "tenants_admin_all"   ON public.tenants;
DROP POLICY IF EXISTS "Superadmin ALL tenants" ON public.tenants;
CREATE POLICY "tenants_admin_all"
  ON public.tenants
  FOR ALL
  TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'superadmin')
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'superadmin')
  );


-- ── tenant_users ─────────────────────────────────────────────

-- Superadmin pode ver e gerenciar vínculos de usuários
DROP POLICY IF EXISTS "tenant_users_admin_all" ON public.tenant_users;
CREATE POLICY "tenant_users_admin_all"
  ON public.tenant_users
  FOR ALL
  TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'superadmin')
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'superadmin')
  );


-- ── alert_events ─────────────────────────────────────────────

-- Superadmin pode marcar alertas como resolvidos (UPDATE)
DROP POLICY IF EXISTS "alert_events_admin_all" ON public.alert_events;
CREATE POLICY "alert_events_admin_all"
  ON public.alert_events
  FOR ALL
  TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'superadmin')
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'superadmin')
  );

-- Clientes também podem fazer UPDATE em seus próprios alertas (marcar como resolvido)
DROP POLICY IF EXISTS "alert_events_client_update" ON public.alert_events;
CREATE POLICY "alert_events_client_update"
  ON public.alert_events
  FOR UPDATE
  TO authenticated
  USING (
    business_id IN (
      SELECT mb.id FROM public.monitored_businesses mb
      JOIN public.tenant_users tu ON tu.tenant_id = mb.tenant_id
      WHERE tu.user_id = auth.uid()
    )
  )
  WITH CHECK (
    business_id IN (
      SELECT mb.id FROM public.monitored_businesses mb
      JOIN public.tenant_users tu ON tu.tenant_id = mb.tenant_id
      WHERE tu.user_id = auth.uid()
    )
  );


-- ── reviews ──────────────────────────────────────────────────

-- Superadmin pode fazer tudo em reviews (o scheduler usa service role, não precisa disso,
-- mas o admin panel pode precisar para visualização/edição manual)
DROP POLICY IF EXISTS "reviews_admin_all" ON public.reviews;
CREATE POLICY "reviews_admin_all"
  ON public.reviews
  FOR ALL
  TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'superadmin')
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'superadmin')
  );


-- ── Verificar estado final ────────────────────────────────────
SELECT tablename, policyname, cmd
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN ('channel_connectors', 'monitored_businesses', 'tenants', 'tenant_users', 'alert_events', 'reviews')
ORDER BY tablename, policyname;
