import { supabase } from '../lib/supabase.js'
import { ingestReviews } from '../lib/ingest.js'
import { fetchInstagramComments, fetchInstagramMentions, fetchInstagramHashtags } from '../lib/apify.js'
import type { ChannelConnector, JobResult } from '../types/connector.js'
import type { NormalizedReview } from '../types/review.js'

export async function run(connector: ChannelConnector): Promise<JobResult> {
  const { business_id, id: connector_id, config } = connector
  const username = (config?.instagram_username || config?.username || '') as string
  const hashtags = (config?.hashtags as string || '').split(',').map(h => h.trim()).filter(Boolean)

  if (!username) {
    return { reviews_fetched: 0, reviews_new: 0, reviews_updated: 0, error: 'Username do Instagram não configurado no conector' }
  }

  try {
    // Buscar tenant_id primeiro para log de consumo
    const { data: biz } = await supabase
      .from('monitored_businesses')
      .select('tenant_id')
      .eq('id', business_id)
      .single()

    if (!biz) throw new Error('Empresa não encontrada para o conector')

    const ctx = { tenant_id: biz.tenant_id, connector_id }

    // 1. Coleta Multidimensional
    const [ownComments, mentions, ...tagResults] = await Promise.all([
      fetchInstagramComments(username, 20, ctx),
      fetchInstagramMentions(username, 20, ctx),
      ...hashtags.map(tag => fetchInstagramHashtags(tag, 20, ctx))
    ])
    
    // Unificar todos os resultados
    const allRaw = [
      ...ownComments.map(c => ({ ...c, source: 'post_comment' })),
      ...mentions.map(m => ({ ...m, source: 'mention' })),
      ...tagResults.flat().map(t => ({ ...t, source: 'hashtag' }))
    ]
    
    const normalized: NormalizedReview[] = allRaw.map(item => ({
      tenant_id: biz.tenant_id,
      business_id: business_id,
      connector_id: connector_id,
      channel: 'instagram',
      external_id: String(item.id),
      body: item.text,
      author_name: item.ownerUsername || item.author,
      published_at: new Date(item.timestamp).toISOString(),
      sentiment: 'unanalyzed',
      url: item.url,
      raw_data: { ...item, scraper_source: item.source }
    }))

    // Ingerir no banco (deduplicação automática pelo external_id)
    const stats = await ingestReviews(normalized, 'instagram', connector_id, business_id)

    return {
      reviews_fetched: normalized.length,
      reviews_new: stats.reviews_new,
      reviews_updated: stats.reviews_updated
    }

  } catch (err) {
    return {
      reviews_fetched: 0,
      reviews_new: 0,
      reviews_updated: 0,
      error: err instanceof Error ? err.message : String(err)
    }
  }
}
