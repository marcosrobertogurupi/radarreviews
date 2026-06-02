import 'dotenv/config'
import { supabase } from '../src/lib/supabase.js'

async function run() {
  const { data: jobs, error } = await supabase
    .from('sync_jobs')
    .select(`
      id,
      started_at,
      status,
      error_detail,
      connector_id,
      channel_connectors (
        channel,
        business_id,
        monitored_businesses (
          name
        )
      )
    `)
    .gte('started_at', '2026-05-15T14:00:00Z')
    .lte('started_at', '2026-05-15T18:00:00Z')
    .order('started_at', { ascending: true })

  if (error) {
    console.error(error)
    return
  }

  console.log(`Jobs encontrados entre 14h e 18h no dia 15/05: ${jobs?.length}`)
  console.log(JSON.stringify(jobs, null, 2))
}

run()
