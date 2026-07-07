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
      name: string
    }
    const connector = {
      ...row,
      tenant_id: business.tenant_id,
    } as ChannelConnector

    const firstErrorAt = new Date(connector.first_error_at!).getTime()
    const diffHours = (now - firstErrorAt) / (1000 * 60 * 60)

    // Se o conector foi recém-reparado, ele deveria estar active. Garantimos checando as flags
    if (diffHours >= 72 && !connector.alert_72h_sent) {
      await systemNotifications.notifyError(
        connector, 
        connector.error_message || 'Falha contínua desconhecida', 
        false, 
        72
      )
      
      await supabase
        .from('channel_connectors')
        .update({ alert_72h_sent: true, alert_48h_sent: true, alert_24h_sent: true, alert_6h_sent: true })
        .eq('id', connector.id)

      alertsSent++
    }
    else if (diffHours >= 48 && diffHours < 72 && !connector.alert_48h_sent) {
      await systemNotifications.notifyError(
        connector, 
        connector.error_message || 'Falha contínua desconhecida', 
        false, 
        48
      )

      // Alerta via WhatsApp para o Admin se o erro persistir por 48h (2 dias)
      const adminPhone = process.env['ADMIN_PHONE']
      const uazapiToken = process.env['UAZAPI_TOKEN']
      if (adminPhone && uazapiToken) {
        try {
          const { sendWhatsAppMessage } = await import('../services/whatsapp/uazapi.js')
          const baseUrl = process.env['UAZAPI_BASE_URL'] ?? 'https://netservice.uazapi.com'
          const bizName = business?.name || 'Desconhecido'
          const msgText = `🚨 *ALERTA CRÍTICO DE INFRAESTRUTURA (48H SEM COLETA)* 🚨\n\nO conector *${connector.channel.toUpperCase()}* da empresa *${bizName}* está apresentando falha contínua há mais de *48 horas*.\n\n*Mensagem de Erro:* ${connector.error_message || 'Erro desconhecido.'}\n\nFavor verificar o conector no painel admin.`
          
          await sendWhatsAppMessage({ baseUrl, token: uazapiToken, number: adminPhone, text: msgText })
          logger.info(`[system-health] Notificação de WhatsApp 48h enviada para o administrador (${adminPhone})`)
        } catch (wsErr) {
          logger.error('[system-health] Erro ao enviar WhatsApp de 48h', { error: wsErr })
        }
      } else {
        logger.warn('[system-health] ADMIN_PHONE ou UAZAPI_TOKEN não definidos no .env — pulando envio de WhatsApp 48h.')
      }

      await supabase
        .from('channel_connectors')
        .update({ alert_48h_sent: true, alert_24h_sent: true, alert_6h_sent: true })
        .eq('id', connector.id)

      alertsSent++
    }
    else if (diffHours >= 24 && diffHours < 48 && !connector.alert_24h_sent) {
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
