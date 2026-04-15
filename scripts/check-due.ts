import 'dotenv/config'
import { supabase } from '../src/lib/supabase.js'

async function check() {
  const { data: buses } = await supabase.from('monitored_businesses').select('id, name, is_active')
  console.log('Businesses:', buses)

  const { data: checks } = await supabase.from('channel_connectors').select('id, status, next_sync_at, business_id')
  console.log('Connectores:', checks)

  const { data: due } = await supabase
    .from('channel_connectors')
    .select('*, monitored_businesses!inner(id, is_active)')
    .eq('status', 'active')
    .eq('monitored_businesses.is_active', true)
    
  console.log('Due Connectors (mocking inner join query):', due)
}
check()
