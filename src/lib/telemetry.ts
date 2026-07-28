// Telemetria de FinOps e Controle de Custos de Recursos
// Rastreamento por tenant e provedor (Railway, Apify, Firecrawl, Gemini, Vercel)

import { supabase } from './supabase.js'
import { logger } from './logger.js'

export type ResourceProvider = 'railway' | 'apify' | 'firecrawl' | 'gemini' | 'vercel'
export type MetricType = 'tokens' | 'executions' | 'requests' | 'cpu_ram_seconds'

export interface LogResourceUsageParams {
  tenant_id: string
  connector_id?: string
  provider: ResourceProvider
  metric_type: MetricType
  metric_quantity: number
  metadata?: Record<string, unknown>
}

// Tabela de preços unitários estimados em USD (fonte: tabelas de preços oficiais)
const UNIT_PRICES_USD = {
  // Gemini 2.5 Flash: Média ponderada ~$0.15 por 1M tokens ($0.00000015 / token)
  gemini_tokens: 0.00000015,
  // Apify: ~$0.003 por execução de scraper no cloud
  apify_executions: 0.003,
  // Firecrawl: ~$0.005 por scraping de página
  firecrawl_requests: 0.005,
  // Railway Playwright compute: Estimado ~$0.000005 por segundo de Chromium ativo
  railway_cpu_ram_seconds: 0.000005,
  // Vercel Serverless / Edge: Estimado ~$0.000001 por requisição
  vercel_requests: 0.000001,
}

/**
 * Calcula o custo estimado em dólares para uma determinada métrica e quantidade.
 */
export function calculateEstimatedCostUsd(
  provider: ResourceProvider,
  metric_type: MetricType,
  quantity: number
): number {
  const key = `${provider}_${metric_type}` as keyof typeof UNIT_PRICES_USD
  const unitPrice = UNIT_PRICES_USD[key] ?? 0.00001
  const cost = quantity * unitPrice
  return Number(cost.toFixed(6))
}

/**
 * Registra um evento de consumo de recurso para um tenant.
 */
export async function logResourceUsage(params: LogResourceUsageParams): Promise<void> {
  const { tenant_id, connector_id, provider, metric_type, metric_quantity, metadata } = params

  if (!tenant_id || metric_quantity <= 0) return

  const estimated_cost_usd = calculateEstimatedCostUsd(provider, metric_type, metric_quantity)

  try {
    const { error } = await supabase.from('resource_usage_logs').insert({
      tenant_id,
      connector_id: connector_id ?? null,
      provider,
      metric_type,
      metric_quantity,
      estimated_cost_usd,
      metadata: metadata ?? {},
    })

    if (error) {
      logger.warn('[telemetry] Falha ao registrar log de consumo de recursos', { error: error.message, params })
    }
  } catch (err) {
    logger.error('[telemetry] Exceção ao registrar uso de recurso', { error: err, params })
  }
}
