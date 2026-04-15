import 'dotenv/config'
import { supabase } from '../src/lib/supabase.js'
import { checkAlerts } from '../src/lib/alerts.js'
import type { NormalizedReview } from '../src/types/review.js'

async function retroActiveAlerts() {
  console.log('🔄 Buscando reviews das últimas 2 horas para retro-análise de alertas...')
  const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString()

  // Buscar reviews recentes
  const { data: reviews, error } = await supabase
    .from('reviews')
    .select('*')
    .gte('published_at', twoHoursAgo)

  if (error || !reviews) {
    console.error('Falha:', error?.message)
    return
  }

  console.log(`Encontrados ${reviews.length} reviews recentes. Rodando motor de alertas...`)

  // Separar reviews por business e channel para injetar corretament no checkAlerts
  for (const r of reviews) {
    // Normalizar temporariamente do bd para a tipagem NormalizedReview
    const normalized: NormalizedReview = {
      tenant_id: r.tenant_id,
      business_id: r.business_id,
      connector_id: r.connector_id,
      channel: r.channel,
      external_id: r.external_id,
      published_at: r.published_at,
      body: r.body,
      title: r.title,
      sentiment: r.sentiment,
      dissatisfaction_score: r.dissatisfaction_score,
      author_name: r.author_name,
      sentiment_summary: r.sentiment_summary,
      sentiment_result: {
        alert_reason: r.sentiment_summary,
        method: 'gemini',
        sentiment: r.sentiment,
        confidence: 0.99,
        topics: [],
        dissatisfaction_score: r.dissatisfaction_score
      }
    }

    await checkAlerts([normalized], r.business_id, r.channel)
  }

  console.log('✅ Retro-análise concluída!')
}

retroActiveAlerts().catch(console.error)
