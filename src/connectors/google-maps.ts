// Conector Google Maps — Google Places API (New)
// Documetação: https://developers.google.com/maps/documentation/places/web-service
//
// Comportamento:
// - Busca até 5 reviews do local via Places API
// - Normaliza para NormalizedReview
// - Faz upsert em lote no Supabase
//
// Limitação conhecida: a API retorna no máximo 5 reviews por chamada.
// Não há paginação disponível na versão atual da API.

import 'dotenv/config'
import axios from 'axios'
import { z } from 'zod'
import { supabase } from '../lib/supabase.js'
import { logger } from '../lib/logger.js'
import { ingestReviews } from '../lib/ingest.js'
import type { ChannelConnector, JobResult } from '../types/connector.js'
import type { NormalizedReview } from '../types/review.js'

// -----------------------------------------------------------------------------
// Constantes
// -----------------------------------------------------------------------------

const CHANNEL = 'google_maps' as const
const BASE_URL = 'https://places.googleapis.com/v1'

// Campos que a API deve retornar (economiza cota)
const FIELD_MASK = 'id,displayName,rating,userRatingCount,reviews'

// -----------------------------------------------------------------------------
// Schema de validação da resposta da API (Zod)
// -----------------------------------------------------------------------------

const GoogleReviewSchema = z.object({
  name: z.string(),                              // ID único: places/{place_id}/reviews/{review_id}
  rating: z.number().min(1).max(5).optional(),
  text: z
    .object({
      text: z.string().optional(),
      languageCode: z.string().optional(),
    })
    .optional(),
  authorAttribution: z
    .object({
      displayName: z.string().optional(),
      uri: z.string().optional(),
      photoUri: z.string().optional(),
    })
    .optional(),
  publishTime: z.string(),                       // ISO 8601
  relativePublishTimeDescription: z.string().optional(),
})

const GooglePlaceResponseSchema = z.object({
  id: z.string().optional(),
  displayName: z
    .object({
      text: z.string().optional(),
    })
    .optional(),
  rating: z.number().optional(),
  userRatingCount: z.number().optional(),
  reviews: z.array(GoogleReviewSchema).optional().default([]),
})

type GoogleReview = z.infer<typeof GoogleReviewSchema>

// -----------------------------------------------------------------------------
// Função principal exportada
// -----------------------------------------------------------------------------

/**
 * Executa a coleta de reviews do Google Maps para um conector.
 * O place_id fica em connector.external_id.
 */
export async function run(connector: ChannelConnector): Promise<JobResult> {
  const result: JobResult = {
    reviews_fetched: 0,
    reviews_new: 0,
    reviews_updated: 0,
  }

  try {
    // Buscar reviews brutos da API
    const rawItems = await fetchFromApi(connector)
    result.reviews_fetched = rawItems.length

    if (rawItems.length === 0) {
      logger.info(`[${CHANNEL}] Nenhum review retornado pela API. Nota: a API pública Places (New) tem um limite de 5 reviews por local.`, {
        connector_id: connector.id,
        place_id: connector.external_id,
        count: 0
      })
      return result
    }

    if (rawItems.length >= 5) {
      logger.info(`[${CHANNEL}] API retornou o limite máximo de 5 reviews públicos. Histórico completo exige Business Profile API.`, {
        connector_id: connector.id,
        place_id: connector.external_id,
        count: rawItems.length
      })
    }

    // Normalizar para NormalizedReview
    const normalized = rawItems.map(item => normalize(item, connector))

    // Ingestão inteligente: dedup + stats + alertas automáticos
    const ingest = await ingestReviews(
      normalized,
      CHANNEL,
      connector.id,
      connector.business_id
    )

    result.reviews_new = ingest.reviews_new
    result.reviews_updated = ingest.reviews_updated

    logger.info(`[${CHANNEL}] Job concluído`, {
      connector_id: connector.id,
      reviews_fetched: result.reviews_fetched,
      reviews_new: ingest.reviews_new,
      reviews_updated: ingest.reviews_updated,
    })
  } catch (error) {
    result.error = error instanceof Error ? error.message : String(error)

    logger.error(`[${CHANNEL}] Erro no conector ${connector.id}`, {
      error,
      connector_id: connector.id,
    })

    // Erro de autenticação — sinalizar reautorização
    if (
      axios.isAxiosError(error) &&
      (error.response?.status === 401 || error.response?.status === 403)
    ) {
      await supabase
        .from('channel_connectors')
        .update({
          status: 'pending_auth',
          error_message: `Token inválido ou expirado: ${error.message}`,
        })
        .eq('id', connector.id)
    }
  }

  return result
}

// -----------------------------------------------------------------------------
// Busca na API
// -----------------------------------------------------------------------------

/**
 * Busca os reviews de um local no Google Places API (New).
 * Retorna os objetos brutos validados pelo schema Zod.
 *
 * @param connector - Conector com place_id em external_id
 */
async function fetchFromApi(connector: ChannelConnector): Promise<GoogleReview[]> {
  const apiKey = process.env['GOOGLE_MAPS_API_KEY']

  if (!apiKey) {
    throw new Error('Variável de ambiente GOOGLE_MAPS_API_KEY não definida.')
  }

  if (!connector.external_id) {
    throw new Error(
      `Conector ${connector.id} não tem external_id configurado (place_id obrigatório).`
    )
  }

  const url = `${BASE_URL}/places/${connector.external_id}`

  logger.info(`[${CHANNEL}] Buscando reviews`, {
    connector_id: connector.id,
    place_id: connector.external_id,
  })

  const response = await fetchWithRetry(() =>
    axios.get(url, {
      headers: {
        'X-Goog-Api-Key': apiKey,
        'X-Goog-FieldMask': FIELD_MASK,
      },
    })
  )

  // Validar e parsear a resposta com Zod
  const parsed = GooglePlaceResponseSchema.safeParse(response.data)

  if (!parsed.success) {
    logger.warn(`[${CHANNEL}] Resposta da API fora do schema esperado`, {
      connector_id: connector.id,
      errors: parsed.error.errors,
    })
    return []
  }

  return parsed.data.reviews
}

// -----------------------------------------------------------------------------
// Retry com backoff exponencial
// -----------------------------------------------------------------------------

/**
 * Executa uma função com retry automático em erros 429 e 5xx.
 * Delays: 1s, 2s, 4s (backoff exponencial).
 */
async function fetchWithRetry<T>(fn: () => Promise<T>, retries = 3): Promise<T> {
  for (let i = 0; i < retries; i++) {
    try {
      return await fn()
    } catch (err: unknown) {
      const status = axios.isAxiosError(err) ? err.response?.status : undefined
      const isRetryable = status === 429 || (status !== undefined && status >= 500)

      if (!isRetryable || i === retries - 1) throw err

      const delay = Math.pow(2, i) * 1000 // 1s, 2s, 4s
      logger.warn(`[${CHANNEL}] Rate limit ou erro do servidor, aguardando ${delay}ms`, {
        status,
        tentativa: i + 1,
      })
      await new Promise(r => setTimeout(r, delay))
    }
  }
  throw new Error('Máximo de tentativas excedido')
}

// -----------------------------------------------------------------------------
// Normalização
// -----------------------------------------------------------------------------

/**
 * Converte um review bruto da Google Places API para NormalizedReview.
 */
function normalize(raw: GoogleReview, connector: ChannelConnector): NormalizedReview {
  // external_id: usar o campo "name" da API (ex: places/ChIJ.../reviews/Cg...)
  // É garantidamente único e não pode ser vazio
  const external_id = raw.name

  // Normalizar rating: Google usa escala 1–5, manter como está
  const rating = normalizeRating(raw.rating)

  // Texto e idioma do review
  const body = raw.text?.text?.trim() || undefined
  const language = raw.text?.languageCode ?? 'pt'

  // Autor
  const author_name = raw.authorAttribution?.displayName?.trim() || undefined

  // Data de publicação — deve ser ISO 8601 válida
  const published_at = new Date(raw.publishTime).toISOString()

  const review: NormalizedReview = {
    tenant_id: connector.tenant_id,
    business_id: connector.business_id,
    connector_id: connector.id,
    channel: CHANNEL,
    external_id,
    published_at,
    sentiment: 'unanalyzed',
    raw_data: raw as unknown as Record<string, unknown>,
  }

  // Campos opcionais — só atribuir quando têm valor (exactOptionalPropertyTypes)
  if (rating !== undefined) review.rating = rating
  if (body !== undefined) review.body = body
  if (language !== undefined) review.language = language
  if (author_name !== undefined) review.author_name = author_name

  return review
}

/**
 * Normaliza ratings de escalas diferentes para 0–5.
 * Google Maps já usa 1–5, então apenas valida o range.
 */
function normalizeRating(value: unknown): number | undefined {
  if (value == null) return undefined
  const num = Number(value)
  if (isNaN(num)) return undefined
  return Math.min(5, Math.max(0, num))
}

