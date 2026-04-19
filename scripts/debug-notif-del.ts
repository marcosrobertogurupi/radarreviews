import { createClient } from '@supabase/supabase-js'
import 'dotenv/config'

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

async function checkSystemNotifications(connectorId: string) {
  console.log(`🔍 Verificando notificações para o conector: ${connectorId}`)
  
  const { data, error } = await supabase
    .from('system_notifications')
    .select('*')
    .eq('connector_id', connectorId)

  if (error) {
    console.error('❌ Erro:', error)
    return
  }

  console.log(`Encontradas ${data.length} notificações.`)
  if (data.length > 0) {
    console.log('Exemplo:', data[0])
    
    console.log('🗑️ Tentando apagar manualmente...')
    const { error: delError } = await supabase
      .from('system_notifications')
      .delete()
      .eq('connector_id', connectorId)
    
    if (delError) {
      console.error('❌ Erro ao apagar:', delError)
    } else {
      console.log('✅ Apagadas com sucesso.')
    }
  }
}

// Vou pegar o ID de um conector do Reclame Aqui que o usuário está tentando apagar
// UNIMED PALMAS Matriz/Cooperativa -> unimed-palmas-to
async function run() {
  const { data: conn } = await supabase
    .from('channel_connectors')
    .select('id')
    .eq('external_id', 'unimed-palmas-to')
    .limit(1)
  
  if (conn && conn[0]) {
    await checkSystemNotifications(conn[0].id)
  } else {
    console.log('Conector não encontrado.')
  }
}

run()
