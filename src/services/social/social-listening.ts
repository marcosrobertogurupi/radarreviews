import { supabase } from '../../lib/supabase.js'
import { fetchInstagramMentions, fetchInstagramHashtags } from '../../lib/apify.js'
import { ingestReviews } from '../../lib/ingest.js'
import { analyzeMetaSentiment } from '../ai/metaSentiment.js'
import type { NormalizedReview } from '../../types/review.js'

/**
 * Executa a coleta de Social Listening para um conector específico
 */
export async function runSocialListening(connector: any): Promise<{ fetched: number }> {
  const { business_id, config } = connector
  const tenantId = connector.monitored_businesses?.tenant_id
  
  if (!tenantId) return { fetched: 0 }

  const hashtags = config?.hashtags || []
  const mentions = config?.mentions || []
  
  if (hashtags.length === 0 && mentions.length === 0) return { fetched: 0 }

  const allItems: any[] = []

  // 1. Coletar Menções (@)
  for (const m of mentions) {
    try {
      const items = await fetchInstagramMentions(m, 10)
      allItems.push(...items.map((i: any) => ({ ...i, type: 'mention', source: m })))
    } catch (err) {
      console.error(`[SocialListening] Erro em menção ${m}:`, err)
    }
  }

  // 2. Coletar Hashtags (#)
  for (const h of hashtags) {
    try {
      const items = await fetchInstagramHashtags(h, 10)
      allItems.push(...items.map((i: any) => ({ ...i, type: 'hashtag', source: h })))
    } catch (err) {
      console.error(`[SocialListening] Erro em hashtag ${h}:`, err)
    }
  }

  if (allItems.length === 0) return { fetched: 0 }

  // 3. Normalizar e Analisar
  const normalized: NormalizedReview[] = []
  for (const item of allItems) {
    const sentiment = await analyzeMetaSentiment(item.text)
    normalized.push({
      tenant_id: tenantId,
      business_id: business_id,
      connector_id: connector.id,
      channel: 'instagram',
      external_id: `sl_${item.type}_${item.id}`,
      body: item.text,
      author_name: item.author,
      published_at: item.timestamp,
      sentiment: sentiment.label,
      dissatisfaction_score: Math.round(sentiment.score * 100),
      sentiment_summary: sentiment.summary,
      tags: ['social_listening', item.type, item.source],
      url: item.url,
      raw_data: item
    })
  }

  // 4. Ingerir
  await ingestReviews(normalized, 'instagram', connector.id, business_id)

  return { fetched: normalized.length }
}
