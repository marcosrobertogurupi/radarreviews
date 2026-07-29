/**
 * Serviço de Controle de Cotas e Orçamento do Apify
 * Garantia de Segurança Orçamentária e Governança por Tenant
 */

import { supabase } from './supabase.js'
import { logger } from './logger.js'
import { logApiUsage } from './usage.js'
import { ACTOR_SAFETY_LIMITS } from './apify.js'

export interface QuotaCheckResult {
  allowed: boolean
  safeLimit: number
  estimatedCostUsd: number
  reason?: string
}

/**
 * Retorna o orçamento mensal padrão de reviews raspados no Apify por plano.
 */
export function getPlanReviewBudget(planSlug: string): number {
  switch (planSlug.toLowerCase()) {
    case 'trial':
      return 200
    case 'basico':
      return 1000
    case 'completo':
      return 5000
    case 'enterprise':
    case 'custom':
      return 20000
    default:
      return 1000
  }
}

/**
 * Verifica se a chamada de scraping no Apify respeita os limites de cota do tenant.
 * Impede a execução ANTES da chamada à API do Apify se a cota foi atingida.
 */
export async function checkTenantScrapeQuota(
  tenantId: string,
  channel: string,
  requestedItems: number,
  jobType: 'backfill' | 'incremental'
): Promise<QuotaCheckResult> {
  const actorConfig = ACTOR_SAFETY_LIMITS[channel] ?? { maxItems: 20, costPerItem: 0.005 }
  
  // Limites por tipo de job:
  // Backfill: max 500 items (ou o maxItems do actor)
  // Incremental: max 50 items
  const maxAllowedByJobType = jobType === 'backfill' ? Math.min(requestedItems, 500) : Math.min(requestedItems, 50)
  const clampedRequested = Math.min(maxAllowedByJobType, actorConfig.maxItems)

  const estimatedCostUsd = clampedRequested * actorConfig.costPerItem

  try {
    // 1. Buscar ou inicializar a cota do tenant para o canal
    const { data: quota, error: selectErr } = await supabase
      .from('tenant_scrape_quotas')
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('channel', channel)
      .single()

    if (selectErr && selectErr.code !== 'PGRST116') { // PGRST116 = Record not found
      logger.warn('[apify-quota] Erro ao consultar cota do tenant, permitindo limite clamped com aviso', { error: selectErr.message })
      return { allowed: true, safeLimit: clampedRequested, estimatedCostUsd }
    }

    const now = new Date()

    if (!quota) {
      // Buscar plano do tenant para definir orçamento inicial
      const { data: tenant } = await supabase
        .from('tenants')
        .select('subscription_status')
        .eq('id', tenantId)
        .single()

      const planSlug = tenant?.subscription_status === 'trial' ? 'trial' : 'basico'
      const budget = getPlanReviewBudget(planSlug)

      // Criar cota inicial
      await supabase.from('tenant_scrape_quotas').insert({
        tenant_id: tenantId,
        channel,
        plan_slug: planSlug,
        monthly_review_budget: budget,
        consumed_this_cycle: 0,
        cycle_reset_at: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString(),
        hard_cap: true
      })

      return { allowed: true, safeLimit: clampedRequested, estimatedCostUsd }
    }

    // Resetar ciclo se o prazo expirou
    if (new Date(quota.cycle_reset_at) <= now) {
      await supabase
        .from('tenant_scrape_quotas')
        .update({
          consumed_this_cycle: 0,
          cycle_reset_at: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString(),
          updated_at: now.toISOString()
        })
        .eq('id', quota.id)

      quota.consumed_this_cycle = 0
    }

    // Verificar se o limite do ciclo foi excedido
    const budgetRemaining = quota.monthly_review_budget - quota.consumed_this_cycle

    if (budgetRemaining <= 0 && quota.hard_cap) {
      logger.warn(`[apify-quota] Cota excedida para tenant ${tenantId} no canal ${channel}.`, { consumed: quota.consumed_this_cycle, budget: quota.monthly_review_budget })
      return {
        allowed: false,
        safeLimit: 0,
        estimatedCostUsd: 0,
        reason: `Cota mensal de reviews excedida (${quota.consumed_this_cycle}/${quota.monthly_review_budget})`
      }
    }

    // Ajustar o safeLimit para o que resta da cota, se menor do que o solicitado
    const safeLimit = Math.min(clampedRequested, Math.max(1, budgetRemaining))

    return {
      allowed: safeLimit > 0,
      safeLimit,
      estimatedCostUsd: safeLimit * actorConfig.costPerItem,
      reason: safeLimit < clampedRequested ? `Limitado pela cota restante (${budgetRemaining})` : undefined
    }

  } catch (err) {
    logger.error('[apify-quota] Exceção ao verificar cota', { error: String(err) })
    return { allowed: true, safeLimit: clampedRequested, estimatedCostUsd }
  }
}

/**
 * Registra o consumo de itens raspados e grava a telemetria.
 */
export async function recordApifyUsage(
  tenantId: string,
  connectorId: string | undefined,
  channel: string,
  itemsConsumed: number,
  costUsd: number
): Promise<void> {
  if (itemsConsumed <= 0) return

  try {
    // 1. Incrementar cota do tenant
    const { data: quota } = await supabase
      .from('tenant_scrape_quotas')
      .select('id, consumed_this_cycle')
      .eq('tenant_id', tenantId)
      .eq('channel', channel)
      .single()

    if (quota) {
      await supabase
        .from('tenant_scrape_quotas')
        .update({
          consumed_this_cycle: quota.consumed_this_cycle + itemsConsumed,
          updated_at: new Date().toISOString()
        })
        .eq('id', quota.id)
    }

    // 2. Gravar telemetria central de custos
    await logApiUsage({
      tenant_id: tenantId,
      connector_id: connectorId,
      service_name: 'apify',
      operation_type: `${channel}-scrape`,
      units_consumed: itemsConsumed,
      estimated_cost_brl: costUsd * 5.5
    })

  } catch (err) {
    logger.error('[apify-quota] Erro ao registrar consumo', { error: String(err) })
  }
}
