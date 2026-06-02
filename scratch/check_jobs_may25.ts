import 'dotenv/config'
import { supabase } from '../src/lib/supabase.js'

async function run() {
  console.log('=== JOBS EXECUÇÃO MAY 25 ===')
  
  const { data, error } = await supabase
    .from('sync_jobs')
    .select(`
      id,
      started_at,
      finished_at,
      status,
      error_detail,
      channel_connectors (
        channel,
        monitored_businesses (
          name
        )
      )
    `)
    .gte('started_at', '2026-05-25T00:00:00Z')
    .lte('started_at', '2026-05-25T23:59:59Z')
    .order('started_at', { ascending: true })

  if (error) {
    console.error(error)
    return
  }

  console.log('Jobs:', JSON.stringify(data, null, 2))
}

run()
