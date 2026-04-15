-- 1. Criar a tabela de notificações do sistema (para o sininho do Admin)
CREATE TABLE IF NOT EXISTS public.system_notifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID, -- Removida a FK direta para evitar erro de constraint não única
    business_id UUID REFERENCES public.monitored_businesses(id),
    connector_id UUID REFERENCES public.channel_connectors(id),
    channel TEXT,
    type TEXT NOT NULL, -- 'auth_failure', 'sync_error', 'recovery_success'
    message TEXT NOT NULL,
    status TEXT DEFAULT 'pendente', -- 'pendente', 'resolvido'
    payload JSONB,
    created_at TIMESTAMPTZ DEFAULT now(),
    resolved_at TIMESTAMPTZ
);

-- 2. Habilitar RLS (Row Level Security) para segurança
ALTER TABLE public.system_notifications ENABLE ROW LEVEL SECURITY;

-- 3. Adicionar colunas de rastreamento de erro nos conectores para autocura
ALTER TABLE public.channel_connectors ADD COLUMN IF NOT EXISTS first_error_at TIMESTAMPTZ;
ALTER TABLE public.channel_connectors ADD COLUMN IF NOT EXISTS error_count INTEGER DEFAULT 0;

-- 4. Notificar o usuário
COMMENT ON TABLE public.system_notifications IS 'Armazena falhas de conectores e eventos de recuperação automática.';
