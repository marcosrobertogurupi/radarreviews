import 'dotenv/config'
import { createClient } from '@supabase/supabase-js'

const sb = createClient(
  process.env['SUPABASE_URL']!,
  process.env['SUPABASE_SERVICE_ROLE_KEY']!
)

async function listTables() {
  const tables = [
    'tenants', 
    'monitored_businesses', 
    'channel_connectors', 
    'reviews', 
    'alert_rules', 
    'alert_events', 
    'system_notifications', 
    'sync_jobs', 
    'user_roles'
  ]

  console.log('📊 Contagem de registros por tabela:')
  for (const table of tables) {
    const { count, error } = await sb
      .from(table)
      .select('*', { count: 'exact', head: true })
    
    if (error) {
      console.log(`❌ ${table}: ${error.message}`)
    } else {
      console.log(`✅ ${table}: ${count} registros`)
    }
  }
}

listTables().catch(console.error)
