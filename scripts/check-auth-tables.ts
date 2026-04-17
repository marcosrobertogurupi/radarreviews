import { supabase } from '../src/lib/supabase.js'

async function check() {
  // Verificar se tenant_members existe
  const { data, error } = await supabase.from('tenant_members').select('*').limit(1)
  if (error) {
    console.log('❌ Tabela tenant_members NÃO existe:', error.message)
  } else {
    console.log('✅ Tabela tenant_members existe!')
    console.log('Colunas:', JSON.stringify(Object.keys(data?.[0] ?? {})))
  }

  // Verificar profiles ou users
  const { data: p, error: pe } = await supabase.from('profiles').select('*').limit(1)
  if (pe) console.log('❌ Tabela profiles NÃO existe:', pe.message)
  else console.log('✅ Tabela profiles existe! Colunas:', JSON.stringify(Object.keys(p?.[0] ?? {})))
}
check()
