import 'dotenv/config'
import { supabase } from '../src/lib/supabase.js'

async function run() {
  console.log('=== JOBS EXECUÇÃO POR DIA ===')
  
  const { data, error } = await supabase
    .from('sync_jobs')
    .select('started_at')
    .gte('started_at', '2026-05-14T00:00:00Z')
    .order('started_at', { ascending: true })

  if (error) {
    console.error(error)
    return
  }

  const counts: Record<string, number> = {}
  data?.forEach(j => {
    if (!j.started_at) return
    const dateStr = j.started_at.split('T')[0]!
    counts[dateStr] = (counts[dateStr] || 0) + 1
  })

  console.log('Execuções por dia:', counts)
}

run()
