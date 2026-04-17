// Scheduler — orquestra as coletas periódicas de todos os conectores
//
// Loop principal:
// 1. A cada intervalo (padrão: verificar a cada 60s), busca conectores ativos
//    onde next_sync_at <= agora
// 2. Para cada conector, executa o connector correto (baseado em .channel)
// 3. Registra início e fim em sync_jobs
// 4. Atualiza last_sync_at e next_sync_at no channel_connectors
//
// O pipeline de ingestão (src/lib/ingest.ts) garante:
// - Deduplicação: só salva reviews novos ou com conteúdo alterado
// - Alertas: verifica regras após cada sync
// - Stats: agrega dados diários automaticamente

import 'dotenv/config'
import { supabase } from '../lib/supabase.js'
import { logger } from '../lib/logger.js'
import { systemNotifications } from '../lib/system-notifications.js'
import type { ChannelConnector } from '../types/connector.js'
import type { JobResult } from '../types/connector.js'

import { checkCriticalAlerts } from '../lib/critical-alerts-job.js'

// Intervalo de verificação do loop (ms) — verificar a cada 60 segundos
const POLL_INTERVAL_MS = 60_000
const ALERT_CHECK_INTERVAL_MS = 60 * 60_000 // 1 hora

// Mapa de canais → função run() do conector
// Cada canal é lazy-loaded para evitar imports desnecessários
type ConnectorRunner = (connector: ChannelConnector) => Promise<JobResult>

async function loadConnector(channel: string): Promise<ConnectorRunner | null> {
  // Nota: os conectores não implementados ainda lançam erro no import,
  // que é capturado pelo try/catch. O scheduler continua normalmente.
  try {
    if (channel === 'google_maps') {
      const mod = await import('../connectors/google-maps.js')
      return mod.run
    }
    if (channel === 'tripadvisor') {
      const mod = await import('../connectors/tripadvisor.js')
      return mod.run
    }
    if (channel === 'consumidor_gov') {
      const mod = await import('../connectors/consumidor-gov.js')
      return mod.run
    }
    if (channel === 'trustpilot') {
      const mod = await import('../connectors/trustpilot.js')
      return mod.run
    }
    if (channel === 'reddit') {
      const mod = await import('../connectors/reddit/index.js')
      return mod.run
    }
    if (channel === 'facebook') {
      const mod = await import('../connectors/facebook.js')
      return mod.run
    }
    if (channel === 'instagram') {
      const mod = await import('../connectors/instagram.js')
      return mod.run
    }
    if (channel === 'reclame_aqui') {
      const mod = await import('../connectors/reclame-aqui.js')
      return mod.run
    }

    logger.warn(`[scheduler] Canal desconhecido: ${channel}`)
    return null
  } catch {
    logger.warn(`[scheduler] Conector não implementado ainda: ${channel}`)
    return null
  }
}

// -----------------------------------------------------------------------------
// Loop principal
// -----------------------------------------------------------------------------

/**
 * Inicia o scheduler em loop contínuo.
 * Verifica a cada POLL_INTERVAL_MS quais conectores precisam ser executados.
 */
export async function startScheduler(): Promise<void> {
  logger.info('[scheduler] Iniciando — verificando conectores a cada 60s')

  // Executar imediatamente na inicialização, depois em loop
  await runOnce()
  await checkCriticalAlerts().catch(err => {
    logger.error('[scheduler] Erro ao verificar alertas críticos na inicialização', { error: err })
  })

  // Loop de Sincronização (Robôs)
  setInterval(async () => {
    await runOnce().catch(err => {
      logger.error('[scheduler] Erro no ciclo de polling', { error: err })
    })
  }, POLL_INTERVAL_MS)

  // Loop de Alertas (Assinantes) — Rodar a cada 1 hora
  setInterval(async () => {
    await checkCriticalAlerts().catch(err => {
      logger.error('[scheduler] Erro no ciclo de alertas críticos', { error: err })
    })
  }, ALERT_CHECK_INTERVAL_MS)
}

/**
 * Executa um ciclo de coleta: busca todos os conectores com next_sync_at vencido
 * e executa cada um em sequência.
 */
async function runOnce(): Promise<void> {
  const connectors = await fetchDueConnectors()

  if (connectors.length === 0) {
    logger.debug('[scheduler] Nenhum conector com sync vencido')
    return
  }

  logger.info(`[scheduler] ${connectors.length} conector(es) para sincronizar`)

  // Executar em sequência para não sobrecarregar APIs externas
  for (const connector of connectors) {
    await runConnector(connector).catch(err => {
      logger.error('[scheduler] Erro inesperado ao executar conector', {
        connector_id: connector.id,
        channel: connector.channel,
        error: err,
      })
    })
  }
}

// -----------------------------------------------------------------------------
// Buscar conectores com sync vencido
// -----------------------------------------------------------------------------

/**
 * Busca conectores ativos onde next_sync_at <= agora.
 * Join com monitored_businesses para obter tenant_id.
 */
async function fetchDueConnectors(): Promise<ChannelConnector[]> {
  const now = new Date().toISOString()
  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()

  const { data, error } = await supabase
    .from('channel_connectors')
    .select(`
      *,
      monitored_businesses!inner(
        id,
        tenant_id,
        name,
        is_active
      )
    `)
    .in('status', ['active', 'error']) // Buscar ativos OU em erro (para tentar a cura)
    .eq('monitored_businesses.is_active', true)
    // Regra: ativo OU (erro MAS o primeiro erro foi há menos de 24h)
    .or(`status.eq.active,and(status.eq.error,first_error_at.gte.${yesterday})`)
    .or(`next_sync_at.lte.${now},next_sync_at.is.null`)
    .order('next_sync_at', { ascending: true, nullsFirst: true })

  if (error) {
    logger.error('[scheduler] Falha ao buscar conectores', { error: error.message })
    return []
  }

  // Mapear para ChannelConnector incluindo tenant_id do join
  return (data ?? []).map(row => {
    const business = (row as Record<string, unknown>)['monitored_businesses'] as {
      tenant_id: string
    }
    return {
      ...row,
      tenant_id: business.tenant_id,
    } as ChannelConnector
  })
}

// -----------------------------------------------------------------------------
// Executar um conector com log de job
// -----------------------------------------------------------------------------

/**
 * Executa o conector de um canal, registra em sync_jobs e
 * atualiza o status do channel_connector ao final.
 */
async function runConnector(connector: ChannelConnector): Promise<void> {
  const runner = await loadConnector(connector.channel)

  if (!runner) {
    logger.warn(`[scheduler] Pulando conector sem implementação`, {
      connector_id: connector.id,
      channel: connector.channel,
    })
    return
  }

  // Registrar início do job
  const { data: jobData, error: jobError } = await supabase
    .from('sync_jobs')
    .insert({
      connector_id: connector.id,
      status: 'running',
      started_at: new Date().toISOString(),
    })
    .select('id')
    .single()

  if (jobError || !jobData) {
    logger.error('[scheduler] Falha ao criar sync_job', { error: jobError?.message })
    return
  }

  const jobId = (jobData as Record<string, unknown>)['id'] as string

  logger.info(`[scheduler] Iniciando sync`, {
    connector_id: connector.id,
    channel: connector.channel,
    job_id: jobId,
  })

  // Executar o conector
  const startMs = Date.now()
  const result = await runner(connector)
  const durationMs = Date.now() - startMs

  const success = !result.error

  // Atualizar sync_job com resultado
  await supabase
    .from('sync_jobs')
    .update({
      status: success ? 'done' : 'failed',
      finished_at: new Date().toISOString(),
      reviews_fetched: result.reviews_fetched,
      reviews_new: result.reviews_new,
      reviews_updated: result.reviews_updated,
      ...(result.error
        ? { error_detail: { message: result.error, type: result.error_type, is_auth: result.is_auth_error } }
        : {}),
    })
    .eq('id', jobId)

  // Lógica de Autocura e Alertas
  const wasInError = (connector.status as string) !== 'active'
  if (success) {
    if (wasInError) {
      await systemNotifications.notifyRecovery(connector)
    }

    const intervalMinutes = (connector.config['interval_minutes'] as number | undefined) ?? 60
    await supabase
      .from('channel_connectors')
      .update({
        status: 'active',
        last_sync_at: new Date().toISOString(),
        next_sync_at: new Date(Date.now() + intervalMinutes * 60_000).toISOString(),
        error_message: null,
        error_count: 0,
        first_error_at: null,
      })
      .eq('id', connector.id)

  } else {
    const isAuth = !!result.is_auth_error || result.error_type === 'fatal'
    const errorCount = (connector.error_count ?? 0) + 1
    const firstErrorAt = connector.first_error_at ?? new Date().toISOString()
    const isWithin24h = (Date.now() - new Date(firstErrorAt).getTime()) < 24 * 60 * 60 * 1000

    const backoffMinutes = Math.min(60, 5 * Math.pow(2, Math.min(4, errorCount - 1)))
    const shouldAlert = isAuth || !isWithin24h

    if (shouldAlert) {
      await systemNotifications.notifyError(connector, result.error!, !!result.is_auth_error)
    }

    await supabase
      .from('channel_connectors')
      .update({
        status: 'error',
        error_message: result.error ?? null,
        error_count: errorCount,
        first_error_at: firstErrorAt,
        next_sync_at: new Date(Date.now() + backoffMinutes * 60_000).toISOString(),
      })
      .eq('id', connector.id)
  }

  logger.info(`[scheduler] Sync concluído`, {
    connector_id: connector.id,
    channel: connector.channel,
    job_id: jobId,
    success,
  })
}

// -----------------------------------------------------------------------------
// Entry point
// -----------------------------------------------------------------------------

// Executar apenas se chamado diretamente (não quando importado pelo server.ts)
const isMain = process.argv[1]?.endsWith('scheduler/index.js') ||
               process.argv[1]?.endsWith('scheduler/index.ts')
if (isMain) {
  startScheduler().catch(err => {
    logger.error('[scheduler] Falha fatal ao iniciar', { error: err })
    process.exit(1)
  })
}
