import { decrypt } from '../lib/crypto.js'
import { analyzeMetaSentiment } from '../services/ai/metaSentiment.js'
import { supabase } from '../lib/supabase.js'
import { ingestReviews } from '../lib/ingest.js'
import type { NormalizedReview } from '../types/review.js'

/**
 * Job de Polling Fallback para Facebook e Instagram.
 * Busca comentários dos últimos 60 minutos para garantir que nada foi perdido pelo Webhook.
 */
export async function syncMetaSocial(businessId: string, channel: 'facebook' | 'instagram'): Promise<void> {
  const { data: connector } = await supabase
    .from('channel_connectors')
    .select('*, monitored_businesses(tenant_id)')
    .eq('business_id', businessId)
    .eq('channel', channel)
    .eq('status', 'active')
    .single()

  if (!connector || !connector.config?.page_token_enc) return

  const tenantId = (connector.monitored_businesses as any).tenant_id
  const pageToken = decrypt(connector.config.page_token_enc)
  if (!pageToken) {
    console.error(`[MetaPolling] Falha ao descriptografar token para ${channel} em ${businessId}`)
    return
  }

  const since = Math.floor((Date.now() - 3600_000) / 1000) // Última 1 hora
  const reviews: NormalizedReview[] = []

  try {
    if (channel === 'facebook') {
      const fbPageId = connector.fb_page_id
      const url = `https://graph.facebook.com/v19.0/${fbPageId}/feed?fields=id,comments{id,from,message,created_time}&since=${since}&access_token=${pageToken}`
      const res = await fetch(url)
      const data: any = await res.json()

      for (const post of data.data || []) {
        for (const comment of post.comments?.data || []) {
          reviews.push(await normalizeMetaItem(comment, channel, tenantId, businessId, connector.id))
        }
      }
    } else {
      const igUserId = connector.ig_user_id
      const url = `https://graph.facebook.com/v19.0/${igUserId}/media?fields=id,comments{id,username,text,timestamp}&access_token=${pageToken}`
      const res = await fetch(url)
      const data: any = await res.json()

      for (const media of data.data || []) {
        for (const comment of media.comments?.data || []) {
          if (new Date(comment.timestamp).getTime() / 1000 > since) {
            reviews.push(await normalizeMetaItem(comment, channel, tenantId, businessId, connector.id))
          }
        }
      }
    }

    if (reviews.length > 0) {
      await ingestReviews(reviews, channel, connector.id, businessId)
    }

  } catch (err) {
    console.error(`[MetaPolling] Erro ao sincronizar ${channel}:`, err)
  }
}

async function normalizeMetaItem(item: any, channel: string, tenantId: string, businessId: string, connectorId: string): Promise<NormalizedReview> {
  const text = item.message || item.text || ''
  const sentiment = await analyzeMetaSentiment(text)
  
  return {
    tenant_id: tenantId,
    business_id: businessId,
    connector_id: connectorId,
    channel: channel as any,
    external_id: item.id,
    body: text,
    author_name: item.from?.name || item.username || 'Usuário Social',
    published_at: new Date(item.created_time * 1000 || item.timestamp).toISOString(),
    sentiment: sentiment.label,
    dissatisfaction_score: Math.round(sentiment.score * 100),
    sentiment_summary: sentiment.summary,
    raw_data: item
  }
}
