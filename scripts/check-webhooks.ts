import 'dotenv/config'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env['SUPABASE_URL']!,
  process.env['SUPABASE_SERVICE_ROLE_KEY']!
)

async function checkWebhookLogs() {
  console.log('🔎 Verificando reviews recentes do Instagram...')
  const { data: reviews, error: rError } = await supabase
    .from('reviews')
    .select('*')
    .eq('channel', 'instagram')
    .order('collected_at', { ascending: false })
    .limit(5)

  if (rError) console.error('Erro ao buscar reviews:', rError)
  else console.log('Reviews encontrados:', reviews)

  console.log('\n🔎 Verificando logs de sistema (possíveis erros de webhook)...')
  const { data: logs, error: lError } = await supabase
    .from('system_notifications') // Onde costumamos salvar erros críticos
    .select('*')
    .ilike('message', '%webhook%')
    .order('created_at', { ascending: false })
    .limit(5)

  if (lError) console.error('Erro ao buscar logs:', lError)
  else console.log('Logs de erro encontrados:', logs)
}

checkWebhookLogs()
