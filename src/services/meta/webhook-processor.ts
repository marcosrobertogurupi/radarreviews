import { analyzeMetaSentiment } from '../ai/metaSentiment.js'
import { supabase } from '../../lib/supabase.js'
import { ingestReviews } from '../../lib/ingest.js'
import type { NormalizedReview } from '../../types/review.js'

/**
 * Processa eventos em tempo real do Webhook do Facebook/Instagram.
 * Filtra apenas comentários e menções com texto.
 */
export async function processMetaWebhookEvent(
  pageId: string,
  change: any
): Promise<void> {
  const value = change.value
  if (!value) return

  // 1. Extrair texto (pode vir em campos diferentes dependendo do objeto)
  const text = value.message || value.comment_text || value.text || ''
  if (text.trim().length < 3) return // Ignorar muito curtos

  // 2. Identificar Canal (Facebook ou Instagram)
  // Nota: o Webhook de Instagram também envia o ID da página FB vinculada
  const isInstagram = change.field === 'comments' || !!value.instagram_customer_id || pageId.startsWith('1784')
  const channel = isInstagram ? 'instagram' : 'facebook'

  // 3. Buscar conector para este tenant/business
  const { data: connector } = await supabase
    .from('channel_connectors')
    .select('*, monitored_businesses(tenant_id)')
    .eq(isInstagram ? 'ig_user_id' : 'fb_page_id', pageId)
    .eq('channel', channel)
    .eq('status', 'active')
    .single()

  if (!connector) {
    console.warn(`[MetaWebhook] Conector não encontrado para ${channel} ID ${pageId}`)
    return
  }

  const tenantId = (connector.monitored_businesses as any).tenant_id
  const businessId = connector.business_id

  // 4. ID único para deduplicação
  const externalId = value.comment_id || value.id || value.message_id
  if (!externalId) return

  // 5. Análise de Sentimento Rica
  const sentiment = await analyzeMetaSentiment(text)

  // 6. Normalizar para o formato Reputei
  const review: NormalizedReview = {
    tenant_id: tenantId,
    business_id: businessId,
    connector_id: connector.id,
    channel: channel,
    external_id: externalId,
    body: text,
    author_name: value.from?.name || value.username || 'Usuário Social',
    published_at: new Date((value.created_time || value.timestamp) * 1000 || Date.now()).toISOString(),
    sentiment: sentiment.label,
    dissatisfaction_score: Math.round(sentiment.score * 100),
    sentiment_summary: sentiment.summary,
    raw_data: value,
    url: value.link || undefined
  }

  // 7. Ingerir no pipeline (Deduplica + Alerta)
  await ingestReviews([review], channel, connector.id, businessId)
}
