import 'dotenv/config'
import { supabase } from '../src/lib/supabase.js'

async function getTenantsSchema() {
  const { data, error } = await supabase.from('tenants').select('*').limit(1)
  if (error) { console.error(error.message); return }
  if (data && data.length > 0) {
    console.log('Colunas da tabela tenants:')
    console.log(JSON.stringify(Object.keys(data[0]), null, 2))
  } else {
    console.log('Tabela tenants está vazia.')
  }
}
getTenantsSchema()
