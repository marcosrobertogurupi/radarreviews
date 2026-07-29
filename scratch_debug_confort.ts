import { supabase } from './src/lib/supabase.js'

async function main() {
  const tenantId = '9882e497-3b31-4d05-a67f-156225d22566' // Confort Suites Hotel Goiania

  console.log('=== 1. INFORMACÕES DO TENANT ===')
  const { data: tenant } = await supabase.from('tenants').select('*').eq('id', tenantId).single()
  console.log(tenant)

  console.log('\n=== 2. EMPRESAS MONITORADAS ===')
  const { data: businesses } = await supabase.from('monitored_businesses').select('*').eq('tenant_id', tenantId)
  console.log(businesses)

  console.log('\n=== 3. CONECTORES DE CANAL ===')
  const { data: connectors } = await supabase.from('channel_connectors').select('*').in('business_id', (businesses || []).map(b => b.id))
  console.table(connectors?.map(c => ({
    id: c.id,
    channel: c.channel,
    status: c.status,
    external_id: c.external_id,
    config: JSON.stringify(c.config),
    last_sync_at: c.last_sync_at,
    next_sync_at: c.next_sync_at,
    error_message: c.error_message
  })))

  console.log('\n=== 4. REVIEWS CADASTRADOS ===')
  const { data: reviews } = await supabase
    .from('reviews')
    .select('id, channel, external_id, rating, published_at, collected_at, title, author_name')
    .eq('tenant_id', tenantId)
    .order('published_at', { ascending: false })

  console.log(`Total de reviews cadastrados: ${reviews?.length || 0}`)
  console.table(reviews)

  console.log('\n=== 5. SYNC JOBS RECENTES ===')
  const { data: syncJobs } = await supabase
    .from('sync_jobs')
    .select('*')
    .in('connector_id', (connectors || []).map(c => c.id))
    .order('started_at', { ascending: false })
    .limit(10)
  console.table(syncJobs)
}

main().catch(console.error)
