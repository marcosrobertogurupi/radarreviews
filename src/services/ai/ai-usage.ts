import { supabase } from '../../lib/supabase.js'
import { logger } from '../../lib/logger.js'
import { logResourceUsage } from '../../lib/telemetry.js'

export interface QuotaCheckResult {
  allowed: boolean
  reason?: string
  used: number
  limit: number
  blocked: boolean
}

export interface RecordUsageParams {
  tenantId: string
  requestType: 'sentiment' | 'copilot' | 'support_triage' | 'prescriptive'
  modelUsed: string
  promptTokens?: number
  completionTokens?: number
}

// Preços por 1 Milhão de tokens (USD)
const PRICING: Record<string, { promptPerM: number; completionPerM: number }> = {
  'gemini-2.0-flash': { promptPerM: 0.075, completionPerM: 0.30 },
  'gemini-2.5-flash': { promptPerM: 0.075, completionPerM: 0.30 },
  'gemini-1.5-flash': { promptPerM: 0.075, completionPerM: 0.30 },
  'claude-3-5-haiku-20241022': { promptPerM: 0.80, completionPerM: 4.00 },
  'claude-3-haiku-20240307': { promptPerM: 0.25, completionPerM: 1.25 },
}

const DEFAULT_PRICING = { promptPerM: 0.10, completionPerM: 0.40 }

/**
 * Verifica se o tenant possui saldo de cota de IA e se não está bloqueado.
 */
export async function checkTenantAIQuota(tenantId: string): Promise<QuotaCheckResult> {
  if (!tenantId) {
    return { allowed: false, reason: 'Tenant não informado.', used: 0, limit: 0, blocked: true }
  }

  if (!supabase || typeof supabase.from !== 'function') {
    return { allowed: true, used: 0, limit: 500000, blocked: false }
  }

  try {
    const { data: tenant, error } = await supabase
      .from('tenants')
      .select('ai_quota_limit, ai_quota_used, ai_blocked')
      .eq('id', tenantId)
      .maybeSingle()

    if (error || !tenant) {
      logger.warn('[ai-usage] Falha ao consultar cota do tenant', { tenantId, error: error?.message })
      return { allowed: true, used: 0, limit: 500000, blocked: false }
    }

    const limit = tenant.ai_quota_limit ?? 500000
    const used = tenant.ai_quota_used ?? 0
    const blocked = tenant.ai_blocked ?? false

    if (blocked) {
      return { allowed: false, reason: 'O acesso à IA está bloqueado para o seu plano.', used, limit, blocked }
    }

    if (used >= limit) {
      return { allowed: false, reason: `Cota mensal de uso de IA excedida (${used.toLocaleString('pt-BR')} / ${limit.toLocaleString('pt-BR')} tokens).`, used, limit, blocked }
    }

    return { allowed: true, used, limit, blocked }
  } catch {
    return { allowed: true, used: 0, limit: 500000, blocked: false }
  }
}

/**
 * Registra o consumo de tokens de uma requisição de IA e atualiza o acumulado do tenant.
 */
export async function recordAIUsage(params: RecordUsageParams): Promise<void> {
  const { tenantId, requestType, modelUsed, promptTokens = 0, completionTokens = 0 } = params

  if (!tenantId) return

  if (!supabase || typeof supabase.from !== 'function') return

  const totalTokens = promptTokens + completionTokens
  const rates = PRICING[modelUsed] || DEFAULT_PRICING
  const cost = (promptTokens * (rates.promptPerM / 1_000_000)) + (completionTokens * (rates.completionPerM / 1_000_000))
  const roundedCost = Math.round(cost * 1_000_000) / 1_000_000 // 6 casas decimais

  try {
    // 1. Inserir log de auditoria
    const { error: logErr } = await supabase.from('tenant_ai_usage_logs').insert({
      tenant_id: tenantId,
      request_type: requestType,
      model_used: modelUsed,
      prompt_tokens: promptTokens,
      completion_tokens: completionTokens,
      estimated_cost_usd: roundedCost,
    })

    if (logErr) {
      logger.error('[ai-usage] Erro ao registrar log de IA:', { message: logErr.message, code: logErr.code })
    }

    // 2. Incrementar saldo consumido do tenant
    const { data: tenant } = await supabase
      .from('tenants')
      .select('ai_quota_used')
      .eq('id', tenantId)
      .single()

    const currentUsed = tenant?.ai_quota_used ?? 0
    await supabase
      .from('tenants')
      .update({ ai_quota_used: currentUsed + totalTokens })
      .eq('id', tenantId)

    // Registrar no sistema unificado de FinOps / Telemetria de Recursos
    logResourceUsage({
      tenant_id: tenantId,
      provider: 'gemini',
      metric_type: 'tokens',
      metric_quantity: totalTokens,
      metadata: { request_type: requestType, model_used: modelUsed, prompt_tokens: promptTokens, completion_tokens: completionTokens }
    }).catch(() => {})

    logger.info('[ai-usage] Consumo de IA registrado', {
      tenantId,
      requestType,
      modelUsed,
      totalTokens,
      costUsd: roundedCost,
    })
  } catch (err: any) {
    logger.error('[ai-usage] Exceção ao registrar consumo de IA:', { message: err?.message || String(err) })
  }
}
