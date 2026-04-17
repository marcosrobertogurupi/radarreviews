-- ============================================================
-- FIX: RLS policies para Supabase Realtime — tabela reviews
-- Executar no Supabase SQL Editor
-- ============================================================

-- ETAPA 1: Remover policies conflitantes anteriores
DROP POLICY IF EXISTS "realtime_select_reviews"   ON public.reviews;
DROP POLICY IF EXISTS "tenant_isolation_reviews"  ON public.reviews;
DROP POLICY IF EXISTS "anon_select_reviews"       ON public.reviews;

-- ETAPA 2: Policy para Realtime com anon key
CREATE POLICY "realtime_select_reviews"
  ON public.reviews
  FOR SELECT
  TO anon
  USING (true);

-- ETAPA 3: Policy para usuários autenticados
-- NOTA: tenant_members e profiles não existem neste projeto.
-- O isolamento multi-tenant é feito no nível da aplicação (filtro por tenant_id no frontend).
-- Aqui liberamos o SELECT para authenticated para o Realtime funcionar.
CREATE POLICY "tenant_isolation_reviews"
  ON public.reviews
  FOR SELECT
  TO authenticated
  USING (true);

-- ETAPA 4: GRANT explícito para os roles anon e authenticated
GRANT SELECT ON public.reviews TO anon;
GRANT SELECT ON public.reviews TO authenticated;

-- ETAPA 5: Confirmar que a tabela está na publicação supabase_realtime
SELECT schemaname, tablename
FROM pg_publication_tables
WHERE pubname   = 'supabase_realtime'
  AND tablename = 'reviews';

-- ETAPA 5b (somente se etapa 5 retornar 0 linhas)
-- ALTER PUBLICATION supabase_realtime ADD TABLE public.reviews;

-- ETAPA 6: Validar o estado final
SELECT
  policyname,
  roles,
  cmd,
  qual
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename  = 'reviews'
ORDER BY policyname;
