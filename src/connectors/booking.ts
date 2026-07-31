import { scrapeBookingReviews } from '../lib/apify.js'
import { ingestReviews } from '../lib/ingest.js'
import { logger } from '../lib/logger.js'
import type { ChannelConnector, JobResult } from '../types/connector.js'
import type { NormalizedReview } from '../types/review.js'
import { createHash } from 'node:crypto'

const CHANNEL = 'booking' as const

/**
 * Conector de Coleta do Booking.com via Apify.
 */
export async function run(connector: ChannelConnector): Promise<JobResult> {
  const hotelUrl = (connector.config?.hotel_url as string) || connector.external_id

  if (!hotelUrl || typeof hotelUrl !== 'string' || !hotelUrl.startsWith('http')) {
    const errorMsg = `[booking] URL do hotel não configurada ou inválida no conector ${connector.id}`
    logger.error(errorMsg, { connector_id: connector.id })
    return {
      reviews_fetched: 0,
      reviews_new: 0,
      reviews_updated: 0,
      error: errorMsg,
      error_type: 'fatal',
    }
  }

  logger.info(`[booking] Iniciando coleta de reviews via Apify`, {
    connector_id: connector.id,
    hotelUrl,
  })

  try {
    const items = await scrapeBookingReviews(
      hotelUrl,
      30,
      {
        tenant_id: connector.tenant_id,
        connector_id: connector.id,
      },
      'incremental'
    )

    logger.info(`[booking] ${items.length} itens extraídos via Apify`, {
      connector_id: connector.id,
    })

    const normalizedReviews: NormalizedReview[] = []

    for (const item of items) {
      const normalized = normalizeBookingReview(item, connector, hotelUrl)
      if (normalized) {
        normalizedReviews.push(normalized)
      }
    }

    if (normalizedReviews.length === 0) {
      logger.info(`[booking] Nenhum review válido para ingestão`, { connector_id: connector.id })
      return {
        reviews_fetched: items.length,
        reviews_new: 0,
        reviews_updated: 0,
      }
    }

    const ingestResult = await ingestReviews(
      normalizedReviews,
      CHANNEL,
      connector.id,
      connector.business_id
    )

    logger.info(`[booking] Ingestão concluída com sucesso`, {
      connector_id: connector.id,
      fetched: items.length,
      new: ingestResult.reviews_new,
      updated: ingestResult.reviews_updated,
    })

    return {
      reviews_fetched: items.length,
      reviews_new: ingestResult.reviews_new,
      reviews_updated: ingestResult.reviews_updated,
    }
  } catch (err: any) {
    const errorMsg = err.message || 'Erro desconhecido ao coletar do Booking'
    logger.error(`[booking] Falha durante sincronização: ${errorMsg}`, {
      connector_id: connector.id,
      stack: err.stack,
    })

    return {
      reviews_fetched: 0,
      reviews_new: 0,
      reviews_updated: 0,
      error: errorMsg,
      error_type: err.message?.includes('Apify') ? 'transient' : 'fatal',
    }
  }
}

/**
 * Normaliza o item extraído do Booking.com para o formato estrito NormalizedReview.
 */
export function normalizeBookingReview(
  item: any,
  connector: ChannelConnector,
  hotelUrl: string
): NormalizedReview | null {
  if (!item || typeof item !== 'object') return null

  // 1. Extração do ID Externo
  let rawId = item.id || item.reviewId || item.guid || item.url
  if (!rawId) {
    const author = item.authorName || item.userName || 'anonymous'
    const date = item.date || item.reviewDate || item.publishedDate || ''
    const text = item.text || item.positiveText || item.negativeText || ''
    rawId = createHash('md5').update(`${author}-${date}-${text}`).digest('hex')
  }
  const external_id = String(rawId)

  // 2. Normalização da Nota (1 a 10 no Booking -> 0 a 5 no Reputei)
  let rating: number | undefined = undefined
  const rawScore = Number(item.score ?? item.rating ?? item.reviewScore ?? item.overallScore ?? 0)
  if (!isNaN(rawScore) && rawScore > 0) {
    if (rawScore > 5) {
      rating = Math.round((rawScore / 2) * 10) / 10
    } else {
      rating = Math.round(rawScore * 10) / 10
    }
    // Clampar para o intervalo de 0 a 5
    rating = Math.min(5, Math.max(0, rating))
  }

  // 3. Título
  const title = (item.title || item.reviewTitle || item.headline || '').trim() || undefined

  // 4. Texto Bi-partido (Positivo / Negativo)
  const pos = (item.positiveText || item.likedText || item.positives || '').trim()
  const neg = (item.negativeText || item.dislikedText || item.negatives || '').trim()
  const gen = (item.text || item.reviewText || item.body || '').trim()

  const bodyParts: string[] = []
  if (pos) bodyParts.push(`👍 Positivo: ${pos}`)
  if (neg) bodyParts.push(`👎 Negativo: ${neg}`)
  if (!pos && !neg && gen) bodyParts.push(gen)

  const body = bodyParts.join('\n\n') || undefined

  // 5. Data de Publicação
  let published_at: string
  const rawDate = item.date || item.reviewDate || item.publishedDate || item.createdDate
  if (rawDate) {
    const parsed = new Date(rawDate)
    published_at = !isNaN(parsed.getTime()) ? parsed.toISOString() : new Date().toISOString()
  } else {
    published_at = new Date().toISOString()
  }

  // 6. Autor
  let author_name = (item.authorName || item.userName || item.reviewerName || '').trim()
  const country = item.userCountry || item.country
  if (country && author_name) {
    author_name = `${author_name} (${country})`
  } else if (!author_name) {
    author_name = 'Hóspede Booking.com'
  }

  // 7. Tags (Categorias de sub-avaliação se existirem)
  const tags: string[] = ['booking']
  if (item.subRatings && typeof item.subRatings === 'object') {
    for (const [key, val] of Object.entries(item.subRatings)) {
      if (typeof val === 'number') {
        tags.push(`${key}: ${val}`)
      }
    }
  }

  return {
    tenant_id: connector.tenant_id,
    business_id: connector.business_id,
    connector_id: connector.id,
    channel: CHANNEL,
    external_id,
    rating,
    title,
    body,
    author_name,
    url: hotelUrl,
    language: item.language || 'pt',
    tags,
    sentiment: 'unanalyzed',
    published_at,
    raw_data: item,
  }
}
