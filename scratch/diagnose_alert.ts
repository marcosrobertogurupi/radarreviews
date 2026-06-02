import 'dotenv/config'
import { supabase } from '../src/lib/supabase.js'

async function diagnose() {
  console.log('=== DIAGNÓSTICO DO ALERTA CRÍTICO ===')

  // 1. Buscar a empresa
  console.log('\n--- 1. BUSCANDO EMPRESA ---')
  const { data: business, error: bizErr } = await supabase
    .from('monitored_businesses')
    .select(`
      *,
      tenants (*)
    `)
    .ilike('name', '%Imperador%')

  if (bizErr) {
    console.error('Erro ao buscar empresa:', bizErr)
    return
  }
  console.log('Empresas encontradas:', JSON.stringify(business, null, 2))

  if (!business || business.length === 0) {
    console.log('Nenhuma empresa com "Imperador" encontrada.')
    return
  }

  const biz = business[0]

  // 2. Buscar conectores da empresa
  console.log('\n--- 2. BUSCANDO CONECTORES ---')
  const { data: connectors, error: connErr } = await supabase
    .from('channel_connectors')
    .select('*')
    .eq('business_id', biz.id)

  if (connErr) {
    console.error('Erro ao buscar conectores:', connErr)
    return
  }
  console.log('Conectores da empresa:', JSON.stringify(connectors, null, 2))

  if (!connectors || connectors.length === 0) {
    console.log('Nenhum conector encontrado para a empresa.')
    return
  }

  const conn = connectors[0]

  // 3. Buscar notificações do sistema para este conector
  console.log('\n--- 3. BUSCANDO NOTIFICAÇÕES DO SISTEMA ---')
  const { data: notifications, error: notifErr } = await supabase
    .from('system_notifications')
    .select('*')
    .eq('connector_id', conn.id)
    .order('created_at', { ascending: false })
    .limit(10)

  if (notifErr) {
    console.error('Erro ao buscar notificações:', notifErr)
  } else {
    console.log(`Notificações encontradas (${notifications.length}):`, JSON.stringify(notifications, null, 2))
  }

  // 4. Buscar configurações do sistema (global settings)
  console.log('\n--- 4. BUSCANDO SYSTEM SETTINGS ---')
  const { data: settings, error: settErr } = await supabase
    .from('system_settings')
    .select('*')
    .eq('id', 'global')
    .single()

  if (settErr) {
    console.error('Erro ao buscar configurações globais:', settErr)
  } else {
    console.log('Configurações globais (system_settings):', JSON.stringify(settings, null, 2))
  }

  // 5. Buscar últimos jobs para este conector
  console.log('\n--- 5. BUSCANDO ÚLTIMOS JOBS ---')
  const { data: jobs, error: jobsErr } = await supabase
    .from('sync_jobs')
    .select('*')
    .eq('connector_id', conn.id)
    .order('started_at', { ascending: false })
    .limit(5)

  if (jobsErr) {
    console.error('Erro ao buscar jobs:', jobsErr)
  } else {
    console.log('Jobs do conector:', JSON.stringify(jobs, null, 2))
  }
}

diagnose()
