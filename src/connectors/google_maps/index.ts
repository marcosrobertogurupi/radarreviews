import 'dotenv/config'
import axios from 'axios'
import { z } from 'zod'
import { logger } from '../../lib/logger.js'
import { ingestReviews } from '../../lib/ingest.js'
import { scrapeGoogleMapsReviews } from './scraper.js'
import { mapReviewToNormalized } from './mapper.js'
import type { ChannelConnector, JobResult } from '../../types/connector.js'
import type { NormalizedReview } from '../../types/review.js'
import type { GoogleMapsConfig } from './types.js'

// ── Constantes da API (Fallback) ──────────────────────────────────────────────

const CHANNEL = 'google_maps' as const
const PLACES_NEW = 'https://places.googleapis.com/v1'
const PLACES_OLD = 'https://maps.googleapis.com/maps/api/place/details/json'
const FIELD_MASK = 'id,displayName,rating,userRatingCount,reviews'

// ── Schemas Zod ──────────────────────────────────────────────────────────────

const GoogleReviewSchema = z.object({
  name: z.string(),
  rating: z.number().optional(),
  text: z.object({ text: z.string().optional() }).optional(),
  authorAttribution: z.object({ displayName: z.string().optional() }).optional(),
  publishTime: z.string(),
})

const GooglePlaceResponseSchema = z.object({
  reviews: z.array(GoogleReviewSchema).optional().default([]),
})

const OldPlaceResponseSchema = z.object({
  result: z.object({
    reviews: z.array(z.object({
      author_name: z.string().optional(),
      rating: z.number().optional(),
      text: z.string().optional(),
      time: z.number(),
    })).optional().default([]),
  }).optional(),
  status: z.string(),
})

import { runGoogleMapsOAuth } from '../google-maps-oauth.js'
import { getGoogleTokens } from '../../api/googleAuth.js'
import { fetchGoogleMapsReviewsApify } from '../../lib/apify.js'

// ── Função Principal ──────────────────────────────────────────────────────────

export async function run(connector: ChannelConnector): Promise<JobResult> {
  const result: JobResult = { reviews_fetched: 0, reviews_new: 0, reviews_updated: 0 }
  const placeId = connector.external_id

  if (!placeId) {
    result.error = `Conector ${connector.id} sem external_id (place_id obrigatório).`
    return result
  }

  const config = (connector.config ?? {}) as unknown as GoogleMapsConfig
  const jobType = !connector.last_sync_at ? 'backfill' : 'incremental'
  const maxReviews = config.max_reviews ?? (jobType === 'backfill' ? 50 : 100)

  // ── CAMADA 1: Google Business Profile OAuth API (Custo ZERO, Sem Limite de 5) ──
  const tokens = await getGoogleTokens(connector.tenant_id)
  if (tokens?.access_token) {
    logger.info(`[${CHANNEL}] Executando via Camada 1: Google Business Profile OAuth API`)
    return await runGoogleMapsOAuth(connector)
  }

  // ── CAMADA 2: Apify Actor Scraper (Com Ordenação Newest e Corte por Data) ────
  if (process.env['APIFY_TOKEN']) {
    try {
      logger.info(`[${CHANNEL}] Executando via Camada 2: Apify Actor (${jobType})`, { placeId, lastSyncAt: connector.last_sync_at })
      const rawApify = await fetchGoogleMapsReviewsApify(
        placeId,
        maxReviews,
        connector.last_sync_at,
        { tenant_id: connector.tenant_id, connector_id: connector.id },
        jobType
      )

      if (rawApify.length > 0) {
        const apifyNormalized: NormalizedReview[] = rawApify.map(raw => normalizeApifyItem(raw, connector))
        result.reviews_fetched = apifyNormalized.length

        const ingest = await ingestReviews(apifyNormalized, CHANNEL, connector.id, connector.business_id)
        result.reviews_new = ingest.reviews_new
        result.reviews_updated = ingest.reviews_updated

        logger.info(`[${CHANNEL}] Apify retornou ${apifyNormalized.length} reviews (${ingest.reviews_new} novos).`)
        return result
      }
    } catch (apifyErr: any) {
      logger.warn(`[${CHANNEL}] Falha na Camada 2 (Apify): ${apifyErr.message}. Alternando para fallback...`)
      if (apifyErr.message?.includes('Bloqueio de Cota')) {
        result.error = apifyErr.message
        return result
      }
    }
  }

  // ── CAMADA 3: Fallback Legado (APIs Públicas + Playwright) ────────────────────
  logger.info(`[${CHANNEL}] Executando via Camada 3: Fallback Legado (API Places + Playwright)...`)
  let reviews: NormalizedReview[] = []
  let scraperFailed = false
  let apiOldFailed = false
  let apiNewFailed = false

  const apiReviews: NormalizedReview[] = []

  // Tentar API Nova
  try {
    const novas = await fetchFromApiNew(placeId)
    apiReviews.push(...novas.map(r => normalizeNew(r, connector)))
  } catch (err) {
    apiNewFailed = true
  }

  // Tentar API Legada
  try {
    const legadas = await fetchFromApiOld(placeId)
    apiReviews.push(...legadas.map(r => normalizeOld(r, connector)))
  } catch (err) {
    apiOldFailed = true
  }

  reviews = apiReviews

  const useScraper = config.mode === 'scraping' || config.use_scraper !== false
  if (useScraper) {
    try {
      const rawScraped = await scrapeGoogleMapsReviews(placeId, config)
      if (rawScraped.length > 0) {
        const scrapedNormalized = rawScraped.map(r => mapReviewToNormalized(r, connector))
        const existingIds = new Set(reviews.map(r => r.external_id))
        for (const sr of scrapedNormalized) {
          if (!existingIds.has(sr.external_id)) {
            reviews.push(sr)
          }
        }
      }
    } catch (err) {
      scraperFailed = true
    }
  }

  if (reviews.length === 0) {
    const scraperOk = useScraper ? !scraperFailed : true
    const apiOldOk = !apiOldFailed
    const apiNewOk = !apiNewFailed

    if (!scraperOk && !apiOldOk && !apiNewOk) {
      result.error = 'Todas as estratégias (Scraper e API) falharam ou não encontraram reviews.'
    } else {
      logger.info(`[${CHANNEL}] Nenhum review encontrado ou estratégias vazias`, { connector_id: connector.id })
    }
    return result
  }

  result.reviews_fetched = reviews.length
  const ingest = await ingestReviews(reviews, CHANNEL, connector.id, connector.business_id)
  result.reviews_new = ingest.reviews_new
  result.reviews_updated = ingest.reviews_updated

  return result
}

function normalizeApifyItem(raw: any, connector: ChannelConnector): NormalizedReview {
  const reviewId = raw.reviewId || raw.id || raw.cid || `apify_gmaps_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
  const publishedAt = raw.publishedAtDate || raw.date || (raw.timestamp ? new Date(raw.timestamp).toISOString() : new Date().toISOString())

  return {
    tenant_id: connector.tenant_id,
    business_id: connector.business_id,
    connector_id: connector.id,
    channel: CHANNEL,
    external_id: String(reviewId),
    published_at: publishedAt,
    body: raw.text || raw.reviewText || raw.caption || '',
    author_name: raw.name || raw.authorName || raw.reviewerName || 'Anônimo',
    rating: raw.stars || raw.rating || undefined,
    sentiment: 'unanalyzed',
    url: raw.reviewUrl || `https://www.google.com/maps/place/?q=place_id:${connector.external_id}`,
    raw_data: raw
  }
}

// ── Helpers da API ────────────────────────────────────────────────────────────

async function fetchFromApiOld(placeId: string) {
  const apiKey = process.env['GOOGLE_MAPS_API_KEY']
  if (!apiKey) throw new Error('API Key ausente')

  const resp = await axios.get(PLACES_OLD, {
    params: { place_id: placeId, fields: 'reviews', reviews_sort: 'newest', language: 'pt', key: apiKey }
  })
  return OldPlaceResponseSchema.parse(resp.data).result?.reviews ?? []
}

async function fetchFromApiNew(placeId: string) {
  const apiKey = process.env['GOOGLE_MAPS_API_KEY']
  if (!apiKey) throw new Error('API Key ausente')

  const resp = await axios.get(`${PLACES_NEW}/places/${placeId}`, {
    headers: { 'X-Goog-Api-Key': apiKey, 'X-Goog-FieldMask': FIELD_MASK }
  })
  return GooglePlaceResponseSchema.parse(resp.data).reviews
}

// ── Normalizadores da API ─────────────────────────────────────────────────────

function normalizeOld(raw: any, connector: ChannelConnector): NormalizedReview {
  return {
    tenant_id: connector.tenant_id,
    business_id: connector.business_id,
    connector_id: connector.id,
    channel: CHANNEL,
    external_id: `api_old_${raw.time}_${raw.author_name}`,
    published_at: new Date(raw.time * 1000).toISOString(),
    body: raw.text || '',
    author_name: raw.author_name || 'Anônimo',
    rating: raw.rating,
    sentiment: 'unanalyzed',
    url: `https://www.google.com/maps/place/?q=place_id:${connector.external_id}`,
    raw_data: raw
  }
}

function normalizeNew(raw: any, connector: ChannelConnector): NormalizedReview {
  const id = raw.name.split('/reviews/').pop() || raw.name
  return {
    tenant_id: connector.tenant_id,
    business_id: connector.business_id,
    connector_id: connector.id,
    channel: CHANNEL,
    external_id: id,
    published_at: new Date(raw.publishTime).toISOString(),
    body: raw.text?.text || '',
    author_name: raw.authorAttribution?.displayName || 'Anônimo',
    rating: raw.rating,
    sentiment: 'unanalyzed',
    url: `https://www.google.com/maps/place/?q=place_id:${connector.external_id}`,
    raw_data: raw
  }
}
