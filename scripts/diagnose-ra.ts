import { createClient } from '@supabase/supabase-js'
import 'dotenv/config'

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

async function diagnoseReclameAqui() {
  console.log('🔍 Diagnosticando Conectores Reclame Aqui...')
  
  const { data: connectors, error } = await supabase
    .from('channel_connectors')
    .select('*, monitored_businesses(name)')
    .eq('channel', 'reclame_aqui')

  if (error) {
    console.error('❌ Erro ao buscar conectores:', error)
    return
  }

  if (!connectors || connectors.length === 0) {
    console.log('⚠️ Nenhum conector Reclame Aqui encontrado.')
    return
  }

  connectors.forEach(c => {
    console.log(`--------------------------------------------------`)
    console.log(`Empresa: ${c.monitored_businesses?.name}`)
    console.log(`Status: ${c.status}`)
    console.log(`ID Externo: ${c.external_id}`)
    console.log(`Erro: ${c.error_message || 'Nenhum'}`)
    console.log(`Último Sync: ${c.last_sync_at}`)
  })

  // Verificar se há logs recentes de erro
  const { data: logs } = await supabase
    .from('audit_logs')
    .select('*')
    .ilike('message', '%reclame_aqui%')
    .order('created_at', { ascending: false })
    .limit(5)

  if (logs && logs.length > 0) {
    console.log('\n📝 Logs de Auditoria Recentes:')
    logs.forEach(l => console.log(`[${l.created_at}] ${l.level}: ${l.message}`))
  }
}

diagnoseReclameAqui()
