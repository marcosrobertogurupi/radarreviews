// Conector TripAdvisor
//
// Estratégia em cascata (prioridade: reviews mais recentes):
// 1. Scraper Playwright (primário) — sem limite de 5, pagina, ordena por recentes
//    - Requer listing_url no config ou auto-descoberta via API de detalhes
// 2. API Content v1 (fallback) — limitada a 5 reviews no plano free
//
// Auto-descoberta de URL:
//   Na primeira execução, chama GET /location/{id}/details para obter web_url
//   e persiste em connector.config.listing_url para evitar chamadas futuras.

import 'dotenv/config'
import axios from 'axios'
import { z } from 'zod'
import { supabase } from '../lib/supabase.js'
import { logger } from '../lib/logger.js'
import { ingestReviews } from '../lib/ingest.js'
import { scrapeTripAdvisorReviews } from './tripadvisor-scraper.js'
import type { ChannelConnector, JobResult } from '../types/connector.js'
import type { NormalizedReview } from '../types/review.js'
import { tripadvisorReviewsTaskPost, tripadvisorReviewsTaskGet } from '../lib/dataforseo.js'

// ── Constantes ───────────────────────────────────────────────────

const CHANNEL = 'tripadvisor' as const
const BASE_URL = 'https://api.content.tripadvisor.com/api/v1'

// ── Schemas ──────────────────────────────────────────────────────

const TripAdvisorUserSchema = z.object({
  username: z.string().optional(),
  user_location: z
    .object({
      id: z.string().optional().transform(v => (v === 'null' ? undefined : v)),
      name: z.string().optional(),
    })
    .optional(),
})

const TripAdvisorReviewSchema = z.object({
  id: z.number(),
  lang: z.string().optional(),
  location_id: z.number().optional(),
  published_date: z.string(),
  rating: z.number().min(1).max(5),
  helpful_votes: z.number().default(0),
  rating_image_url: z.string().optional(),
  url: z.string().optional(),
  text: z.string().optional(),
  title: z.string().optional(),
  trip_type: z.string().optional(),
  travel_date: z.string().optional(),
  user: TripAdvisorUserSchema.optional(),
  subratings: z.record(z.unknown()).optional(),
})

const TripAdvisorResponseSchema = z.object({
  data: z.array(TripAdvisorReviewSchema).default([]),
})

const LocationDetailsSchema = z.object({
  web_url: z.string().optional(),
})

type TripAdvisorReview = z.infer<typeof TripAdvisorReviewSchema>

import { fetchTripAdvisorReviewsApify } from '../lib/apify.js'

// ── Função principal ─────────────────────────────────────────────

export async function run(connector: ChannelConnector): Promise<JobResult> {
  const result: JobResult = { reviews_fetched: 0, reviews_new: 0, reviews_updated: 0 }
  logger.info(`[${CHANNEL}] Iniciando sincronização para conector: ${connector.id}`)

  const config = connector.config as Record<string, unknown>
  const maxReviews = (config['max_reviews'] as number | undefined) ?? 50
  const sinceDays = (config['since_days'] as number | undefined) ?? 90
  const jobType = !connector.last_sync_at ? 'backfill' : 'incremental'

  let listingUrl = config['listing_url'] as string | undefined
  let urlPath = config['url_path'] as string | undefined
  let reviews: NormalizedReview[] = []

  // ── 1. Estratégia Apify Actor (Primária — Suporta Sort por Recentes + Corte por Data) ──
  if (process.env['APIFY_TOKEN']) {
    try {
      const targetIdentifier = listingUrl || urlPath || connector.external_id
      if (targetIdentifier) {
        logger.info(`[${CHANNEL}] Iniciando Apify Actor (${jobType}) para: ${targetIdentifier}`)
        const rawApify = await fetchTripAdvisorReviewsApify(
          targetIdentifier,
          maxReviews,
          connector.last_sync_at,
          { tenant_id: connector.tenant_id, connector_id: connector.id },
          jobType
        )

        if (rawApify.length > 0) {
          reviews = rawApify.map(raw => normalizeApifyTripAdvisor(raw, connector))
          logger.info(`[${CHANNEL}] Apify retornou ${reviews.length} reviews`)
        }
      }
    } catch (apifyErr: any) {
      logger.warn(`[${CHANNEL}] Falha no Apify Actor: ${apifyErr.message}. Alternando para fallback...`)
      if (apifyErr.message?.includes('Bloqueio de Cota')) {
        result.error = apifyErr.message
        return result
      }
    }
  }

  // ── 2. Fallback: DataForSEO (Secundário) ──────────────────────
  if (reviews.length === 0 && urlPath) {
    try {
      logger.info(`[${CHANNEL}] Iniciando DataForSEO para url_path: ${urlPath}`)
      const postRes = await tripadvisorReviewsTaskPost(urlPath, `${connector.id}_${Date.now()}`)
      const taskId = postRes.tasks?.[0]?.id

      if (taskId) {
        let dfReviewsRaw: any[] = []
        for (let i = 0; i < 15; i++) {
          await new Promise(r => setTimeout(r, 2000))
          const getRes = await tripadvisorReviewsTaskGet(taskId)
          const task = getRes.tasks?.[0]
          
          if (task?.status_code === 20000) {
            dfReviewsRaw = task.result?.[0]?.items ?? []
            break
          }
        }

        if (dfReviewsRaw.length > 0) {
          reviews = dfReviewsRaw.map(r => normalizeDataForSEO(r, connector))
          logger.info(`[${CHANNEL}] DataForSEO retornou ${reviews.length} reviews`)
        }
      }
    } catch (err) {
      logger.error(`[${CHANNEL}] Erro na DataForSEO:`, { error: err instanceof Error ? err.message : String(err) })
    }
  }

  // ── 3. Fallback: Scraper Playwright (Terciário) ──────────────
  if (reviews.length === 0) {
    if (!listingUrl) {
      listingUrl = await discoverListingUrl(connector)
      if (listingUrl) {
        await supabase
          .from('channel_connectors')
          .update({ config: { ...config, listing_url: listingUrl } })
          .eq('id', connector.id)
      }
    }

    if (listingUrl) {
      try {
        const scraped = await scrapeTripAdvisorReviews(listingUrl, maxReviews, sinceDays)
        if (scraped.length > 0) {
          reviews = scraped.map(r => normalizeScraped(r, connector))
          logger.info(`[${CHANNEL}] Scraper retornou ${reviews.length} reviews`)
        }
      } catch (err) {
        logger.warn(`[${CHANNEL}] Scraper falhou — tentando API fallback`, {
          error: err instanceof Error ? err.message : String(err),
        })
      }
    }
  }

  // ── 4. Fallback: API Oficial ──────────────────────────────────
  if (reviews.length === 0) {
    try {
      const apiItems = await fetchFromApi(connector)
      if (apiItems.length > 0) {
        reviews = apiItems.map(r => normalizeApi(r, connector))
      }
    } catch (err) {
      result.error = err instanceof Error ? err.message : String(err)
      return result
    }
  }

  if (reviews.length === 0) {
    logger.info(`[${CHANNEL}] Nenhum review encontrado`, { connector_id: connector.id })
    return result
  }

  // ── 4. Ingestão ───────────────────────────────────────────────

  result.reviews_fetched = reviews.length
  const ingest = await ingestReviews(reviews, CHANNEL, connector.id, connector.business_id)
  result.reviews_new = ingest.reviews_new
  result.reviews_updated = ingest.reviews_updated

  logger.info(`[${CHANNEL}] Job concluído`, {
    connector_id: connector.id,
    reviews_fetched: result.reviews_fetched,
    reviews_new: result.reviews_new,
    reviews_updated: result.reviews_updated,
  })

  return result
}

// ── Auto-descoberta de URL ────────────────────────────────────────

async function discoverListingUrl(connector: ChannelConnector): Promise<string | undefined> {
  const apiKey = process.env['TRIPADVISOR_API_KEY']
  if (!apiKey || !connector.external_id) return undefined

  try {
    const locationId = connector.external_id.replace(/\D/g, '')
    const resp = await axios.get(`${BASE_URL}/location/${locationId}/details`, {
      params: { key: apiKey, language: 'pt' },
      headers: { accept: 'application/json' },
      timeout: 10_000,
    })
    const parsed = LocationDetailsSchema.safeParse(resp.data)
    return parsed.success ? parsed.data.web_url : undefined
  } catch (err) {
    logger.warn(`[${CHANNEL}] Falha ao buscar detalhes do local`, {
      error: err instanceof Error ? err.message : String(err),
    })
    return undefined
  }
}

// Extrai URL base da listagem a partir da URL de um review individual
// ShowUserReviews-g123-d456-r789... → Hotel_Review-g123-d456-Reviews-...
function extractListingUrlFromReviewUrl(reviewUrl: string): string | undefined {
  try {
    // URL de review: https://www.tripadvisor.com.br/ShowUserReviews-g123-d456-r789-Name.html
    // Transforma em: https://www.tripadvisor.com.br/Hotel_Review-g123-d456-Reviews-Name.html
    const m = reviewUrl.match(/(https?:\/\/[^/]+)\/ShowUserReviews-(g\d+-d\d+)-r\d+-(.+\.html)/)
    if (m) return `${m[1]}/Hotel_Review-${m[2]}-Reviews-${m[3]}`
    return undefined
  } catch {
    return undefined
  }
}

// ── Busca na API ──────────────────────────────────────────────────

async function fetchFromApi(connector: ChannelConnector): Promise<TripAdvisorReview[]> {
  const apiKey = process.env['TRIPADVISOR_API_KEY']
  if (!apiKey) throw new Error('TRIPADVISOR_API_KEY não definida')
  if (!connector.external_id) {
    throw new Error(`Conector ${connector.id} sem external_id (location_id obrigatório)`)
  }

  const language = ((connector.config as Record<string, unknown>)['language'] as string | undefined) ?? 'pt'
  const locationId = connector.external_id.replace(/\D/g, '')

  logger.info(`[${CHANNEL}] API fallback — location_id ${locationId}`)

  const response = await fetchWithRetry(() =>
    axios.get(`${BASE_URL}/location/${locationId}/reviews`, {
      params: { key: apiKey, language, limit: 5 },
      headers: { accept: 'application/json' },
    })
  )

  const parsed = TripAdvisorResponseSchema.safeParse(response.data)
  if (!parsed.success) {
    logger.warn(`[${CHANNEL}] Resposta da API fora do schema`, {
      errors: parsed.error.errors,
    })
    return []
  }

  return parsed.data.data
}

async function fetchWithRetry<T>(fn: () => Promise<T>, retries = 3): Promise<T> {
  for (let i = 0; i < retries; i++) {
    try {
      return await fn()
    } catch (err: unknown) {
      const status = axios.isAxiosError(err) ? err.response?.status : undefined
      const isRetryable = status === 429 || (status !== undefined && status >= 500)
      if (!isRetryable || i === retries - 1) throw err
      const delay = Math.pow(2, i) * 1000
      logger.warn(`[${CHANNEL}] Retry após ${delay}ms`, { status, tentativa: i + 1 })
      await new Promise(r => setTimeout(r, delay))
    }
  }
  throw new Error('Máximo de tentativas excedido')
}

// ── Normalizadores ────────────────────────────────────────────────

function normalizeDataForSEO(raw: any, connector: ChannelConnector): NormalizedReview {
  const review: NormalizedReview = {
    tenant_id: connector.tenant_id,
    business_id: connector.business_id,
    connector_id: connector.id,
    channel: CHANNEL,
    external_id: String(raw.review_id),
    published_at: new Date(raw.date).toISOString(),
    sentiment: 'unanalyzed',
    raw_data: raw,
  }

  if (raw.rating?.value != null) review.rating = raw.rating.value
  if (raw.title?.trim()) review.title = raw.title.trim()
  if (raw.text?.trim()) review.body = raw.text.trim()
  if (raw.language) review.language = raw.language
  if (raw.user_profile?.name?.trim()) review.author_name = raw.user_profile.name.trim()
  if (raw.url) review.url = raw.url
  
  return review
}

function normalizeScraped(
  raw: import('./tripadvisor-scraper.js').RawTripAdvisorScrapedReview,
  connector: ChannelConnector
): NormalizedReview {
  const review: NormalizedReview = {
    tenant_id: connector.tenant_id,
    business_id: connector.business_id,
    connector_id: connector.id,
    channel: CHANNEL,
    external_id: raw.id,
    published_at: raw.published_date || new Date().toISOString(),
    sentiment: 'unanalyzed',
    raw_data: raw as unknown as Record<string, unknown>,
  }

  if (raw.rating != null) review.rating = raw.rating
  if (raw.title) review.title = raw.title
  if (raw.text) review.body = raw.text
  if (raw.author && raw.author !== 'Anônimo') review.author_name = raw.author

  return review
}

function normalizeApi(raw: TripAdvisorReview, connector: ChannelConnector): NormalizedReview {
  const rating = normalizeRating(raw.rating)
  const review: NormalizedReview = {
    tenant_id: connector.tenant_id,
    business_id: connector.business_id,
    connector_id: connector.id,
    channel: CHANNEL,
    external_id: String(raw.id),
    published_at: new Date(raw.published_date).toISOString(),
    sentiment: 'unanalyzed',
    raw_data: raw as unknown as Record<string, unknown>,
  }

  if (rating !== undefined) review.rating = rating
  if (raw.title?.trim()) review.title = raw.title.trim()
  if (raw.text?.trim()) review.body = raw.text.trim()
  if (raw.lang) review.language = raw.lang
  if (raw.user?.username?.trim()) review.author_name = raw.user.username.trim()
  if (raw.url) review.url = raw.url
  if (raw.helpful_votes > 0) review.upvotes = raw.helpful_votes

  return review
}

function normalizeRating(value: unknown): number | undefined {
  if (value == null) return undefined
  const num = Number(value)
  if (isNaN(num)) return undefined
  return Math.min(5, Math.max(0, num))
}

function normalizeApifyTripAdvisor(raw: any, connector: ChannelConnector): NormalizedReview {
  const reviewId = raw.id || raw.reviewId || `apify_ta_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
  const publishedAt = raw.publishedDate || raw.date || (raw.createdAt ? new Date(raw.createdAt).toISOString() : new Date().toISOString())

  return {
    tenant_id: connector.tenant_id,
    business_id: connector.business_id,
    connector_id: connector.id,
    channel: CHANNEL,
    external_id: String(reviewId),
    published_at: publishedAt,
    body: raw.text || raw.reviewDescription || raw.content || '',
    title: raw.title || raw.reviewTitle || undefined,
    author_name: raw.user?.username || raw.author || raw.reviewer || 'Anônimo',
    rating: raw.rating || raw.stars || undefined,
    sentiment: 'unanalyzed',
    url: raw.url || raw.reviewUrl || undefined,
    raw_data: raw
  }
}
