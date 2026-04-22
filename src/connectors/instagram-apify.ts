import { supabase } from '../lib/supabase.js'
import { ingestReviews } from '../lib/ingest.js'
import { analyzeMetaSentiment } from '../services/ai/metaSentiment.js'
import { fetchInstagramComments } from '../lib/apify.js'
import type { ChannelConnector, JobResult } from '../types/connector.js'
import type { NormalizedReview } from '../types/review.js'

export async function run(connector: ChannelConnector): Promise<JobResult> {
  const { business_id, id: connector_id, config } = connector
  const username = config?.instagram_username || config?.username

  if (!username) {
    return { reviews_fetched: 0, reviews_new: 0, reviews_updated: 0, error: 'Username do Instagram não configurado no conector' }
  }

  try {
    const rawComments = await fetchInstagramComments(username, 20)
    
    // Buscar tenant_id para a ingestão
    const { data: biz } = await supabase
      .from('monitored_businesses')
      .select('tenant_id')
      .eq('id', business_id)
      .single()

    if (!biz) throw new Error('Empresa não encontrada para o conector')

    const normalized: NormalizedReview[] = []

    for (const comment of rawComments) {
      normalized.push({
        tenant_id: biz.tenant_id,
        business_id: business_id,
        connector_id: connector_id,
        channel: 'instagram',
        external_id: comment.id,
        body: comment.text,
        author_name: comment.ownerUsername,
        published_at: comment.timestamp,
        sentiment: 'unanalyzed', // Deixar o ingestReviews analisar via IA
        url: comment.url,
        raw_data: comment
      })
    }

    // Ingerir no banco (o ingestReviews cuidará da IA, deduplicação e alertas)
    const stats = await ingestReviews(normalized, 'instagram', connector_id, business_id)

    return {
      reviews_fetched: normalized.length,
      reviews_new: stats.inserted,
      reviews_updated: stats.updated
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
