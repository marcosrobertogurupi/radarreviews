import 'dotenv/config'
import { supabase } from '../src/lib/supabase.js'

async function check() {
  const { data, error } = await supabase
    .from('tenants')
    .select('id, name')
    .ilike('name', '%Ceu%')
  
  if (error) {
    console.error('Erro:', error)
  } else {
    console.log('Tenants encontrados:', data)
  }
}

check()
