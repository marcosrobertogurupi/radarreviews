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

// ── Função Principal ──────────────────────────────────────────────────────────

export async function run(connector: ChannelConnector): Promise<JobResult> {
  const result: JobResult = { reviews_fetched: 0, reviews_new: 0, reviews_updated: 0 }
  const placeId = connector.external_id

  if (!placeId) {
    result.error = `Conector ${connector.id} sem external_id (place_id obrigatório).`
    return result
  }

  const config = (connector.config ?? {}) as unknown as GoogleMapsConfig
  const useScraper = config.mode === 'scraping' || config.use_scraper !== false
  
  let reviews: NormalizedReview[] = []

  let scraperFailed = false
  let apiOldFailed = false
  let apiNewFailed = false

  // 1. Tentar APIs do Google (Novo Primário: Rápido e Estável)
  logger.info(`[${CHANNEL}] Buscando reviews via APIs do Google (Primário)...`)
  const apiReviews: NormalizedReview[] = []

  // Tentar API Nova (Relevant)
  try {
    const novas = await fetchFromApiNew(placeId)
    apiReviews.push(...novas.map(r => normalizeNew(r, connector)))
    logger.info(`[${CHANNEL}] API Nova retornou ${novas.length} reviews.`)
  } catch (err) {
    apiNewFailed = true
    logger.warn(`[${CHANNEL}] API Nova falhou:`, {
      error: err instanceof Error ? err.message : String(err),
    })
  }

  // Tentar API Legada (Newest)
  try {
    const legadas = await fetchFromApiOld(placeId)
    apiReviews.push(...legadas.map(r => normalizeOld(r, connector)))
    logger.info(`[${CHANNEL}] API Legada retornou ${legadas.length} reviews.`)
  } catch (err) {
    apiOldFailed = true
    logger.warn(`[${CHANNEL}] API Legada falhou:`, {
      error: err instanceof Error ? err.message : String(err),
    })
  }

  reviews = apiReviews

  // 2. Tentar Scraping via Playwright (Secundário/Complemento para histórico profundo)
  if (useScraper) {
    try {
      const rawScraped = await scrapeGoogleMapsReviews(placeId, config)
      if (rawScraped.length > 0) {
        const scrapedNormalized = rawScraped.map(r => mapReviewToNormalized(r, connector))
        // Dedup: Adicionar apenas reviews obtidos pelo scraper que não foram pegos pela API
        const existingIds = new Set(reviews.map(r => r.external_id))
        let scrapedAdded = 0
        for (const sr of scrapedNormalized) {
          if (!existingIds.has(sr.external_id)) {
            reviews.push(sr)
            scrapedAdded++
          }
        }
        logger.info(`[${CHANNEL}] Scraper retornou ${scrapedNormalized.length} reviews (${scrapedAdded} novos mesclados).`)
      }
    } catch (err) {
      scraperFailed = true
      logger.warn(`[${CHANNEL}] Scraper falhou:`, {
        error: err instanceof Error ? err.message : String(err),
      })
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

  // 3. Ingestão
  result.reviews_fetched = reviews.length
  const ingest = await ingestReviews(reviews, CHANNEL, connector.id, connector.business_id)
  
  result.reviews_new = ingest.reviews_new
  result.reviews_updated = ingest.reviews_updated

  return result
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
