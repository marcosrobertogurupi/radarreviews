import { supabase } from '../src/lib/supabase.js'

async function validatePolicies() {
  console.log('🔍 Verificando políticas RLS na tabela reviews...\n')

  // Buscar políticas existentes via pg_policies
  const { data: policies, error } = await supabase
    .from('pg_policies' as any)
    .select('policyname, roles, cmd, qual')
    .eq('schemaname', 'public')
    .eq('tablename', 'reviews')

  if (error) {
    console.log('⚠️  Não foi possível ler pg_policies via REST (esperado).')
    console.log('👉 Execute o script fix_rls_realtime.sql diretamente no Supabase SQL Editor.')
    return
  }

  console.log('Políticas ativas:', JSON.stringify(policies, null, 2))

  // Verificar publicação
  const { data: pub } = await supabase
    .from('pg_publication_tables' as any)
    .select('tablename')
    .eq('pubname', 'supabase_realtime')
    .eq('tablename', 'reviews')

  console.log('\n📡 Tabela reviews na publicação Realtime:', pub?.length ? '✅ SIM' : '❌ NÃO')
}

validatePolicies()
