import { supabase } from '../src/lib/supabase.js'

async function checkRecentErrors() {
  console.log('--- BUSCANDO ÚLTIMOS ERROS DE SINCRONIZAÇÃO ---')
  
  const { data, error } = await supabase
    .from('sync_jobs')
    .select(`
      id,
      started_at,
      status,
      error_detail,
      channel_connectors (
        channel,
        external_id
      )
    `)
    .eq('status', 'failed')
    .order('started_at', { ascending: false })
    .limit(15)

  if (error) {
    console.error('Erro ao buscar dados:', error.message)
    return
  }

  if (!data || data.length === 0) {
    console.log('Nenhum erro recente encontrado no sync_jobs.')
    return
  }

  data.forEach((job: any) => {
    const channel = job.channel_connectors?.channel || 'unknown'
    const eid = job.channel_connectors?.external_id || 'unknown'
    const errorMsg = job.error_detail?.message || JSON.stringify(job.error_detail)
    console.log(`[${job.started_at}] CHANNEL: ${channel} | ID: ${eid}`)
    console.log(`ERRO: ${errorMsg}`)
    console.log('---')
  })
}

checkRecentErrors()
