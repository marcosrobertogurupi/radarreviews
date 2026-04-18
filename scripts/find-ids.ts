import { supabase } from '../src/lib/supabase.js'

async function run() {
  const { data: tenants } = await supabase.from('tenants').select('id, name').limit(1)
  const { data: businesses } = await supabase.from('monitored_businesses').select('id, name, tenant_id').limit(1)
  
  console.log('Tenant:', tenants?.[0])
  console.log('Business:', businesses?.[0])
}

run()
