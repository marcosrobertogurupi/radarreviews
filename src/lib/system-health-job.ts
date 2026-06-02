import { supabase } from './supabase.js'
import { logger } from './logger.js'
import { systemNotifications } from './system-notifications.js'
import type { ChannelConnector } from '../types/connector.js'

/**
 * Job que verifica conectores em estado de falha e envia alertas aos administradores
 * se a falha persistir por mais de 6 horas ou 24 horas.
 */
export async function checkSystemHealth(): Promise<void> {
  logger.info('[system-health] Verificando falhas críticas de conectores (Auditoria)...')

  // Buscar conectores que estão em erro
  const { data: errorConnectors, error } = await supabase
    .from('channel_connectors')
    .select(`
      *,
      monitored_businesses!inner(
        id,
        tenant_id,
        name
      )
    `)
    .eq('status', 'error')
    .not('first_error_at', 'is', null)

  if (error) {
    logger.error('[system-health] Falha ao buscar conectores em erro', { error: error.message })
    return
  }

  if (!errorConnectors || errorConnectors.length === 0) {
    return
  }

  const now = new Date().getTime()
  let alertsSent = 0

  for (const row of errorConnectors) {
    // Converter a row do join para o formato ChannelConnector
    const business = (row as Record<string, unknown>)['monitored_businesses'] as {
      tenant_id: string
    }
    const connector = {
      ...row,
      tenant_id: business.tenant_id,
    } as ChannelConnector

    const firstErrorAt = new Date(connector.first_error_at!).getTime()
    const diffHours = (now - firstErrorAt) / (1000 * 60 * 60)

    // Se o conector foi recém-reparado, ele deveria estar active. Garantimos checando as flags
    if (diffHours >= 24 && !connector.alert_24h_sent) {
      await systemNotifications.notifyError(
        connector, 
        connector.error_message || 'Falha contínua desconhecida', 
        false, 
        24
      )
      
      await supabase
        .from('channel_connectors')
        .update({ alert_24h_sent: true, alert_6h_sent: true })
        .eq('id', connector.id)

      alertsSent++
    } 
    else if (diffHours >= 6 && diffHours < 24 && !connector.alert_6h_sent) {
      await systemNotifications.notifyError(
        connector, 
        connector.error_message || 'Falha contínua desconhecida', 
        false, 
        6
      )
      
      await supabase
        .from('channel_connectors')
        .update({ alert_6h_sent: true })
        .eq('id', connector.id)

      alertsSent++
    }
  }

  if (alertsSent > 0) {
    logger.info(`[system-health] Disparou ${alertsSent} alerta(s) de falhas persistentes.`)
  }
}
