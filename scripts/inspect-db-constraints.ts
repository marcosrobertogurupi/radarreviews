import { createClient } from '@supabase/supabase-js'
import 'dotenv/config'

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

async function inspectConstraints() {
  console.log('🔍 Inspecionando constraints da tabela channel_connectors...')
  
  // No Supabase, podemos tentar ler a tabela information_schema.table_constraints via RPC 
  // ou apenas tentar um delete e ver se o erro muda.
  // Mas como não temos acesso direto ao SQL, vamos tentar um "dry run" de delete 
  // limpando mais tabelas.
  
  const tables = [
    'system_notifications',
    'reviews',
    'audit_logs'
  ]
  
  for (const table of tables) {
    const { data, error } = await supabase
      .from(table)
      .select('count', { count: 'exact', head: true })
      .filter('connector_id', 'eq', '1343c078-5c17-4d2e-ae1a-5b450b6ab6a3') // Exemplo do log
      
    if (error) {
      console.log(`Table ${table} logic: ${error.message}`)
    } else {
      console.log(`Table ${table} has ${data?.length || 0} records for this connector (head check)`)
    }
  }
}

inspectConstraints()
