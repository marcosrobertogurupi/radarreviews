import { supabase } from './supabase.js'
import { logger } from './logger.js'
import { systemNotifications } from './system-notifications.js'
import type { ChannelConnector } from '../types/connector.js'

// Threshold configurável: após quantas horas sem coleta o primeiro alerta dispara
const ALERT_NO_SYNC_HOURS = parseInt(process.env['ALERT_NO_SYNC_HOURS'] ?? '6', 10)

/**
 * Job de saúde do sistema — verifica conectores que PARARAM de coletar reviews.
 *
 * FILOSOFIA:
 * - Erros transientes (EAGAIN, timeout) são logados silenciosamente pelo scheduler.
 * - Este job NÃO olha para `first_error_at` (ruído de autocura).
 * - Este job olha para `last_sync_at` — se dados pararam de fluir, o admin precisa saber.
 *
 * ESCALONAMENTO:
 * - Tier 1: sem coleta há ≥ ALERT_NO_SYNC_HOURS (padrão 6h) → WhatsApp consolidado
 * - Tier 2: sem coleta há ≥ 24h → WhatsApp com urgência maior
 * - Tier 3: sem coleta há ≥ 48h → WhatsApp crítico + UaZapi direto
 *
 * AGRUPAMENTO:
 * - Em vez de 1 alerta por conector, agrupa todos os conectores sem coleta
 *   em uma única mensagem por tier, evitando storms de 39+ mensagens.
 */
export async function checkSystemHealth(): Promise<void> {
  logger.info('[system-health] Verificando conectores sem coleta de reviews (Auditoria)...')

  // Buscar todos os conectores não-pausados com join para obter nome da empresa
  const { data: connectors, error } = await supabase
    .from('channel_connectors')
    .select(`
      *,
      monitored_businesses!inner(
        id,
        tenant_id,
        name,
        is_active,
        tenants!inner(
          id,
          is_active,
          subscription_status
        )
      )
    `)
    .in('status', ['active', 'error', 'running'])

  if (error) {
    logger.error('[system-health] Falha ao buscar conectores', { error: error.message })
    return
  }

  if (!connectors || connectors.length === 0) {
    return
  }

  const now = Date.now()

  // Separar conectores por tier de alerta baseado em last_sync_at
  const tier1: Array<{ connector: ChannelConnector; businessName: string; hoursSinceSync: number }> = [] // ≥ 6h
  const tier2: Array<{ connector: ChannelConnector; businessName: string; hoursSinceSync: number }> = [] // ≥ 24h
  const tier3: Array<{ connector: ChannelConnector; businessName: string; hoursSinceSync: number }> = [] // ≥ 48h

  for (const row of connectors) {
    const business = (row as Record<string, unknown>)['monitored_businesses'] as {
      tenant_id: string
      name: string
      is_active: boolean
      tenants: { id: string; is_active: boolean; subscription_status: string }
    }

    // Só verificar conectores de tenants ativos com assinatura válida
    if (!business?.is_active) continue
    if (!business?.tenants?.is_active) continue
    if (business.tenants.subscription_status !== 'active' && business.tenants.subscription_status !== 'trial') continue

    const connector = {
      ...row,
      tenant_id: business.tenant_id,
    } as ChannelConnector

    // Calcular horas desde a última coleta bem-sucedida
    // Se last_sync_at é null, o conector nunca coletou — usar created_at como referência
    const lastSync = connector.last_sync_at
      ? new Date(connector.last_sync_at).getTime()
      : new Date(connector.created_at).getTime()

    const hoursSinceSync = (now - lastSync) / (1000 * 60 * 60)

    // Só alertar se passou do threshold mínimo
    if (hoursSinceSync < ALERT_NO_SYNC_HOURS) continue

    const entry = { connector, businessName: business.name, hoursSinceSync }

    if (hoursSinceSync >= 48 && !connector.alert_48h_sent) {
      tier3.push(entry)
    } else if (hoursSinceSync >= 24 && !connector.alert_24h_sent) {
      tier2.push(entry)
    } else if (hoursSinceSync >= ALERT_NO_SYNC_HOURS && !connector.alert_6h_sent) {
      tier1.push(entry)
    }
  }

  const totalAlerts = tier1.length + tier2.length + tier3.length
  if (totalAlerts === 0) {
    return
  }

  logger.info(`[system-health] Conectores sem coleta detectados: tier1=${tier1.length}, tier2=${tier2.length}, tier3=${tier3.length}`)

  // Enviar alertas agrupados por tier
  if (tier3.length > 0) {
    await sendGroupedAlert(tier3, 48)
    // Marcar flags de alerta para não repetir
    for (const { connector } of tier3) {
      await supabase
        .from('channel_connectors')
        .update({ alert_48h_sent: true, alert_24h_sent: true, alert_6h_sent: true })
        .eq('id', connector.id)
    }
  }

  if (tier2.length > 0) {
    await sendGroupedAlert(tier2, 24)
    for (const { connector } of tier2) {
      await supabase
        .from('channel_connectors')
        .update({ alert_24h_sent: true, alert_6h_sent: true })
        .eq('id', connector.id)
    }
  }

  if (tier1.length > 0) {
    await sendGroupedAlert(tier1, ALERT_NO_SYNC_HOURS)
    for (const { connector } of tier1) {
      await supabase
        .from('channel_connectors')
        .update({ alert_6h_sent: true })
        .eq('id', connector.id)
    }
  }

  logger.info(`[system-health] ${totalAlerts} alerta(s) de coleta parada disparados.`)
}

// -----------------------------------------------------------------------------
// Enviar alerta agrupado (1 mensagem para N conectores)
// -----------------------------------------------------------------------------

async function sendGroupedAlert(
  entries: Array<{ connector: ChannelConnector; businessName: string; hoursSinceSync: number }>,
  tierHours: number
): Promise<void> {
  // Formatar a lista de conectores afetados
  const lines = entries
    .sort((a, b) => b.hoursSinceSync - a.hoursSinceSync) // Mais antigo primeiro
    .map(({ connector, businessName, hoursSinceSync }) => {
      const hoursFormatted = hoursSinceSync < 1
        ? `${Math.round(hoursSinceSync * 60)}min`
        : `${Math.round(hoursSinceSync)}h`
      return `• ${connector.channel.toUpperCase()} — ${businessName} (última coleta: ${hoursFormatted} atrás)`
    })

  const urgency = tierHours >= 48
    ? '🚨🚨 *CRÍTICO*'
    : tierHours >= 24
      ? '🚨 *URGENTE*'
      : '⚠️ *ATENÇÃO*'

  const message = [
    `${urgency} — ALERTA DE SAÚDE DO SISTEMA`,
    '',
    `${entries.length} conector(es) sem coleta de reviews há mais de ${tierHours} horas:`,
    '',
    ...lines,
    '',
    'Verifique no painel admin → Conectores.',
  ].join('\n')

  // 1. Salvar uma notificação consolidada no banco (sininho do admin)
  await supabase.from('system_notifications').insert({
    tenant_id: entries[0]!.connector.tenant_id,
    business_id: entries[0]!.connector.business_id,
    connector_id: entries[0]!.connector.id,
    channel: entries[0]!.connector.channel,
    type: 'no_data_alert',
    message,
    status: 'pendente',
    payload: {
      tier_hours: tierHours,
      affected_connectors: entries.map(e => ({
        connector_id: e.connector.id,
        channel: e.connector.channel,
        business_name: e.businessName,
        hours_since_sync: Math.round(e.hoursSinceSync),
      })),
    }
  })

  // 2. Enviar WhatsApp direto via UaZapi (canal mais confiável para alertas críticos)
  const adminPhone = process.env['ADMIN_PHONE']
  const uazapiToken = process.env['UAZAPI_TOKEN']

  if (adminPhone && uazapiToken) {
    try {
      const { sendWhatsAppMessage } = await import('../services/whatsapp/uazapi.js')
      const baseUrl = process.env['UAZAPI_BASE_URL'] ?? 'https://netservice.uazapi.com'
      await sendWhatsAppMessage({ baseUrl, token: uazapiToken, number: adminPhone, text: message })
      logger.info(`[system-health] WhatsApp de alerta (tier ${tierHours}h) enviado para ${adminPhone} — ${entries.length} conector(es)`)
    } catch (wsErr) {
      logger.error('[system-health] Erro ao enviar WhatsApp', { error: wsErr })
    }
  }

  // 3. Disparar também para N8N (se configurado) como backup
  const webhookUrl = process.env['N8N_SYSTEM_ALERTS_WEBHOOK'] || process.env['N8N_WEBHOOK_URL']
  if (webhookUrl) {
    try {
      const { default: axios } = await import('axios')
      await axios.post(webhookUrl, {
        event: 'system_health_alert',
        status: 'FALHA',
        tier_hours: tierHours,
        affected_count: entries.length,
        formatted_message: message,
        timestamp: new Date().toISOString(),
        admin_url: 'https://reputei-admin.vercel.app/connectors',
      }, { timeout: 5000 })
      logger.info('[system-health] Alerta agrupado enviado para N8N')
    } catch (n8nErr) {
      logger.warn('[system-health] Falha ao enviar alerta para N8N', {
        error: n8nErr instanceof Error ? n8nErr.message : String(n8nErr)
      })
    }
  }
}
