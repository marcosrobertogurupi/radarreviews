import 'dotenv/config'
import { supabase } from '../src/lib/supabase.js'

async function run() {
  const { data: business } = await supabase
    .from('monitored_businesses')
    .select('id, name')
    .ilike('name', '%Imperador%')
  
  if (!business || business.length === 0) return

  const bizId = business[0].id

  // Pegar os últimos 50 jobs de qualquer conector desta empresa
  const { data: jobs } = await supabase
    .from('sync_jobs')
    .select(`
      id,
      started_at,
      finished_at,
      status,
      error_detail,
      channel_connectors (
        channel
      )
    `)
    .eq('channel_connectors.business_id', bizId)
    .order('started_at', { ascending: false })
    .limit(50)

  console.log('Jobs para a empresa:', JSON.stringify(jobs, null, 2))
}

run()
