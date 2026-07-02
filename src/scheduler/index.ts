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
import crypto from 'crypto'

// [APPSEC] C8 — Identificador único por worker
const workerId = process.env.WORKER_ID ?? crypto.randomUUID()

import { checkCriticalAlerts } from '../lib/critical-alerts-job.js'
import { runMonthlyReportsJob } from '../lib/monthly-reports-job.js'
import { checkSystemHealth } from '../lib/system-health-job.js'
import { checkSLA, runKnowledgeLearningJob, checkSupportInactivity } from '../lib/support-jobs.js'
import { runBenchmarkingJob, runTopicsAnalysisJob } from '../lib/ai-jobs.js'
import { runCommissionsJob } from '../lib/commissions-job.js'
import { runReputationScoreJob } from '../services/reputationScore.js'
import { runPrescriptiveAnalysisJob } from '../services/prescriptiveAnalysis.js'
import { runBenchmarkSnapshotJob } from '../lib/benchmark-snapshot-job.js'

// Intervalo de verificação do loop (ms) — verificar a cada 2 minutos
const POLL_INTERVAL_MS = 120_000
const ALERT_CHECK_INTERVAL_MS = 60 * 60_000 // 1 hora
const MONTHLY_JOB_INTERVAL_MS = 4 * 3600_000 // 4 horas
const SUPPORT_JOBS_INTERVAL_MS = 15 * 60_000 // 15 minutos
const RECONCILE_INTERVAL_MS = 60 * 60_000 // 1 hora (reconciliação de assinaturas)
const AI_JOBS_INTERVAL_MS = 24 * 3600_000 // 24 horas (Métricas e Nuvem de Temas)
const BENCHMARK_SNAPSHOT_INTERVAL_MS = 7 * 24 * 3600_000 // 7 dias (snapshots semanais)
const WATCHDOG_INTERVAL_MS = 10 * 60_000 // 10 minutos (watchdog de conectores travados)
const WATCHDOG_TIMEOUT_MIN = 45 // Conectores em 'running' por mais de 45min são resetados (scraping pode demorar)
const CONNECTOR_TIMEOUT_MS = 8 * 60_000 // 8 min por conector — evita travamento permanente do batch

// Mapa de canais → função run() do conector
// Cada canal é lazy-loaded para evitar imports desnecessários
type ConnectorRunner = (connector: ChannelConnector) => Promise<JobResult>

async function loadConnector(channel: string): Promise<ConnectorRunner | null> {
  // Nota: os conectores não implementados ainda lançam erro no import,
  // que é capturado pelo try/catch. O scheduler continua normalmente.
  try {
    if (channel === 'google_maps') {
      const mod = await import('../connectors/google_maps/index.js')
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
      const mod = await import('../connectors/instagram-apify.js')
      return mod.run
    }
    if (channel === 'reclame_aqui') {
      const mod = await import('../connectors/reclame-aqui.js')
      return mod.run
    }

    logger.warn(`[scheduler] Canal desconhecido: ${channel}`)
    return null
  } catch (err: any) {
    logger.warn(`[scheduler] Erro ao carregar conector ${channel}: ${err.message}`)
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

  // Watchdog: resetar imediatamente conectores travados em 'running' (ex: crash anterior)
  await resetStuckRunningConnectors().catch(err => {
    logger.error('[scheduler] Erro no watchdog inicial', { error: err })
  })

  // Executar imediatamente na inicialização, depois em loop
  await runOnce()
  await checkCriticalAlerts().catch(err => {
    logger.error('[scheduler] Erro ao verificar alertas críticos na inicialização', { error: err })
  })
  await checkSystemHealth().catch(err => {
    logger.error('[scheduler] Erro ao verificar saúde do sistema na inicialização', { error: err })
  })
  await runMonthlyReportsJob().catch(err => {
    logger.error('[scheduler] Erro no job mensal na inicialização', { error: err })
  })
  await runCommissionsJob().catch(err => {
    logger.error('[scheduler] Erro no job de comissões na inicialização', { error: err })
  })
  
  // Jobs de Suporte
  await checkSLA().catch(err => logger.error('[scheduler] Erro checkSLA', { err }))
  await runKnowledgeLearningJob().catch(err => logger.error('[scheduler] Erro KB learning', { err }))
  await checkSupportInactivity().catch(err => logger.error('[scheduler] Erro checkInactivity', { err }))

  // Jobs de Reconciliação de Assinaturas (Suspender conectores inativos)
  await reconcileSubscriptionConnectors().catch(err => {
    logger.error('[scheduler] Erro na reconciliação de assinaturas na inicialização', { error: err })
  })

  // Jobs de Inteligência Artificial (Concorrentes e Análise de Sentimento/Temas)
  runBenchmarkingJob().catch(err => {
    logger.error('[scheduler] Erro no job de benchmarking inicial', { error: err })
  })
  runTopicsAnalysisJob().catch(err => {
    logger.error('[scheduler] Erro no job de análise de temas inicial', { error: err })
  })
  runReputationScoreJob().catch(err => {
    logger.error('[scheduler] Erro no job de reputation score inicial', { error: err })
  })

  // Loop de Sincronização (Robôs) — Usar setTimeout recursivo para evitar sobreposição
  async function runSyncCycle() {
    await runOnce().catch(err => {
      logger.error('[scheduler] Erro no ciclo de polling', { error: err })
    })
    setTimeout(runSyncCycle, POLL_INTERVAL_MS)
  }
  runSyncCycle()

  // Watchdog periódico — reseta conectores travados em 'running' a cada 10 min
  setInterval(async () => {
    await resetStuckRunningConnectors().catch(err => {
      logger.error('[scheduler] Erro no ciclo do watchdog', { error: err })
    })
  }, WATCHDOG_INTERVAL_MS)

  // Loop de Alertas (Assinantes e Sistema) — Rodar a cada 1 hora
  setInterval(async () => {
    await checkCriticalAlerts().catch(err => {
      logger.error('[scheduler] Erro no ciclo de alertas críticos', { error: err })
    })
    await checkSystemHealth().catch(err => {
      logger.error('[scheduler] Erro no ciclo de saúde do sistema', { error: err })
    })
  }, ALERT_CHECK_INTERVAL_MS)

  // Loop de Relatórios Mensais — Rodar a cada 4 horas (o job filtra dia 1)
  setInterval(async () => {
    await runMonthlyReportsJob().catch(err => {
      logger.error('[scheduler] Erro no ciclo de relatórios mensais', { error: err })
    })
    await runCommissionsJob().catch(err => {
      logger.error('[scheduler] Erro no ciclo de comissões', { error: err })
    })
  }, MONTHLY_JOB_INTERVAL_MS)

  // Loop de Suporte — Rodar a cada 15 min
  setInterval(async () => {
    await Promise.all([
      checkSLA(),
      runKnowledgeLearningJob(),
      checkSupportInactivity()
    ]).catch(err => {
      logger.error('[scheduler] Erro no ciclo de jobs de suporte', { error: err })
    })
  }, SUPPORT_JOBS_INTERVAL_MS)

  // Loop de Reconciliação de Assinaturas — Rodar a cada 1 hora
  setInterval(async () => {
    await reconcileSubscriptionConnectors().catch(err => {
      logger.error('[scheduler] Erro no ciclo de reconciliação de assinaturas', { error: err })
    })
  }, RECONCILE_INTERVAL_MS)

  // Loop de Inteligência Artificial — Rodar a cada 24 horas
  setInterval(async () => {
    try {
      await runBenchmarkingJob()
      await runTopicsAnalysisJob()
      await runReputationScoreJob()
      // Prescritivo: roda diariamente mas só gera novos alertas quando há dados novos
      await runPrescriptiveAnalysisJob()
    } catch (err) {
      logger.error('[scheduler] Erro no ciclo de jobs de IA', { error: err })
    }
  }, AI_JOBS_INTERVAL_MS)

  // Primeira execução do prescritivo na inicialização
  runPrescriptiveAnalysisJob().catch(err => {
    logger.error('[scheduler] Erro no job prescritivo inicial', { error: err })
  })

  // Snapshot semanal de benchmarking competitivo
  runBenchmarkSnapshotJob().catch(err => {
    logger.error('[scheduler] Erro no job de benchmark snapshot inicial', { error: err })
  })
  setInterval(async () => {
    await runBenchmarkSnapshotJob().catch(err => {
      logger.error('[scheduler] Erro no ciclo de benchmark snapshots', { error: err })
    })
  }, BENCHMARK_SNAPSHOT_INTERVAL_MS)
}

/**
 * Executa um ciclo de coleta usando RPC atômica (FOR UPDATE SKIP LOCKED)
 * [APPSEC] C8 — Previne Race Conditions no Scheduler
 */
export async function runOnce(): Promise<void> {
  // 1. Enfileirar conectores vencidos como pendentes (se não estiverem já na fila)
  const connectors = await fetchDueConnectors()
  
  for (const connector of connectors) {
    // Bloqueia preventivamente no conector para não gerar múltiplos jobs pendentes
    await supabase.from('channel_connectors').update({ status: 'running' }).eq('id', connector.id)
    
    // Insere job pendente
    await supabase.from('sync_jobs').insert({
      connector_id: connector.id,
      status: 'pending',
      started_at: null
    })
  }

  // 2. Claim atômico usando a RPC
  const { data: jobs, error } = await supabase
    .rpc('claim_review_jobs', {
      p_batch_size: 10,
      p_worker_id: workerId,
      p_timeout_min: 15,
    })

  if (error) {
    logger.error('[scheduler] claim_review_jobs error:', { error })
    return
  }

  if (!jobs?.length) {
    return // Nada a processar
  }

  logger.info(`[scheduler] ${jobs.length} job(s) bloqueado(s) para este worker (${workerId})`)

  await Promise.all((jobs as Array<{ id: string; connector_id: string }>).map(async (job) => {
    const { data: connectorData } = await supabase
      .from('channel_connectors')
      .select(`
        *,
        monitored_businesses (
          tenant_id
        )
      `)
      .eq('id', job.connector_id)
      .single()

    if (!connectorData) return

    const businessInfo = (connectorData as any).monitored_businesses
    const connectorWithTenant = {
      ...connectorData,
      tenant_id: businessInfo?.tenant_id
    } as ChannelConnector

    let timeoutHandle: ReturnType<typeof setTimeout> | null = null
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutHandle = setTimeout(
        () => reject(new Error(`Timeout de ${CONNECTOR_TIMEOUT_MS / 60_000}min excedido`)),
        CONNECTOR_TIMEOUT_MS
      )
    })

    await Promise.race([runConnector(connectorWithTenant, job.id), timeoutPromise])
      .catch(async (err) => {
        const errMsg = err instanceof Error ? err.message : String(err)
        logger.error('[scheduler] Erro ou timeout ao executar conector', {
          connector_id: connectorData.id,
          channel: connectorData.channel,
          error: errMsg,
        })
        if (errMsg.includes('Timeout')) {
          await supabase.from('channel_connectors').update({
            status: 'error',
            error_message: errMsg,
            next_sync_at: new Date(Date.now() + 10 * 60_000).toISOString(),
          }).eq('id', connectorData.id)
        }
      })
      .finally(() => { if (timeoutHandle) clearTimeout(timeoutHandle) })
  }))
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
        is_active,
        tenants!inner(
          id,
          is_active,
          subscription_status,
          trial_ends_at
        )
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

  // Filtrar na memória conectores de tenants suspensos, cancelados ou expirados
  const validRows = (data ?? []).filter(row => {
    const business = (row as any).monitored_businesses
    if (!business) return false
    
    const tenant = business.tenants
    if (!tenant) return false

    // Tenant deve estar ativo
    if (!tenant.is_active) return false

    // Status da assinatura deve ser 'active' ou 'trial'
    const status = tenant.subscription_status
    if (status !== 'active' && status !== 'trial') return false

    // Se for trial, não pode ter expirado
    if (status === 'trial' && tenant.trial_ends_at) {
      const trialEnd = new Date(tenant.trial_ends_at).getTime()
      if (trialEnd < Date.now()) return false
    }

    return true
  })

  // Mapear para ChannelConnector incluindo tenant_id do join
  return validRows.map(row => {
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
 * Executa o conector de um canal e atualiza o sync_job pré-existente
 */
async function runConnector(connector: ChannelConnector, jobId: string): Promise<void> {
  const runner = await loadConnector(connector.channel)

  if (!runner) {
    logger.warn(`[scheduler] Pulando conector sem implementação`, {
      connector_id: connector.id,
      channel: connector.channel,
    })
    return
  }

  try {
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

    // 2. Atualizar sync_job com resultado final
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

    // 3. Lógica de Autocura e Alertas
    const wasInError = (connector.status as string) !== 'active'
    if (success) {
      if (wasInError) {
        await systemNotifications.notifyRecovery(connector)
      }

      const intervalMinutes = (connector.config['interval_minutes'] as number | undefined) ?? 120
      await supabase
        .from('channel_connectors')
        .update({
          status: 'active',
          last_sync_at: new Date().toISOString(),
          next_sync_at: new Date(Date.now() + intervalMinutes * 60_000).toISOString(),
          error_message: null,
          error_count: 0,
          first_error_at: null,
          alert_6h_sent: false,
          alert_24h_sent: false,
          alert_72h_sent: false,
        })
        .eq('id', connector.id)

    } else {
      const isAuth = !!result.is_auth_error || result.error_type === 'fatal'
      const errorCount = (connector.error_count ?? 0) + 1
      const firstErrorAt = connector.first_error_at ?? new Date().toISOString()
      const isWithin24h = (Date.now() - new Date(firstErrorAt).getTime()) < 24 * 60 * 60 * 1000

      const backoffMinutes = Math.min(60, 5 * Math.pow(2, Math.min(4, errorCount - 1)))
      
      // Alertas síncronos (imediatos) apenas para erros fatais ou de autenticação.
      // Erros transientes serão monitorados pelo system-health-job (6h e 24h).
      const shouldAlert = isAuth

      if (shouldAlert) {
        // Envia notificação imediata. Opcionalmente, poderíamos adicionar flags para evitar spam,
        // mas erros auth são graves o suficiente para alertar.
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

  } catch (err) {
    const errMsg = `Crash crítico: ${err instanceof Error ? err.message : String(err)}`
    logger.error('[scheduler] Falha crítica na execução do conector', {
      connector_id: connector.id,
      error: errMsg
    })

    const errorCount = (connector.error_count ?? 0) + 1
    const firstErrorAt = connector.first_error_at ?? new Date().toISOString()

    // Envia o alerta imediato por ser uma exceção inesperada e grave (Crash)
    try {
      const updatedConnector = {
        ...connector,
        error_count: errorCount,
        first_error_at: firstErrorAt
      }
      await systemNotifications.notifyError(updatedConnector, errMsg, false)
    } catch (notifyErr) {
      logger.error('[scheduler] Falha ao disparar notificação de crash', { error: notifyErr })
    }

    // Em caso de erro catastrófico (ex: crash do runner), volta para status error para não travar em 'running'
    await supabase
      .from('channel_connectors')
      .update({
        status: 'error',
        error_message: errMsg,
        error_count: errorCount,
        first_error_at: firstErrorAt,
        next_sync_at: new Date(Date.now() + 5 * 60_000).toISOString(), // Tentar de novo em 5 min
      })
      .eq('id', connector.id)
  }
}

// -----------------------------------------------------------------------------
// Watchdog — reseta conectores travados em status 'running'
// -----------------------------------------------------------------------------

/**
 * Detecta conectores que ficaram presos em 'running' (ex: crash do scheduler)
 * e os reseta para 'error' com next_sync_at imediato para que sejam retomados.
 */
async function resetStuckRunningConnectors(): Promise<void> {
  const { data, error } = await supabase
    .rpc('reset_stuck_connectors', { p_timeout_min: WATCHDOG_TIMEOUT_MIN })

  if (error) {
    logger.error('[scheduler] Watchdog: falha ao resetar conectores travados', { error: error.message })
    return
  }

  const count = data as number
  if (count > 0) {
    logger.warn(`[scheduler] Watchdog: ${count} conector(es) travado(s) em 'running' foram resetados para 'error'`)
  }
}

/**
 * Varre o banco de dados para pausar automaticamente conectores ativos
 * de inquilinos que cancelaram a assinatura, ficaram suspensos ou expiraram o trial.
 */
export async function reconcileSubscriptionConnectors(): Promise<void> {
  logger.info('[scheduler] Iniciando reconciliação de assinaturas/conectores')
  try {
    const now = new Date().toISOString()

    // 1. Suspender automaticamente trials expirados
    const { error: trialErr } = await supabase
      .from('tenants')
      .update({
        subscription_status: 'suspended',
        plan_status: 'suspended'
      })
      .eq('subscription_status', 'trial')
      .lt('trial_ends_at', now)

    if (trialErr) {
      logger.error('[scheduler] Falha ao expirar trials antigos', { error: trialErr.message })
    }

    // 2. Buscar todos os conectores que poderiam estar consumindo créditos (active, error, running)
    const { data, error: fetchErr } = await supabase
      .from('channel_connectors')
      .select(`
        id,
        monitored_businesses!inner(
          id,
          tenant_id,
          tenants!inner(
            id,
            is_active,
            subscription_status
          )
        )
      `)
      .in('status', ['active', 'error', 'running'])

    if (fetchErr) {
      logger.error('[scheduler] Falha ao consultar conectores para reconciliação', { error: fetchErr.message })
      return
    }

    const toPauseIds: string[] = []

    for (const row of (data ?? [])) {
      const business = (row as any).monitored_businesses
      if (!business) continue
      const tenant = business.tenants
      if (!tenant) continue

      const isTenantInactive = !tenant.is_active
      const isSubInvalid = tenant.subscription_status !== 'active' && tenant.subscription_status !== 'trial'

      if (isTenantInactive || isSubInvalid) {
        toPauseIds.push(row.id)
      }
    }

    if (toPauseIds.length > 0) {
      logger.info(`[scheduler] Pausando ${toPauseIds.length} conectores devido a assinaturas canceladas/inativas`)
      
      const { error: updateErr } = await supabase
        .from('channel_connectors')
        .update({
          status: 'paused',
          error_message: 'Pausado automaticamente: assinatura suspensa ou inativa.'
        })
        .in('id', toPauseIds)

      if (updateErr) {
        logger.error('[scheduler] Falha ao suspender conectores inativos no banco', { error: updateErr.message })
      } else {
        logger.info('[scheduler] Conectores expirados suspensos com sucesso.')
      }
    }

    // 3. Buscar todos os conectores pausados que poderiam ser reativados (status = 'paused' e error_message contendo a string de pause automático)
    const { data: pausedData, error: fetchPausedErr } = await supabase
      .from('channel_connectors')
      .select(`
        id,
        error_message,
        monitored_businesses!inner(
          id,
          tenant_id,
          tenants!inner(
            id,
            is_active,
            subscription_status
          )
        )
      `)
      .eq('status', 'paused')
      .eq('error_message', 'Pausado automaticamente: assinatura suspensa ou inativa.')

    if (fetchPausedErr) {
      logger.error('[scheduler] Falha ao consultar conectores pausados para reconciliação', { error: fetchPausedErr.message })
    } else {
      const toResumeIds: string[] = []

      for (const row of (pausedData ?? [])) {
        const business = (row as any).monitored_businesses
        if (!business) continue
        const tenant = business.tenants
        if (!tenant) continue

        const isTenantActive = tenant.is_active
        const isSubValid = tenant.subscription_status === 'active' || tenant.subscription_status === 'trial'

        if (isTenantActive && isSubValid) {
          toResumeIds.push(row.id)
        }
      }

      if (toResumeIds.length > 0) {
        logger.info(`[scheduler] Reativando ${toResumeIds.length} conectores devido a assinaturas reativadas/renovadas`)
        
        const { error: updateResumeErr } = await supabase
          .from('channel_connectors')
          .update({
            status: 'active',
            error_message: null,
            next_sync_at: new Date().toISOString()
          })
          .in('id', toResumeIds)

        if (updateResumeErr) {
          logger.error('[scheduler] Falha ao reativar conectores no banco', { error: updateResumeErr.message })
        } else {
          logger.info('[scheduler] Conectores reativados com sucesso.')
        }
      }
    }
  } catch (err: any) {
    logger.error('[scheduler] Exceção fatal no job de reconciliação', { error: err.message })
  }
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
