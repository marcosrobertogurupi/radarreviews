import { supabase } from '../src/lib/supabase.js'

async function getSchema() {
  const { data, error } = await supabase.from('reviews').select('*').limit(1)
  if (error) { console.error(error.message); return }
  if (data && data.length > 0) {
    console.log('Colunas da tabela reviews:')
    console.log(JSON.stringify(Object.keys(data[0]), null, 2))
  } else {
    console.log('Sem dados, mas sem erro.')
  }

  // Buscar políticas de RLS
  const { data: policies } = await supabase
    .from('pg_policies' as any)
    .select('*')
    .eq('tablename', 'reviews')
    .catch(() => ({ data: null }))
  
  if (policies) {
    console.log('\nPolicies de RLS na tabela reviews:')
    console.log(JSON.stringify(policies, null, 2))
  }
}
getSchema()
