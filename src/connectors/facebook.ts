// Conector Facebook — Meta Graph API v19+
// Documentação: https://developers.facebook.com/docs/graph-api
//
// Comportamento:
// - Busca ratings/reviews de uma Página do Facebook via Graph API.
// - O Page Access Token fica no Vault do Supabase (connector.vault_secret_id).
// - O page_id fica em connector.external_id.
// - Facebook ratings usam escala 1-5.
// - external_id ← reviewer.id + '_' + created_time (a API não fornece ID próprio por review).
//
// IMPORTANTE: Permissões necessárias no app Meta:
//   - pages_read_engagement
//   - pages_show_list
// O cliente deve autorizar o app no onboarding do SaaS.

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

const CHANNEL = 'facebook' as const
const BASE_URL = 'https://graph.facebook.com/v19.0'
const PAGE_SIZE = 25

// -----------------------------------------------------------------------------
// Schemas Zod
// -----------------------------------------------------------------------------

const FacebookReviewerSchema = z.object({
  id: z.string(),
  name: z.string().optional(),
})

const FacebookRatingSchema = z.object({
  reviewer: FacebookReviewerSchema,
  review_text: z.string().optional(),
  rating: z.number().min(1).max(5).optional(),
  created_time: z.string(), // ISO 8601
})

const FacebookRatingsResponseSchema = z.object({
  data: z.array(FacebookRatingSchema).default([]),
  paging: z
    .object({
      cursors: z
        .object({
          after: z.string().optional(),
        })
        .optional(),
      next: z.string().optional(),
    })
    .optional(),
})

type FacebookRating = z.infer<typeof FacebookRatingSchema>

// -----------------------------------------------------------------------------
// Função principal
// -----------------------------------------------------------------------------

export async function run(connector: ChannelConnector): Promise<JobResult> {
  const result: JobResult = {
    reviews_fetched: 0,
    reviews_new: 0,
    reviews_updated: 0,
  }

  try {
    if (!connector.external_id) {
      throw new Error(
        `Conector ${connector.id} não tem external_id configurado (page_id obrigatório).`
      )
    }

    // Recuperar o token do Vault
    const accessToken = await getTokenFromVault(connector)

    logger.info(`[${CHANNEL}] Buscando ratings`, {
      connector_id: connector.id,
      page_id: connector.external_id,
    })

    // Buscar todos os ratings com paginação
    const rawItems = await fetchAllPages(connector.external_id, accessToken)
    result.reviews_fetched = rawItems.length

    if (rawItems.length === 0) {
      logger.info(`[${CHANNEL}] Nenhum rating encontrado`, {
        connector_id: connector.id,
      })
      return result
    }

    // Normalizar
    const normalized = rawItems.map(item => normalize(item, connector))

    // Ingestão com dedup + stats + alertas
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

    // Token expirado — sinalizar reautorização no dashboard
    if (
      axios.isAxiosError(error) &&
      (error.response?.status === 401 || error.response?.status === 403)
    ) {
      await supabase
        .from('channel_connectors')
        .update({
          status: 'pending_auth',
          error_message: `Page Access Token inválido ou expirado: ${error.message}`,
        })
        .eq('id', connector.id)
    }
  }

  return result
}

// -----------------------------------------------------------------------------
// Recuperação do token do Vault
// -----------------------------------------------------------------------------

/**
 * Busca o Page Access Token armazenado no Supabase Vault.
 * O vault_secret_id é o UUID do segredo — nunca armazenamos o token diretamente.
 */
async function getTokenFromVault(connector: ChannelConnector): Promise<string> {
  if (!connector.vault_secret_id) {
    throw new Error(
      `Conector ${connector.id} não tem vault_secret_id. ` +
      `O cliente deve autorizar o app Facebook no onboarding.`
    )
  }

  // Supabase Vault: pgsodium.decrypted_secrets
  const { data, error } = await supabase
    .from('decrypted_secrets')
    .select('decrypted_secret')
    .eq('id', connector.vault_secret_id)
    .single()

  if (error || !data?.decrypted_secret) {
    throw new Error(
      `Não foi possível recuperar o token do Vault para o conector ${connector.id}: ` +
      (error?.message ?? 'segredo não encontrado')
    )
  }

  return data.decrypted_secret as string
}

// -----------------------------------------------------------------------------
// Paginação com cursor
// -----------------------------------------------------------------------------

async function fetchAllPages(pageId: string, accessToken: string): Promise<FacebookRating[]> {
  const allItems: FacebookRating[] = []
  let url: string | null =
    `${BASE_URL}/${pageId}/ratings?fields=reviewer,review_text,rating,created_time&limit=${PAGE_SIZE}`

  while (url) {
    const response = await fetchWithRetry(() =>
      axios.get(url!, {
        params: { access_token: accessToken },
      })
    )

    const parsed = FacebookRatingsResponseSchema.safeParse(response.data)

    if (!parsed.success) {
      logger.warn(`[${CHANNEL}] Resposta fora do schema esperado`, {
        errors: parsed.error.errors,
      })
      break
    }

    allItems.push(...parsed.data.data)

    // Paginação via cursor ou URL next
    url = parsed.data.paging?.next ?? null
  }

  return allItems
}

// -----------------------------------------------------------------------------
// Retry com backoff
// -----------------------------------------------------------------------------

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
        status, tentativa: i + 1,
      })
      await new Promise(r => setTimeout(r, delay))
    }
  }
  throw new Error('Máximo de tentativas excedido')
}

// -----------------------------------------------------------------------------
// Normalização
// -----------------------------------------------------------------------------

function normalize(raw: FacebookRating, connector: ChannelConnector): NormalizedReview {
  // Facebook não fornece um ID único por review — geramos um baseado em reviewer + data
  const external_id = `${raw.reviewer.id}_${raw.created_time}`

  const review: NormalizedReview = {
    tenant_id: connector.tenant_id,
    business_id: connector.business_id,
    connector_id: connector.id,
    channel: CHANNEL,
    external_id,
    published_at: new Date(raw.created_time).toISOString(),
    sentiment: 'unanalyzed',
    raw_data: raw as unknown as Record<string, unknown>,
  }

  if (raw.rating !== undefined)      review.rating = raw.rating
  if (raw.review_text)               review.body = raw.review_text
  if (raw.reviewer.name)             review.author_name = raw.reviewer.name
  review.author_external_id = raw.reviewer.id

  return review
}
