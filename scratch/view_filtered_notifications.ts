import 'dotenv/config'
import { supabase } from '../src/lib/supabase.js'

async function run() {
  const { data: notifications, error } = await supabase
    .from('system_notifications')
    .select('*')
    .eq('connector_id', 'b84c54b6-f3c1-4d77-8b3b-e20e7c39c80a')
    .order('created_at', { ascending: false })

  if (error) {
    console.error('Erro:', error)
    return
  }

  console.log('Notificações para o conector b84c54b6-f3c1-4d77-8b3b-e20e7c39c80a:')
  console.log(JSON.stringify(notifications, null, 2))
}

run()
