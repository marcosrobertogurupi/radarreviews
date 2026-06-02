import 'dotenv/config'
import { supabase } from '../src/lib/supabase.js'
import { systemNotifications } from '../src/lib/system-notifications.js'

async function run() {
  console.log('🚀 Iniciando script para forçar o disparo do alerta técnico...')

  const connectorId = 'b84c54b6-f3c1-4d77-8b3b-e20e7c39c80a'

  // 1. Deletar notificações pendentes antigas para este conector
  console.log('🧹 Removendo notificações pendentes antigas no banco...')
  const { error: delErr } = await supabase
    .from('system_notifications')
    .delete()
    .eq('connector_id', connectorId)
    .eq('status', 'pendente')

  if (delErr) {
    console.error('❌ Erro ao deletar notificações antigas:', delErr)
    return
  }
  console.log('✅ Notificações pendentes antigas removidas.')

  // 2. Buscar o conector real
  console.log('🔍 Buscando dados do conector no banco...')
  const { data: connector, error: connErr } = await supabase
    .from('channel_connectors')
    .select(`
      *,
      monitored_businesses!inner(
        tenant_id
      )
    `)
    .eq('id', connectorId)
    .single()

  if (connErr || !connector) {
    console.error('❌ Erro ao buscar conector:', connErr)
    return
  }

  const business = (connector as any).monitored_businesses
  const richConnector = {
    ...connector,
    tenant_id: business?.tenant_id || connector.tenant_id
  }

  // 3. Chamar notifyError para gerar a notificação e disparar o webhook do N8N
  console.log('📡 Disparando o alerta para o N8N...')
  try {
    await systemNotifications.notifyError(
      richConnector as any,
      richConnector.error_message || 'timeout of 60000ms exceeded',
      false
    )
    console.log('✅ Alerta disparado com sucesso! Verifique seu WhatsApp/N8N.')
  } catch (err: any) {
    console.error('❌ Falha ao disparar o alerta:', err.message)
  }
}

run()
