/**
 * Conector Google Maps via Google Business Profile OAuth API (Camada 1 - Custo ZERO)
 * Usa o token OAuth do tenant para buscar todas as avaliações com paginação nativa (até 50/página)
 */

import axios from 'axios'
import { getGoogleTokens } from '../api/googleAuth.js'
import { logger } from '../lib/logger.js'
import { ingestReviews } from '../lib/ingest.js'
import type { ChannelConnector, JobResult } from '../types/connector.js'
import type { NormalizedReview } from '../types/review.js'

const CHANNEL = 'google_maps' as const
const MYBUSINESS_BASE = 'https://mybusiness.googleapis.com/v4'

export async function runGoogleMapsOAuth(connector: ChannelConnector): Promise<JobResult> {
  const result: JobResult = { reviews_fetched: 0, reviews_new: 0, reviews_updated: 0 }

  const tokens = await getGoogleTokens(connector.tenant_id)
  if (!tokens || !tokens.access_token) {
    result.error = 'Tenant sem credenciais ativas do Google Business Profile OAuth.'
    result.is_auth_error = true
    return result
  }

  const locationId = connector.external_id
  if (!locationId) {
    result.error = `Conector ${connector.id} sem external_id (locationId obrigatório).`
    return result
  }

  logger.info(`[${CHANNEL}:OAuth] Iniciando busca via Google Business Profile API`, {
    connector_id: connector.id,
    location_id: locationId
  })

  const reviews: NormalizedReview[] = []
  let pageToken: string | undefined = undefined
  let totalFetched = 0
  const maxPages = 10 // Até 500 reviews por job no OAuth

  try {
    for (let page = 0; page < maxPages; page++) {
      const resp: any = await axios.get(`${MYBUSINESS_BASE}/accounts/-/locations/${locationId}/reviews`, {
        headers: {
          Authorization: `Bearer ${tokens.access_token}`,
          'Content-Type': 'application/json'
        },
        params: {
          pageSize: 50,
          ...(pageToken ? { pageToken } : {})
        }
      })

      const rawReviews = (resp.data.reviews ?? []) as any[]
      if (rawReviews.length === 0) break

      for (const raw of rawReviews) {
        reviews.push(normalizeGbpReview(raw, connector))
      }

      totalFetched += rawReviews.length
      pageToken = resp.data.nextPageToken

      if (!pageToken) break
    }

    logger.info(`[${CHANNEL}:OAuth] Busca concluída. Total coletado: ${reviews.length}`)

    if (reviews.length === 0) {
      return result
    }

    result.reviews_fetched = reviews.length
    const ingest = await ingestReviews(reviews, CHANNEL, connector.id, connector.business_id)

    result.reviews_new = ingest.reviews_new
    result.reviews_updated = ingest.reviews_updated

    return result

  } catch (err: any) {
    const status = err.response?.status
    const msg = err.response?.data?.error?.message || err.message || String(err)
    logger.error(`[${CHANNEL}:OAuth] Erro na API do Google Business Profile:`, { status, msg })

    result.error = `Google Business Profile API: ${msg}`
    if (status === 401 || status === 403) {
      result.is_auth_error = true
    }
    return result
  }
}

function normalizeGbpReview(raw: any, connector: ChannelConnector): NormalizedReview {
  // raw.name no formato: "accounts/{accountId}/locations/{locationId}/reviews/{reviewId}"
  const reviewId = raw.reviewId || (raw.name ? raw.name.split('/reviews/').pop() : `gbp_${Date.now()}`)
  
  const ratingMap: Record<string, number> = {
    ONE: 1,
    TWO: 2,
    THREE: 3,
    FOUR: 4,
    FIVE: 5
  }

  const rating = raw.starRating ? (ratingMap[raw.starRating] ?? 5) : undefined

  return {
    tenant_id: connector.tenant_id,
    business_id: connector.business_id,
    connector_id: connector.id,
    channel: CHANNEL,
    external_id: reviewId,
    published_at: raw.createTime ? new Date(raw.createTime).toISOString() : new Date().toISOString(),
    body: raw.comment || '',
    author_name: raw.reviewer?.displayName || 'Anônimo',
    rating,
    sentiment: 'unanalyzed',
    url: `https://www.google.com/maps/place/?q=place_id:${connector.external_id}`,
    raw_data: raw
  }
}
