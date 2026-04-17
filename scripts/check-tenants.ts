import { supabase } from '../src/lib/supabase.js'

async function checkTenants() {
  const { data, error } = await supabase.from('tenants').select('*').limit(1)
  if (error) { console.error(error.message); return }
  console.log('Colunas da tabela tenants:')
  console.log(JSON.stringify(Object.keys(data?.[0] ?? {}), null, 2))
  console.log('\nExemplo de registro:')
  console.log(JSON.stringify(data?.[0], null, 2))
}
checkTenants()
