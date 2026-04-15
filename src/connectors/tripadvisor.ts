// Conector TripAdvisor — Content API v1
// Documentação: https://tripadvisor-content-api.readme.io/reference/overview
//
// Comportamento:
// - Busca até 5 reviews do local por chamada (limite do plano free)
// - API key passada como query param ?key=
// - location_id fica em connector.external_id
// - Sem paginação no plano free (apenas os 5 mais recentes)
//
// Nota sobre user_location.id:
// A API pode retornar o string literal "null" no lugar de null real.
// O schema Zod trata isso convertendo para undefined.

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

const CHANNEL = 'tripadvisor' as const
const BASE_URL = 'https://api.content.tripadvisor.com/api/v1'

// -----------------------------------------------------------------------------
// Schema de validação da resposta da API (Zod)
// Baseado na resposta real observada na API
// -----------------------------------------------------------------------------

const TripAdvisorUserSchema = z.object({
  username: z.string().optional(),
  user_location: z
    .object({
      // A API pode retornar a string literal "null" — tratamos como ausente
      id: z
        .string()
        .optional()
        .transform(v => (v === 'null' ? undefined : v)),
      name: z.string().optional(),
    })
    .optional(),
})

const TripAdvisorReviewSchema = z.object({
  id: z.number(),                                    // ID numérico inteiro (ex: 1056182371)
  lang: z.string().optional(),                       // código do idioma (ex: "pt", "en")
  location_id: z.number().optional(),
  published_date: z.string(),                        // ISO 8601
  rating: z.number().min(1).max(5),                  // escala 1–5
  helpful_votes: z.number().default(0),              // upvotes
  rating_image_url: z.string().optional(),
  url: z.string().optional(),
  text: z.string().optional(),                       // corpo do review (pode estar ausente)
  title: z.string().optional(),
  trip_type: z.string().optional(),
  travel_date: z.string().optional(),
  user: TripAdvisorUserSchema.optional(),
  subratings: z.record(z.unknown()).optional(),       // objeto variável, salvo no raw_data
})

const TripAdvisorResponseSchema = z.object({
  data: z.array(TripAdvisorReviewSchema).default([]),
})

type TripAdvisorReview = z.infer<typeof TripAdvisorReviewSchema>

// -----------------------------------------------------------------------------
// Função principal exportada
// -----------------------------------------------------------------------------

/**
 * Executa a coleta de reviews do TripAdvisor para um conector.
 * O location_id fica em connector.external_id.
 */
export async function run(connector: ChannelConnector): Promise<JobResult> {
  const result: JobResult = {
    reviews_fetched: 0,
    reviews_new: 0,
    reviews_updated: 0,
  }

  try {
    const rawItems = await fetchFromApi(connector)
    result.reviews_fetched = rawItems.length

    if (rawItems.length === 0) {
      logger.info(`[${CHANNEL}] Nenhum review retornado pela API`, {
        connector_id: connector.id,
        location_id: connector.external_id,
      })
      return result
    }

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

    // Erro de autenticação — API key inválida ou sem permissão
    if (
      axios.isAxiosError(error) &&
      (error.response?.status === 401 || error.response?.status === 403)
    ) {
      await supabase
        .from('channel_connectors')
        .update({
          status: 'pending_auth',
          error_message: `API key inválida ou sem permissão: ${error.message}`,
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
 * Busca reviews de um local no TripAdvisor Content API.
 * A API key é passada como query param (não no header).
 *
 * @param connector - Conector com location_id em external_id
 */
async function fetchFromApi(connector: ChannelConnector): Promise<TripAdvisorReview[]> {
  const apiKey = process.env['TRIPADVISOR_API_KEY']

  if (!apiKey) {
    throw new Error('Variável de ambiente TRIPADVISOR_API_KEY não definida.')
  }

  if (!connector.external_id) {
    throw new Error(
      `Conector ${connector.id} não tem external_id configurado (location_id obrigatório).`
    )
  }

  // Idioma preferido: usar config do conector ou defaultar para pt
  const language = (connector.config['language'] as string | undefined) ?? 'pt'

  // A API exige que o ID seja numérico, removendo eventuais letras como o 'd'
  const locationId = connector.external_id.replace(/\D/g, '')

  const url = `${BASE_URL}/location/${locationId}/reviews`

  logger.info(`[${CHANNEL}] Buscando reviews`, {
    connector_id: connector.id,
    location_id: connector.external_id,
  })

  const response = await fetchWithRetry(() =>
    axios.get(url, {
      params: {
        key: apiKey,
        language,
        limit: 5, // máximo do plano free
      },
      headers: {
        accept: 'application/json',
      },
    })
  )

  const parsed = TripAdvisorResponseSchema.safeParse(response.data)

  if (!parsed.success) {
    logger.warn(`[${CHANNEL}] Resposta da API fora do schema esperado`, {
      connector_id: connector.id,
      errors: parsed.error.errors,
      raw_response: JSON.stringify(response.data).slice(0, 500),
    })
    return []
  }

  return parsed.data.data
}

// -----------------------------------------------------------------------------
// Retry com backoff exponencial
// -----------------------------------------------------------------------------

/**
 * Executa uma função com retry automático em erros 429 e 5xx.
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
 * Converte um review bruto do TripAdvisor para NormalizedReview.
 *
 * Mapeamento:
 *   external_id  ← String(data[].id)      — ID numérico convertido para string
 *   rating       ← data[].rating           — escala 1–5 (manter)
 *   title        ← data[].title
 *   body         ← data[].text
 *   language     ← data[].lang
 *   author_name  ← data[].user.username
 *   url          ← data[].url
 *   upvotes      ← data[].helpful_votes
 *   published_at ← data[].published_date
 */
function normalize(raw: TripAdvisorReview, connector: ChannelConnector): NormalizedReview {
  // external_id: converter o ID numérico para string (requisito do NormalizedReview)
  const external_id = String(raw.id)

  const rating = normalizeRating(raw.rating)
  const title = raw.title?.trim() || undefined
  const body = raw.text?.trim() || undefined
  const language = raw.lang ?? 'en'
  const author_name = raw.user?.username?.trim() || undefined
  const url = raw.url ?? undefined
  const upvotes = raw.helpful_votes ?? 0

  const published_at = new Date(raw.published_date).toISOString()

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
  if (title !== undefined) review.title = title
  if (body !== undefined) review.body = body
  if (language !== undefined) review.language = language
  if (author_name !== undefined) review.author_name = author_name
  if (url !== undefined) review.url = url
  if (upvotes > 0) review.upvotes = upvotes

  return review
}

/**
 * Normaliza rating para escala 0–5.
 * TripAdvisor já usa 1–5, apenas valida o range.
 */
function normalizeRating(value: unknown): number | undefined {
  if (value == null) return undefined
  const num = Number(value)
  if (isNaN(num)) return undefined
  return Math.min(5, Math.max(0, num))
}

