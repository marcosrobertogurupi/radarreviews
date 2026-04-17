-- Habilitar Realtime para as tabelas críticas
-- Isso permite que o frontend ouça mudanças (INSERT/UPDATE/DELETE) nestas tabelas

-- 1. Verificar se a publicação existe (padrão do Supabase) e adicionar as tabelas
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.reviews;
        ALTER PUBLICATION supabase_realtime ADD TABLE public.alert_events;
        ALTER PUBLICATION supabase_realtime ADD TABLE public.channel_connectors;
    ELSE
        CREATE PUBLICATION supabase_realtime FOR TABLE public.reviews, public.alert_events, public.channel_connectors;
    END IF;
EXCEPTION
    WHEN duplicate_object THEN
        NULL; -- Já estão na publicação
END $$;

-- 2. Garantir que o RLS permita a leitura dessas mudanças (já deve estar OK pelas políticas atuais)
-- Mas é importante lembrar que o Realtime respeita as políticas de RLS.
