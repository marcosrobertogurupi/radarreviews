// Job de benchmark snapshots (F12-E5-T2)
//
// Captura semanalmente a posição do tenant vs concorrentes cadastrados,
// gravando em benchmark_snapshots para análise de tendência de crescimento.

import { supabaseAdmin } from './supabase.js'
import { logger } from './logger.js'

async function snapshotBusiness(
  tenantId: string,
  businessId: string,
): Promise<void> {
  const since30 = new Date(Date.now() - 30 * 86_400_000).toISOString().split('T')[0]!
  const today = new Date().toISOString().split('T')[0]!

  // Dados do tenant no período
  const { data: stats } = await supabaseAdmin
    .from('review_stats_daily')
    .select('avg_rating, total_reviews, positive_count')
    .eq('business_id', businessId)
    .gte('date', since30)

  const rows = stats ?? []
  const totalReviews = rows.reduce((a, r) => a + (r.total_reviews ?? 0), 0)
  const avgRating = totalReviews > 0
    ? rows.reduce((a, r) => a + (r.avg_rating ?? 0) * (r.total_reviews ?? 0), 0) / totalReviews
    : null
  const positiveCount = rows.reduce((a, r) => a + (r.positive_count ?? 0), 0)
  const positiveRate = totalReviews > 0 ? (positiveCount / totalReviews) * 100 : null

  // Taxa de resposta
  const { count: totalReviewsCount } = await supabaseAdmin
    .from('reviews')
    .select('id', { count: 'exact', head: true })
    .eq('business_id', businessId)
    .gte('published_at', `${since30}T00:00:00Z`)

  const { count: respondedCount } = await supabaseAdmin
    .from('reviews')
    .select('id', { count: 'exact', head: true })
    .eq('business_id', businessId)
    .eq('has_response', true)
    .gte('published_at', `${since30}T00:00:00Z`)

  const responseRate = (totalReviewsCount ?? 0) > 0
    ? ((respondedCount ?? 0) / (totalReviewsCount ?? 1)) * 100
    : null

  // Dados dos concorrentes cadastrados
  const { data: competitors } = await supabaseAdmin
    .from('competitor_businesses')
    .select('last_stats')
    .eq('business_id', businessId)

  const comps = competitors ?? []
  let compAvgRating: number | null = null
  let compAvgReviews: number | null = null

  if (comps.length > 0) {
    const ratings = comps
      .map(c => (c.last_stats as Record<string, unknown> | null)?.['rating'] as number | undefined)
      .filter((r): r is number => r != null)
    const reviews = comps
      .map(c => (c.last_stats as Record<string, unknown> | null)?.['reviews'] as number | undefined)
      .filter((r): r is number => r != null)

    if (ratings.length > 0) compAvgRating = ratings.reduce((a, b) => a + b, 0) / ratings.length
    if (reviews.length > 0) compAvgReviews = reviews.reduce((a, b) => a + b, 0) / reviews.length
  }

  await supabaseAdmin
    .from('benchmark_snapshots')
    .upsert({
      tenant_id: tenantId,
      business_id: businessId,
      avg_rating: avgRating != null ? Number(avgRating.toFixed(2)) : null,
      total_reviews: totalReviews,
      response_rate: responseRate != null ? Number(responseRate.toFixed(2)) : null,
      positive_rate: positiveRate != null ? Number(positiveRate.toFixed(2)) : null,
      competitors_avg_rating: compAvgRating != null ? Number(compAvgRating.toFixed(2)) : null,
      competitors_avg_reviews: compAvgReviews != null ? Number(compAvgReviews.toFixed(2)) : null,
      competitor_count: comps.length,
      snapshot_date: today,
    }, { onConflict: 'business_id,snapshot_date' })
}

export async function runBenchmarkSnapshotJob(): Promise<void> {
  logger.info('[benchmark-snapshot] Iniciando job')

  const { data: tenants } = await supabaseAdmin
    .from('tenants')
    .select('id')
    .eq('is_active', true)
    .in('subscription_status', ['active', 'trial'])

  if (!tenants?.length) return

  let total = 0
  for (const tenant of tenants) {
    const { data: businesses } = await supabaseAdmin
      .from('monitored_businesses')
      .select('id')
      .eq('tenant_id', tenant.id)
      .eq('is_active', true)

    for (const biz of businesses ?? []) {
      try {
        await snapshotBusiness(tenant.id, biz.id)
        total++
      } catch (err) {
        logger.error('[benchmark-snapshot] Erro em business', { business_id: biz.id, err })
      }
    }
  }

  logger.info('[benchmark-snapshot] Job concluído', { snapshots_created: total })
}
