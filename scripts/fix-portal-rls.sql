-- ============================================================
-- CRITICAL FIX: Isolamento multi-tenant no portal do cliente
-- Executar no Supabase SQL Editor
--
-- Problema: fix_rls_realtime.sql criou políticas USING (true)
-- que permitem qualquer usuário autenticado ver TODOS os reviews
-- de TODOS os tenants.
--
-- Este script corrige as políticas para usar a tabela tenant_users
-- (que é o que o sistema de onboarding usa para vincular usuários
-- a tenants), garantindo isolamento total.
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- 1. REVIEWS
-- ────────────────────────────────────────────────────────────

-- Remover TODAS as políticas de SELECT existentes na tabela reviews
DROP POLICY IF EXISTS "realtime_select_reviews"   ON public.reviews;
DROP POLICY IF EXISTS "tenant_isolation_reviews"  ON public.reviews;
DROP POLICY IF EXISTS "anon_select_reviews"       ON public.reviews;
DROP POLICY IF EXISTS "Client SELECT reviews"     ON public.reviews;
DROP POLICY IF EXISTS "Superadmin ALL reviews"    ON public.reviews;
DROP POLICY IF EXISTS "Leitura de reviews"        ON public.reviews;

-- Política correta: superadmin vê tudo (via user_roles),
-- cliente portal vê apenas seu próprio tenant (via tenant_users)
CREATE POLICY "reviews_tenant_isolation"
  ON public.reviews
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

-- Anon NÃO deve ver reviews (remover acesso anônimo)
-- O Realtime para usuários autenticados ainda funciona com a política acima.


-- ────────────────────────────────────────────────────────────
-- 2. MONITORED_BUSINESSES
-- ────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "Client SELECT businesses"    ON public.monitored_businesses;
DROP POLICY IF EXISTS "Superadmin ALL businesses"   ON public.monitored_businesses;
DROP POLICY IF EXISTS "Leitura de empresas"         ON public.monitored_businesses;

CREATE POLICY "businesses_tenant_isolation"
  ON public.monitored_businesses
  FOR SELECT
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
  );


-- ────────────────────────────────────────────────────────────
-- 3. ALERT_EVENTS
-- ────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "Client SELECT alerts"        ON public.alert_events;
DROP POLICY IF EXISTS "Superadmin ALL alerts"       ON public.alert_events;
DROP POLICY IF EXISTS "Leitura de alertas"          ON public.alert_events;

-- alert_events não tem tenant_id direto — usa business_id → monitored_businesses
CREATE POLICY "alert_events_tenant_isolation"
  ON public.alert_events
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_roles
      WHERE user_id = auth.uid() AND role = 'superadmin'
    )
    OR
    business_id IN (
      SELECT mb.id
      FROM public.monitored_businesses mb
      JOIN public.tenant_users tu ON tu.tenant_id = mb.tenant_id
      WHERE tu.user_id = auth.uid()
    )
  );


-- ────────────────────────────────────────────────────────────
-- 4. ALERT_RULES
-- ────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "Client SELECT alert_rules"   ON public.alert_rules;
DROP POLICY IF EXISTS "Superadmin ALL alert_rules"  ON public.alert_rules;

CREATE POLICY "alert_rules_tenant_isolation"
  ON public.alert_rules
  FOR SELECT
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
  );


-- ────────────────────────────────────────────────────────────
-- 5. CHANNEL_CONNECTORS
-- ────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "Client SELECT connectors"    ON public.channel_connectors;
DROP POLICY IF EXISTS "Superadmin ALL connectors"   ON public.channel_connectors;
DROP POLICY IF EXISTS "Leitura de conectores"       ON public.channel_connectors;

CREATE POLICY "connectors_tenant_isolation"
  ON public.channel_connectors
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_roles
      WHERE user_id = auth.uid() AND role = 'superadmin'
    )
    OR
    business_id IN (
      SELECT mb.id
      FROM public.monitored_businesses mb
      JOIN public.tenant_users tu ON tu.tenant_id = mb.tenant_id
      WHERE tu.user_id = auth.uid()
    )
  );


-- ────────────────────────────────────────────────────────────
-- 6. TENANT_USERS — garantir que cada usuário só vê seu próprio vínculo
-- ────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "tenant_users_self" ON public.tenant_users;

CREATE POLICY "tenant_users_self"
  ON public.tenant_users
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());


-- ────────────────────────────────────────────────────────────
-- 7. Verificar estado final
-- ────────────────────────────────────────────────────────────
SELECT tablename, policyname, roles, cmd, qual
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN ('reviews', 'monitored_businesses', 'alert_events', 'alert_rules', 'channel_connectors', 'tenant_users')
ORDER BY tablename, policyname;
