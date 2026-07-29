import { supabase } from './src/lib/supabase.js'

async function checkBusinesses() {
  const tenantId = '9882e497-3b31-4d05-a67f-156225d22566' // Confort Suites Hotel Goiania

  const { data: businesses } = await supabase.from('monitored_businesses').select('*').eq('tenant_id', tenantId)
  console.log('BUSINESSES:', businesses)

  for (const b of businesses || []) {
    const { data: conn } = await supabase.from('channel_connectors').select('*').eq('business_id', b.id)
    console.log(`CONNECTORS FOR BUSINESS ${b.name} (${b.id}):`, conn)
  }
}

checkBusinesses().catch(console.error)
