// Serviço de cálculo do Reputation Score (F12-E8)
//
// Fórmula ponderada (soma = 100%):
//   Componente              Peso  Fonte de dados
//   ─────────────────────── ───── ───────────────────────────────────────────
//   rating_médio            30%   avg(rating) dos reviews dos últimos 90 dias
//   sentimento_positivo     20%   % reviews com sentiment = 'positive'
//   volume_de_reviews       10%   log-normalizado: ln(count+1)/ln(201)
//   taxa_de_resposta        10%   % reviews com has_response = true
//   reclame_aqui            10%   % is_resolved onde channel = 'reclame_aqui'
//   consumidor_gov          10%   % is_resolved onde channel = 'consumidor_gov'
//   tendencia_90d           10%   variação do avg_rating: últimos 30d vs. 60-90d
//
// Score final = soma dos componentes ponderados × 10 (escala 0–1000)

import { supabaseAdmin } from '../lib/supabase.js'
import { logger } from '../lib/logger.js'

export interface ReputationScoreResult {
  business_id: string
  tenant_id: string
  score: number                  // 0–1000
  component_rating: number       // 0–100
  component_sentiment: number    // 0–100
  component_volume: number       // 0–100
  component_response: number     // 0–100
  component_reclame: number      // 0–100
  component_consumidor: number   // 0–100
  component_trend: number        // 0–100
  reviews_analyzed: number
  period_days: number
}

const WEIGHTS = {
  rating:     0.30,
  sentiment:  0.20,
  volume:     0.10,
  response:   0.10,
  reclame:    0.10,
  consumidor: 0.10,
  trend:      0.10,
} as const

/**
 * Calcula o Reputation Score para um business_id e salva no banco.
 * Retorna o resultado calculado.
 */
export async function calculateReputationScore(
  businessId: string,
  tenantId: string,
  periodDays = 90,
): Promise<ReputationScoreResult> {
  const since = new Date(Date.now() - periodDays * 86_400_000).toISOString()
  const midpoint = new Date(Date.now() - 30 * 86_400_000).toISOString()
  const olderCutoff = new Date(Date.now() - 60 * 86_400_000).toISOString()

  // ── Buscar reviews do período ─────────────────────────────────────────────
  const { data: reviews, error } = await supabaseAdmin
    .from('reviews')
    .select('rating, sentiment, has_response, channel, is_resolved, published_at')
    .eq('business_id', businessId)
    .gte('published_at', since)

  if (error) {
    throw new Error(`[reputationScore] Erro ao buscar reviews: ${error.message}`)
  }

  const all = reviews ?? []
  const total = all.length

  // ── Componente 1: Rating médio (0–100 → 30%) ──────────────────────────────
  // Normaliza: 0 estrelas = 0, 5 estrelas = 100
  const withRating = all.filter(r => r.rating != null)
  const avgRating = withRating.length > 0
    ? withRating.reduce((s, r) => s + (r.rating ?? 0), 0) / withRating.length
    : 0
  const compRating = Math.round((avgRating / 5) * 100)

  // ── Componente 2: Sentimento positivo (0–100 → 20%) ───────────────────────
  const positiveCount = all.filter(r => r.sentiment === 'positive').length
  const analyzedCount = all.filter(r => r.sentiment !== 'unanalyzed').length
  const compSentiment = analyzedCount > 0
    ? Math.round((positiveCount / analyzedCount) * 100)
    : 0

  // ── Componente 3: Volume normalizado (0–100 → 10%) ────────────────────────
  // Log-normalização: score = ln(total+1) / ln(201) × 100
  // Calibrado para 200 reviews = 100 pontos
  const compVolume = Math.min(100, Math.round((Math.log(total + 1) / Math.log(201)) * 100))

  // ── Componente 4: Taxa de resposta (0–100 → 10%) ──────────────────────────
  const withResponse = all.filter(r => r.has_response === true).length
  const compResponse = total > 0 ? Math.round((withResponse / total) * 100) : 0

  // ── Componente 5: Reclame Aqui resolvidos (0–100 → 10%) ───────────────────
  const reclameAll = all.filter(r => r.channel === 'reclame_aqui')
  const reclameResolved = reclameAll.filter(r => r.is_resolved === true).length
  const compReclame = reclameAll.length > 0
    ? Math.round((reclameResolved / reclameAll.length) * 100)
    : 50  // Sem dados: neutro (50)

  // ── Componente 6: Consumidor.gov resolvidos (0–100 → 10%) ─────────────────
  const consumidorAll = all.filter(r => r.channel === 'consumidor_gov')
  const consumidorResolved = consumidorAll.filter(r => r.is_resolved === true).length
  const compConsumidor = consumidorAll.length > 0
    ? Math.round((consumidorResolved / consumidorAll.length) * 100)
    : 50  // Sem dados: neutro (50)

  // ── Componente 7: Tendência 90 dias (0–100 → 10%) ─────────────────────────
  // Compara avg_rating dos últimos 30 dias vs. 30-60 dias atrás
  const recent30 = all.filter(r => r.published_at >= midpoint && r.rating != null)
  const older30 = all.filter(r => r.published_at >= olderCutoff && r.published_at < midpoint && r.rating != null)

  let compTrend = 50 // Neutro por padrão
  if (recent30.length >= 3 && older30.length >= 3) {
    const avgRecent = recent30.reduce((s, r) => s + (r.rating ?? 0), 0) / recent30.length
    const avgOlder = older30.reduce((s, r) => s + (r.rating ?? 0), 0) / older30.length
    const delta = avgRecent - avgOlder  // -5 a +5
    // Normaliza: +5 = 100pts, -5 = 0pts
    compTrend = Math.max(0, Math.min(100, Math.round(50 + (delta / 5) * 50)))
  }

  // ── Score final ponderado (0–1000) ────────────────────────────────────────
  const weighted =
    compRating     * WEIGHTS.rating     +
    compSentiment  * WEIGHTS.sentiment  +
    compVolume     * WEIGHTS.volume     +
    compResponse   * WEIGHTS.response   +
    compReclame    * WEIGHTS.reclame    +
    compConsumidor * WEIGHTS.consumidor +
    compTrend      * WEIGHTS.trend

  // Converte 0-100 para 0-1000
  const score = Math.round(weighted * 10)

  const result: ReputationScoreResult = {
    business_id: businessId,
    tenant_id: tenantId,
    score,
    component_rating:     compRating,
    component_sentiment:  compSentiment,
    component_volume:     compVolume,
    component_response:   compResponse,
    component_reclame:    compReclame,
    component_consumidor: compConsumidor,
    component_trend:      compTrend,
    reviews_analyzed: total,
    period_days: periodDays,
  }

  // ── Persistir no banco (upsert) ───────────────────────────────────────────
  const { error: upsertErr } = await supabaseAdmin
    .from('reputation_scores')
    .upsert({
      tenant_id:            tenantId,
      business_id:          businessId,
      score,
      component_rating:     compRating,
      component_sentiment:  compSentiment,
      component_volume:     compVolume,
      component_response:   compResponse,
      component_reclame:    compReclame,
      component_consumidor: compConsumidor,
      component_trend:      compTrend,
      reviews_analyzed: total,
      period_days: periodDays,
      calculated_at: new Date().toISOString(),
    }, { onConflict: 'business_id' })

  if (upsertErr) {
    logger.error('[reputationScore] Erro ao salvar score', { error: upsertErr.message })
  }

  // ── Gravar snapshot histórico ─────────────────────────────────────────────
  const today = new Date().toISOString().split('T')[0]
  const { error: histErr } = await supabaseAdmin
    .from('reputation_score_history')
    .upsert({
      tenant_id: tenantId,
      business_id: businessId,
      score,
      snapshot_date: today,
    }, { onConflict: 'business_id,snapshot_date' })

  if (histErr) {
    logger.warn('[reputationScore] Erro ao gravar histórico', { error: histErr.message })
  }

  logger.info('[reputationScore] Score calculado', {
    business_id: businessId,
    score,
    reviews_analyzed: total,
  })

  return result
}

/**
 * Calcula o Reputation Score para todos os businesses de um tenant.
 */
export async function calculateAllScoresForTenant(tenantId: string): Promise<ReputationScoreResult[]> {
  const { data: businesses } = await supabaseAdmin
    .from('monitored_businesses')
    .select('id')
    .eq('tenant_id', tenantId)
    .eq('is_active', true)

  if (!businesses || businesses.length === 0) return []

  const results: ReputationScoreResult[] = []
  for (const biz of businesses) {
    try {
      const r = await calculateReputationScore(biz.id, tenantId)
      results.push(r)
    } catch (err) {
      logger.error('[reputationScore] Erro em business', { business_id: biz.id, err })
    }
  }

  return results
}

/**
 * Job periódico: recalcula scores de todos os tenants ativos.
 */
export async function runReputationScoreJob(): Promise<void> {
  logger.info('[reputationScore] Iniciando job periódico')

  const { data: tenants } = await supabaseAdmin
    .from('tenants')
    .select('id')
    .eq('is_active', true)

  if (!tenants || tenants.length === 0) {
    logger.info('[reputationScore] Nenhum tenant ativo')
    return
  }

  let totalScored = 0
  for (const tenant of tenants) {
    try {
      const results = await calculateAllScoresForTenant(tenant.id)
      totalScored += results.length
    } catch (err) {
      logger.error('[reputationScore] Erro em tenant', { tenant_id: tenant.id, err })
    }
  }

  logger.info('[reputationScore] Job concluído', { tenants: tenants.length, businesses_scored: totalScored })
}
