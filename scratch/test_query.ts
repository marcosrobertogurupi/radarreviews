import 'dotenv/config'
import { supabase } from '../src/lib/supabase.js'

async function run() {
  const now = new Date().toISOString()
  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()

  console.log('now:', now)
  console.log('yesterday:', yesterday)

  const { data, error } = await supabase
    .from('channel_connectors')
    .select(`
      *,
      monitored_businesses!inner(
        id,
        tenant_id,
        name,
        is_active,
        tenants!inner(
          id,
          is_active,
          subscription_status,
          trial_ends_at
        )
      )
    `)
    .in('status', ['active', 'error'])
    .eq('monitored_businesses.is_active', true)
    .or(`status.eq.active,and(status.eq.error,first_error_at.gte.${yesterday})`)
    .or(`next_sync_at.lte.${now},next_sync_at.is.null`)

  if (error) {
    console.error('Query Error:', error)
  } else {
    console.log('Query Success! Found connectors count:', data?.length)
    console.log('Connectors:', JSON.stringify(data, null, 2))
  }
}

run()
