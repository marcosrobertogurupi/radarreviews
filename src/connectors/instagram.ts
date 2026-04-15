// Conector Instagram — Instagram Graph API v19+
// Documentação: https://developers.facebook.com/docs/instagram-api
//
// Comportamento:
// - Recupera posts recentes da conta do cliente.
// - Para cada post, busca comentários.
// - Filtra comentários por palavras-chave de feedback (connector.config.feedback_keywords).
// - O Instagram User Access Token fica no Vault (connector.vault_secret_id).
// - O user_id do Instagram fica em connector.external_id.
//
// Fluxo:
//   1. GET /{user_id}/media → lista posts recentes
//   2. Para cada post: GET /{media_id}/comments → comentários
//   3. Filtrar por feedback_keywords (se configurado)
//   4. Ingerir como reviews normalizados
//
// Permissões necessárias: instagram_basic, instagram_manage_comments

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

const CHANNEL = 'instagram' as const
const BASE_URL = 'https://graph.instagram.com/v19.0'
const MEDIA_FIELDS = 'id,caption,timestamp,like_count,comments_count'
const COMMENT_FIELDS = 'id,text,username,timestamp'
const MEDIA_LIMIT = 20   // posts recentes por sync
const COMMENTS_LIMIT = 50

// -----------------------------------------------------------------------------
// Schemas Zod
// -----------------------------------------------------------------------------

const InstagramMediaSchema = z.object({
  id: z.string(),
  caption: z.string().optional(),
  timestamp: z.string(),
  like_count: z.number().default(0),
  comments_count: z.number().default(0),
})

const InstagramCommentSchema = z.object({
  id: z.string(),
  text: z.string(),
  username: z.string().optional(),
  timestamp: z.string(),
})

const InstagramMediaResponseSchema = z.object({
  data: z.array(InstagramMediaSchema).default([]),
  paging: z.object({ next: z.string().optional() }).optional(),
})

const InstagramCommentsResponseSchema = z.object({
  data: z.array(InstagramCommentSchema).default([]),
  paging: z.object({ next: z.string().optional() }).optional(),
})

type InstagramComment = z.infer<typeof InstagramCommentSchema>

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
        `Conector ${connector.id} não tem external_id configurado (Instagram user_id obrigatório).`
      )
    }

    // Recuperar o token do Vault
    const accessToken = await getTokenFromVault(connector)

    // Palavras-chave de feedback (opcionais — se não configurado, coleta todos os comentários)
    const feedbackKeywords = connector.config['feedback_keywords'] as string[] | undefined

    logger.info(`[${CHANNEL}] Iniciando coleta de comentários`, {
      connector_id: connector.id,
      user_id: connector.external_id,
      feedback_keywords: feedbackKeywords?.join(', ') || 'todos os comentários',
    })

    // 1. Buscar posts recentes
    const mediaPosts = await fetchRecentMedia(connector.external_id, accessToken)

    if (mediaPosts.length === 0) {
      logger.info(`[${CHANNEL}] Nenhum post encontrado`, { connector_id: connector.id })
      return result
    }

    logger.info(`[${CHANNEL}] Posts encontrados`, {
      connector_id: connector.id,
      count: mediaPosts.length,
    })

    // 2. Para cada post, buscar comentários
    const allComments: Array<{ comment: InstagramComment; mediaId: string }> = []

    for (const media of mediaPosts) {
      if (media.comments_count === 0) continue

      const comments = await fetchComments(media.id, accessToken)

      // 3. Filtrar por palavras-chave se configurado
      const relevant = feedbackKeywords && feedbackKeywords.length > 0
        ? comments.filter(c =>
            feedbackKeywords.some(kw =>
              c.text.toLowerCase().includes(kw.toLowerCase())
            )
          )
        : comments

      relevant.forEach(comment => allComments.push({ comment, mediaId: media.id }))
    }

    result.reviews_fetched = allComments.length

    if (allComments.length === 0) {
      logger.info(`[${CHANNEL}] Nenhum comentário relevante encontrado`, {
        connector_id: connector.id,
      })
      return result
    }

    // 4. Normalizar
    const normalized = allComments.map(({ comment, mediaId }) =>
      normalize(comment, mediaId, connector)
    )

    // 5. Ingestão
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
      comments_found: result.reviews_fetched,
      new: ingest.reviews_new,
      updated: ingest.reviews_updated,
    })
  } catch (error) {
    result.error = error instanceof Error ? error.message : String(error)

    logger.error(`[${CHANNEL}] Erro no conector ${connector.id}`, {
      error,
      connector_id: connector.id,
    })

    if (
      axios.isAxiosError(error) &&
      (error.response?.status === 401 || error.response?.status === 403)
    ) {
      await supabase
        .from('channel_connectors')
        .update({
          status: 'pending_auth',
          error_message: `Token Instagram inválido ou expirado: ${error.message}`,
        })
        .eq('id', connector.id)
    }
  }

  return result
}

// -----------------------------------------------------------------------------
// Vault
// -----------------------------------------------------------------------------

async function getTokenFromVault(connector: ChannelConnector): Promise<string> {
  if (!connector.vault_secret_id) {
    throw new Error(
      `Conector ${connector.id} não tem vault_secret_id. ` +
      `O cliente deve conectar a conta do Instagram no onboarding.`
    )
  }

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
// Busca de mídia e comentários
// -----------------------------------------------------------------------------

async function fetchRecentMedia(userId: string, accessToken: string) {
  const response = await fetchWithRetry(() =>
    axios.get(`${BASE_URL}/${userId}/media`, {
      params: {
        fields: MEDIA_FIELDS,
        limit: MEDIA_LIMIT,
        access_token: accessToken,
      },
    })
  )

  const parsed = InstagramMediaResponseSchema.safeParse(response.data)
  if (!parsed.success) {
    logger.warn(`[${CHANNEL}] Resposta de mídia fora do schema`, {
      errors: parsed.error.errors,
    })
    return []
  }

  return parsed.data.data
}

async function fetchComments(mediaId: string, accessToken: string): Promise<InstagramComment[]> {
  const allComments: InstagramComment[] = []
  let url: string | null =
    `${BASE_URL}/${mediaId}/comments?fields=${COMMENT_FIELDS}&limit=${COMMENTS_LIMIT}`

  while (url) {
    const response = await fetchWithRetry(() =>
      axios.get(url!, { params: { access_token: accessToken } })
    )

    const parsed = InstagramCommentsResponseSchema.safeParse(response.data)
    if (!parsed.success) break

    allComments.push(...parsed.data.data)
    url = parsed.data.paging?.next ?? null
  }

  return allComments
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

function normalize(
  comment: InstagramComment,
  mediaId: string,
  connector: ChannelConnector
): NormalizedReview {
  const review: NormalizedReview = {
    tenant_id: connector.tenant_id,
    business_id: connector.business_id,
    connector_id: connector.id,
    channel: CHANNEL,
    external_id: comment.id,
    published_at: new Date(comment.timestamp).toISOString(),
    body: comment.text,
    sentiment: 'unanalyzed',
    tags: ['instagram_comment'],
    raw_data: { comment, media_id: mediaId } as unknown as Record<string, unknown>,
  }

  if (comment.username) review.author_name = comment.username

  return review
}
