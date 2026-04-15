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
import type { ChannelConnector } from '../types/connector.js'
import type { JobResult } from '../types/connector.js'

// Intervalo de verificação do loop (ms) — verificar a cada 60 segundos
const POLL_INTERVAL_MS = 60_000

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

  setInterval(async () => {
    await runOnce().catch(err => {
      logger.error('[scheduler] Erro no ciclo de polling', { error: err })
    })
  }, POLL_INTERVAL_MS)
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
    .eq('status', 'active')
    .eq('monitored_businesses.is_active', true)
    .or(`next_sync_at.lte.${new Date().toISOString()},next_sync_at.is.null`)
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
        ? { error_detail: { message: result.error } }
        : {}),
    })
    .eq('id', jobId)

  // Atualizar channel_connector com próxima sync
  const intervalMinutes =
    (connector.config['interval_minutes'] as number | undefined) ?? 60

  await supabase
    .from('channel_connectors')
    .update({
      status: success ? 'active' : 'error',
      last_sync_at: new Date().toISOString(),
      next_sync_at: new Date(Date.now() + intervalMinutes * 60_000).toISOString(),
      error_message: result.error ?? null,
    })
    .eq('id', connector.id)

  logger.info(`[scheduler] Sync concluído`, {
    connector_id: connector.id,
    channel: connector.channel,
    job_id: jobId,
    success,
    duration_ms: durationMs,
    reviews_fetched: result.reviews_fetched,
    reviews_new: result.reviews_new,
    reviews_updated: result.reviews_updated,
    error: result.error,
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
