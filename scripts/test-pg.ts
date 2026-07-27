import 'dotenv/config'
import pg from 'pg'

async function testPg() {
  const host = 'db.lkwahbipteiqqzkmfrac.supabase.co'
  const passwords = [
    process.env['SUPABASE_DB_PASSWORD'],
    process.env['DB_PASSWORD'],
    process.env['POSTGRES_PASSWORD'],
  ].filter(Boolean)

  console.log('Testando senhas DB em:', host)

  for (const pwd of passwords) {
    const connStr = `postgres://postgres:${pwd}@${host}:5432/postgres`
    const client = new pg.Client({ connectionString: connStr, ssl: { rejectUnauthorized: false } })
    try {
      await client.connect()
      console.log('✅ Conectado com sucesso com a senha!')
      await client.query(`
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
      console.log('✅ Migração 034 aplicada no Supabase!')
      await client.end()
      return
    } catch (e: any) {
      console.log('Falha na conexão:', e.message)
      await client.end()
    }
  }

  console.log('Nenhuma DB_PASSWORD direta encontrada nas vars de ambiente.')
}

testPg()
