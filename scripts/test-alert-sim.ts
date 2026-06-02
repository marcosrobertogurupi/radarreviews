import 'dotenv/config'
import { systemNotifications } from '../src/lib/system-notifications.js'
import { supabase } from '../src/lib/supabase.js'

async function runSimulation() {
  console.log('🚀 Iniciando simulação de disparo de alerta...')

  // 1. Carregar o conector real da BYD para o teste ficar perfeito
  const { data: connector, error } = await supabase
    .from('channel_connectors')
    .select(`
      *,
      monitored_businesses!inner(
        tenant_id
      )
    `)
    .eq('id', '44d30eec-5f65-4bac-b181-166da07b12be')
    .single()

  if (error || !connector) {
    console.error('❌ Falha ao buscar o conector da BYD no banco de dados.', error)
    return
  }

  // Anexar o tenant_id como exige o tipo ChannelConnector
  const business = (connector as any).monitored_businesses
  const richConnector = {
    ...connector,
    tenant_id: business?.tenant_id || connector.tenant_id
  }

  const testMessage = 'SIMULAÇÃO DE TESTE TÉCNICO: O sistema de monitoramento detectou uma instabilidade simulada com sucesso.'

  console.log('📡 Enviando payload rico de teste para o N8N...')
  
  try {
    // Disparar o método que atualizamos, simulando o erro
    await systemNotifications.notifyError(richConnector as any, testMessage, false)
    console.log('✅ Fluxo executado! Verifique o WhatsApp configurado no admin.')
    
    // Vamos limpar a notificação de teste inserida no banco para não sujar o painel
    console.log('🧹 Limpando rastro de teste do banco de dados...')
    const { error: cleanErr } = await supabase
      .from('system_notifications')
      .delete()
      .eq('connector_id', richConnector.id)
      .eq('message', testMessage)

    if (cleanErr) {
      console.warn('⚠️ Falha ao limpar o registro de teste do banco.', cleanErr.message)
    } else {
      console.log('✨ Limpeza concluída com sucesso.')
    }

  } catch (err: any) {
    console.error('❌ Ocorreu uma falha durante a simulação:', err.message)
  }
}

runSimulation()
