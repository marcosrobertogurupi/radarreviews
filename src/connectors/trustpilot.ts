// Conector Trustpilot — Consumer API v1
// Documentação: https://developers.trustpilot.com
//
// Comportamento:
// - Busca reviews do business unit via API REST com paginação completa.
// - external_id ← reviews[].id (string única da plataforma)
// - Inclui retry com backoff exponencial em erros 429 e 5xx.
// - A API key fica em TRUSTPILOT_API_KEY no .env.
// - O business_unit_id fica em connector.external_id.

import 'dotenv/config'
import axios from 'axios'
import { z } from 'zod'
import { supabase } from '../lib/supabase.js'
import { ingestReviews } from '../lib/ingest.js'
import { fetchTrustpilotReviews } from '../lib/apify.js'
import type { ChannelConnector, JobResult } from '../types/connector.js'
import type { NormalizedReview } from '../types/review.js'

// -----------------------------------------------------------------------------
// Constantes
// -----------------------------------------------------------------------------

const CHANNEL = 'trustpilot' as const
const BASE_URL = 'https://api.trustpilot.com/v1'
const PAGE_SIZE = 20   // máximo suportado pela API
const MAX_PAGES = 50   // limite de segurança (~1000 reviews por sync)

// -----------------------------------------------------------------------------
// Schema de validação da resposta (Zod)
// -----------------------------------------------------------------------------

const TrustpilotConsumerSchema = z.object({
  id: z.string(),
  displayName: z.string().optional(),
})

const TrustpilotLinkSchema = z.object({
  rel: z.string(),
  href: z.string(),
})

const TrustpilotReviewSchema = z.object({
  id: z.string(),
  stars: z.number().min(1).max(5),
  title: z.string().optional(),
  text: z.string().optional(),
  language: z.string().optional(),
  createdAt: z.string(),
  consumer: TrustpilotConsumerSchema.optional(),
  links: z.array(TrustpilotLinkSchema).optional().default([]),
})

const TrustpilotResponseSchema = z.object({
  reviews: z.array(TrustpilotReviewSchema).default([]),
  nextPage: z
    .object({
      page: z.number(),
    })
    .optional(),
})

type TrustpilotReview = z.infer<typeof TrustpilotReviewSchema>

// -----------------------------------------------------------------------------
// Função principal exportada
// -----------------------------------------------------------------------------

/**
 * Executa a coleta de reviews do Trustpilot para um conector.
 * O business_unit_id fica em connector.external_id.
 */
export async function run(connector: ChannelConnector): Promise<JobResult> {
  const result: JobResult = {
    reviews_fetched: 0,
    reviews_new: 0,
    reviews_updated: 0,
  }

  try {
    const externalId = connector.external_id || ''
    
    // --- ESTRATÉGIA PRINCIPAL: APIFY (Mais estável e não exige API Key oficial) ---
    try {
      if (process.env['APIFY_TOKEN']) {
        logger.info(`[${CHANNEL}] Tentando coleta via Apify (Principal)`, { connector_id: connector.id, external_id: externalId })
        const apifyItems = await fetchTrustpilotReviews(externalId, 20)
        
        if (apifyItems.length > 0) {
          const normalized = apifyItems.map(item => normalize(item, connector))
          const ingest = await ingestReviews(normalized, CHANNEL, connector.id, connector.business_id)
          
          return {
            reviews_fetched: apifyItems.length,
            reviews_new: ingest.reviews_new,
            reviews_updated: ingest.reviews_updated
          }
        }
      }
    } catch (apifyError) {
      logger.warn(`[${CHANNEL}] Falha na Apify, tentando fallback para API Oficial...`, { 
        error: apifyError instanceof Error ? apifyError.message : String(apifyError) 
      })
    }

    // --- ESTRATÉGIA SECUNDÁRIA (FALLBACK): API OFICIAL ---
    logger.info(`[${CHANNEL}] Iniciando busca via API Oficial (Fallback)`, {
      connector_id: connector.id,
      business_unit_id: externalId,
    })

    const rawItems = await fetchAllPages(connector)

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

    // Erro de autenticação — sinalizar reautorização no dashboard
    if (
      axios.isAxiosError(error) &&
      (error.response?.status === 401 || error.response?.status === 403)
    ) {
      await supabase
        .from('channel_connectors')
        .update({
          status: 'pending_auth',
          error_message: `API Key inválida ou sem permissão: ${error.message}`,
        })
        .eq('id', connector.id)
    }
  }

  return result
}

// -----------------------------------------------------------------------------
// Busca paginada na API
// -----------------------------------------------------------------------------

/**
 * Busca todos os reviews do business unit com paginação automática.
 * Implementa limite de segurança MAX_PAGES para evitar loops infinitos.
 */
async function fetchAllPages(connector: ChannelConnector): Promise<TrustpilotReview[]> {
  const apiKey = process.env['TRUSTPILOT_API_KEY']

  if (!apiKey) {
    throw new Error('TRUSTPILOT_API_KEY não definida no .env.')
  }

  if (!connector.external_id) {
    throw new Error(
      `Conector ${connector.id} não tem external_id configurado (business_unit_id obrigatório).`
    )
  }

  const allReviews: TrustpilotReview[] = []
  let page = 1

  logger.info(`[${CHANNEL}] Buscando reviews`, {
    connector_id: connector.id,
    business_unit_id: connector.external_id,
  })

  while (page <= MAX_PAGES) {
    const url = `${BASE_URL}/business-units/${connector.external_id}/reviews`

    const response = await fetchWithRetry(() =>
      axios.get(url, {
        params: {
          apikey: apiKey,
          page,
          perPage: PAGE_SIZE,
          orderBy: 'createdat.desc',
        },
      })
    )

    const parsed = TrustpilotResponseSchema.safeParse(response.data)

    if (!parsed.success) {
      logger.warn(`[${CHANNEL}] Resposta fora do schema esperado na página ${page}`, {
        connector_id: connector.id,
        errors: parsed.error.errors,
      })
      break
    }

    const pageReviews = parsed.data.reviews
    allReviews.push(...pageReviews)

    logger.info(`[${CHANNEL}] Página ${page} carregada`, {
      connector_id: connector.id,
      count: pageReviews.length,
      total_so_far: allReviews.length,
    })

    // Sem mais páginas ou a API não retornou nada nesta página
    if (!parsed.data.nextPage || pageReviews.length === 0) break

    page = parsed.data.nextPage.page
  }

  return allReviews
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

      const delay = Math.pow(2, i) * 1000
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
 * Converte um review bruto do Trustpilot para NormalizedReview.
 */
function normalize(raw: TrustpilotReview, connector: ChannelConnector): NormalizedReview {
  // Extrair URL do link do review (rel === 'self')
  const selfLink = raw.links.find(l => l.rel === 'self')
  const url = selfLink?.href

  const review: NormalizedReview = {
    tenant_id: connector.tenant_id,
    business_id: connector.business_id,
    connector_id: connector.id,
    channel: CHANNEL,
    external_id: raw.id,
    published_at: new Date(raw.createdAt).toISOString(),
    rating: raw.stars,
    sentiment: 'unanalyzed',
    raw_data: raw as unknown as Record<string, unknown>,
  }

  // Campos opcionais — só atribuir quando têm valor
  if (raw.title)                   review.title = raw.title
  if (raw.text)                    review.body = raw.text
  if (raw.language)                review.language = raw.language
  if (raw.consumer?.displayName)   review.author_name = raw.consumer.displayName
  if (raw.consumer?.id)           review.author_external_id = raw.consumer.id
  if (url)                         review.url = url

  return review
}
