import { supabase } from './src/lib/supabase.js'

async function resetConnectors() {
  console.log('--- RESETANDO CONECTORES PARA RETRY IMEDIATO ---')
  
  const { data, error } = await supabase
    .from('channel_connectors')
    .update({
      status: 'active',
      error_message: null,
      error_count: 0,
      next_sync_at: new Date().toISOString()
    })
    .in('channel', ['reddit', 'reclame_aqui'])

  if (error) {
    console.error('Erro ao resetar:', error.message)
  } else {
    console.log('Sucesso! Conectores resetados. Eles tentarão sincronizar no próximo ciclo do Scheduler.')
  }
}

resetConnectors()
