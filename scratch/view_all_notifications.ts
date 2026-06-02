import 'dotenv/config'
import { supabase } from '../src/lib/supabase.js'

async function run() {
  console.log('=== BUSCANDO TODAS AS NOTIFICAÇÕES DO SISTEMA ===')

  const { data: notifications, error } = await supabase
    .from('system_notifications')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(100)

  if (error) {
    console.error('Erro:', error)
    return
  }

  console.log(`Total encontrado: ${notifications.length}`)
  
  // Agrupar por data ou tipo
  const summary = notifications.map(n => ({
    id: n.id,
    created_at: n.created_at,
    type: n.type,
    message: n.message?.slice(0, 80),
    status: n.status,
    channel: n.channel
  }))

  console.log(JSON.stringify(summary, null, 2))
}

run()
