-- Migração 034: Colunas do Widget e política de Update RLS na tabela tenants
-- Executar no Supabase SQL Editor do projeto radarviews_producao (lkwahbipteiqqzkmfrac)

ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS widget_token UUID DEFAULT gen_random_uuid(),
  ADD COLUMN IF NOT EXISTS widget_config JSONB DEFAULT '{ "theme": "light", "limit": 5, "show_score": true, "show_channel": true }';

-- Garantir que todos os tenants existentes tenham token e config
UPDATE tenants 
SET widget_token = gen_random_uuid() 
WHERE widget_token IS NULL;

UPDATE tenants 
SET widget_config = '{ "theme": "light", "limit": 5, "show_score": true, "show_channel": true }'::jsonb 
WHERE widget_config IS NULL;

-- Criar índice para busca rápida por token no endpoint público do widget
CREATE INDEX IF NOT EXISTS idx_tenants_widget_token ON tenants(widget_token);

-- Política RLS para permitir que o assinante atualize sua própria configuração de tenant (se via client direct)
DROP POLICY IF EXISTS "tenant_update_self" ON tenants;
CREATE POLICY "tenant_update_self" ON tenants
  FOR UPDATE TO authenticated
  USING (
    id IN (SELECT tenant_id FROM tenant_users WHERE user_id = auth.uid())
  )
  WITH CHECK (
    id IN (SELECT tenant_id FROM tenant_users WHERE user_id = auth.uid())
  );
