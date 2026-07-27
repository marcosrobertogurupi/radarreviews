import 'dotenv/config'
import pg from 'pg'
import { supabaseAdmin } from '../src/lib/supabase.js'

async function runMigration() {
  console.log('--- Aplicando migração do Widget no banco de dados ---')

  // 1. Tentar via PG Direct se houver DATABASE_URL ou Direct DB connection
  const dbUrl = process.env['DATABASE_URL'] || process.env['SUPABASE_DB_URL'] || process.env['POSTGRES_URL']
  
  if (dbUrl) {
    console.log('Conectando via PostgreSQL Direct Client...')
    const client = new pg.Client({ connectionString: dbUrl })
    try {
      await client.connect()
      await client.query(`
        ALTER TABLE tenants
          ADD COLUMN IF NOT EXISTS widget_token UUID DEFAULT gen_random_uuid(),
          ADD COLUMN IF NOT EXISTS widget_config JSONB DEFAULT '{ "theme": "light", "limit": 5, "show_score": true }';

        UPDATE tenants 
        SET widget_token = gen_random_uuid() 
        WHERE widget_token IS NULL;

        UPDATE tenants 
        SET widget_config = '{ "theme": "light", "limit": 5, "show_score": true }'::jsonb 
        WHERE widget_config IS NULL;

        CREATE INDEX IF NOT EXISTS idx_tenants_widget_token ON tenants(widget_token);

        -- Grant UPDATE on tenants for authenticated subscriber users so they can update their widget config & token
        DROP POLICY IF EXISTS "tenant_update_self" ON tenants;
        CREATE POLICY "tenant_update_self" ON tenants
          FOR UPDATE TO authenticated
          USING (
            id IN (SELECT tenant_id FROM tenant_users WHERE user_id = auth.uid())
          )
          WITH CHECK (
            id IN (SELECT tenant_id FROM tenant_users WHERE user_id = auth.uid())
          );
      `)
      console.log('✅ Migração executada com sucesso via Postgres Direct!')
      await client.end()
      return
    } catch (e: any) {
      console.error('Falha via Postgres Direct:', e.message)
    }
  }

  // 2. Se não houver DB_URL ou falhou direct pg, tentar via exec_sql / rpc no Supabase
  try {
    console.log('Tentando via Supabase RPC exec_sql...')
    const { error } = await supabaseAdmin.rpc('exec_sql', {
      sql: `
        ALTER TABLE tenants
          ADD COLUMN IF NOT EXISTS widget_token UUID DEFAULT gen_random_uuid(),
          ADD COLUMN IF NOT EXISTS widget_config JSONB DEFAULT '{ "theme": "light", "limit": 5, "show_score": true }';

        UPDATE tenants SET widget_token = gen_random_uuid() WHERE widget_token IS NULL;
        UPDATE tenants SET widget_config = '{ "theme": "light", "limit": 5, "show_score": true }'::jsonb WHERE widget_config IS NULL;

        CREATE INDEX IF NOT EXISTS idx_tenants_widget_token ON tenants(widget_token);

        DROP POLICY IF EXISTS "tenant_update_self" ON tenants;
        CREATE POLICY "tenant_update_self" ON tenants
          FOR UPDATE TO authenticated
          USING (id IN (SELECT tenant_id FROM tenant_users WHERE user_id = auth.uid()))
          WITH CHECK (id IN (SELECT tenant_id FROM tenant_users WHERE user_id = auth.uid()));
      `
    })
    if (!error) {
      console.log('✅ Migração executada com sucesso via RPC exec_sql!')
      return
    }
    console.error('RPC exec_sql retornou erro:', error.message)
  } catch (err: any) {
    console.error('Falha na RPC exec_sql:', err.message)
  }

  console.log('\n⚠️ NÃO FOI POSSÍVEL EXECUTAR O DDL AUTOMATICAMENTE.')
  console.log('Instrução SQL a ser executada no Supabase Editor:')
  console.log(`
ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS widget_token UUID DEFAULT gen_random_uuid(),
  ADD COLUMN IF NOT EXISTS widget_config JSONB DEFAULT '{ "theme": "light", "limit": 5, "show_score": true }';

UPDATE tenants SET widget_token = gen_random_uuid() WHERE widget_token IS NULL;
UPDATE tenants SET widget_config = '{ "theme": "light", "limit": 5, "show_score": true }'::jsonb WHERE widget_config IS NULL;

CREATE INDEX IF NOT EXISTS idx_tenants_widget_token ON tenants(widget_token);

DROP POLICY IF EXISTS "tenant_update_self" ON tenants;
CREATE POLICY "tenant_update_self" ON tenants
  FOR UPDATE TO authenticated
  USING (id IN (SELECT tenant_id FROM tenant_users WHERE user_id = auth.uid()))
  WITH CHECK (id IN (SELECT tenant_id FROM tenant_users WHERE user_id = auth.uid()));
  `)
}

runMigration()
