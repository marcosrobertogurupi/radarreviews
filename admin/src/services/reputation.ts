import { supabase } from '../lib/supabase'
import type { Review } from '../lib/supabase'

export interface ReputationScoreData {
  score: number
  label: string
  color: string
  emoji: string
  change: number // vs mês anterior
  breakdown: {
    avgRating: number
    positiveRate: number
    trend: 'improving' | 'stable' | 'worsening'
    totalReviews: number
  }
}

export interface TimelinePoint {
  date: string
  score: number
  avgRating: number
  volume: number
}

/**
 * Calcula o Reputation Score (0-100) e dados da Timeline
 */
export async function getReputationData(tenantId: string | null): Promise<{
  current: ReputationScoreData
  timeline: TimelinePoint[]
}> {
  const now = new Date()
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString()
  const sixtyDaysAgo = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000).toISOString()

  // 1. Buscar reviews dos últimos 60 dias
  let query = supabase.from('reviews')
    .select('rating, sentiment, published_at')
    .gte('published_at', sixtyDaysAgo)

  if (tenantId) query = query.eq('tenant_id', tenantId)
  
  const { data: reviews } = await query
  if (!reviews || reviews.length === 0) {
    return {
      current: emptyScore(),
      timeline: []
    }
  }

  // 2. Separar períodos
  const currentReviews = reviews.filter(r => r.published_at >= thirtyDaysAgo)
  const previousReviews = reviews.filter(r => r.published_at < thirtyDaysAgo)

  // 3. Calcular Score Atual
  const currentScore = calculateScore(currentReviews, previousReviews)
  
  // 4. Calcular Timeline (Agregado por semana nos últimos 90 dias - ou o que tivermos)
  // Para simplificar agora, faremos por dia nos últimos 30 dias
  const timeline = calculateTimeline(reviews, thirtyDaysAgo)

  return {
    current: currentScore,
    timeline
  }
}

function calculateScore(current: any[], previous: any[]): ReputationScoreData {
  if (current.length === 0) return emptyScore()

  // Média ponderada de notas (0-1)
  const getAvg = (list: any[]) => {
    const ratings = list.map(r => {
      if (r.rating != null) return r.rating / 5
      if (r.sentiment === 'positive') return 1
      if (r.sentiment === 'neutral') return 0.6
      return 0.2
    })
    return ratings.reduce((a, b) => a + b, 0) / ratings.length
  }

  const currentAvg = getAvg(current)
  const previousAvg = previous.length > 0 ? getAvg(previous) : currentAvg

  // Taxa de positivos (0-1)
  const posRate = current.filter(r => r.sentiment === 'positive').length / current.length
  
  // Tendência
  const diff = currentAvg - previousAvg
  const trendScore = diff > 0.05 ? 0.1 : (diff < -0.05 ? -0.1 : 0)

  // Volume normalizado (log)
  const volScore = Math.min(1, Math.log10(current.length + 1) / Math.log10(100))

  // ReputationScore = ((media_notas × 0.50) + (taxa_pos × 0.25) + (tendencia × 0.15) + (volume × 0.10)) * 100
  const finalScore = Math.round(
    ((currentAvg * 0.50) + (posRate * 0.25) + (trendScore * 0.15) + (volScore * 0.10)) * 100
  )

  const clampedScore = Math.max(0, Math.min(100, finalScore))

  // Faixas
  let label = 'Crítico', color = '#DC2626', emoji = '↓'
  if (clampedScore >= 80) { label = 'Excelente'; color = '#059669'; emoji = '★' }
  else if (clampedScore >= 60) { label = 'Bom'; color = '#2563EB'; emoji = '↑' }
  else if (clampedScore >= 40) { label = 'Regular'; color = '#D97706'; emoji = '→' }

  return {
    score: clampedScore,
    label,
    color,
    emoji,
    change: Math.round((currentAvg - previousAvg) * 100), // Diferença de "pontos"
    breakdown: {
      avgRating: currentAvg * 5,
      positiveRate: Math.round(posRate * 100),
      trend: diff > 0.05 ? 'improving' : (diff < -0.05 ? 'worsening' : 'stable'),
      totalReviews: current.length
    }
  }
}

function calculateTimeline(reviews: any[], since: string): TimelinePoint[] {
  // Agrupar por dia para os últimos 30 dias
  const days: Record<string, any[]> = {}
  reviews.filter(r => r.published_at >= since).forEach(r => {
    const d = r.published_at.split('T')[0]
    if (!days[d]) days[d] = []
    days[d].push(r)
  })

  return Object.entries(days).map(([date, list]) => {
    const avg = list.reduce((a, b) => a + (b.rating || (b.sentiment === 'positive' ? 5 : 3)), 0) / list.length
    return {
      date,
      score: 0, // Poderíamos calcular o score diário se necessário
      avgRating: Number(avg.toFixed(1)),
      volume: list.length
    }
  }).sort((a, b) => a.date.localeCompare(b.date))
}

function emptyScore(): ReputationScoreData {
  return {
    score: 0,
    label: 'Sem dados',
    color: '#6B7280',
    emoji: '—',
    change: 0,
    breakdown: { avgRating: 0, positiveRate: 0, trend: 'stable', totalReviews: 0 }
  }
}
