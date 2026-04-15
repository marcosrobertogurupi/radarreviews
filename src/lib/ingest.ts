// Pipeline de ingestão de reviews — compartilhado por todos os conectores
//
// Responsabilidades:
// 1. Deduplicação inteligente: só escreve reviews novos ou com conteúdo alterado
// 2. Upsert em lote com contagem precisa de novos vs. atualizados
// 3. Dispara agregação de stats diárias após cada batch
// 4. Verifica regras de alerta para reviews negativos

import { supabase } from './supabase.js'
import { logger } from './logger.js'
import { checkAlerts } from './alerts.js'
import { analyzeBatch } from './sentiment.js'
import type { NormalizedReview, SourceChannel } from '../types/review.js'

const BATCH_SIZE = 50

// Campos usados para detectar se um review existente mudou
// (ex: upvotes crescem no Reddit; rating pode mudar no Google Maps)
interface ExistingReviewSnapshot {
  external_id: string
  rating: number | null
  body: string | null
  upvotes: number | null
}

export interface IngestResult {
  reviews_fetched: number
  reviews_new: number
  reviews_updated: number
}

/**
 * Ingere um array de NormalizedReview no Supabase de forma inteligente:
 *
 * 1. Consulta quais external_ids já existem no banco para o canal
 * 2. Separa em: novos (nunca vistos) e potencialmente atualizados (já existem)
 * 3. Dos já existentes, filtra apenas os que tiveram mudança de conteúdo
 *    (rating, body ou upvotes) — evita writes desnecessários
 * 4. Faz upsert apenas dos novos + alterados em lote
 * 5. Dispara agregação de stats diárias para o canal
 * 6. Verifica regras de alerta para reviews negativos recém-chegados
 *
 * @param reviews - Reviews normalizados prontos para salvar
 * @param channel - Canal de origem (para a query de dedup)
 * @param connectorId - UUID do conector (para alertas)
 * @param businessId - UUID da empresa (para alertas e stats)
 */
export async function ingestReviews(
  reviews: NormalizedReview[],
  channel: SourceChannel,
  connectorId: string,
  businessId: string
): Promise<IngestResult> {
  if (reviews.length === 0) {
    return { reviews_fetched: 0, reviews_new: 0, reviews_updated: 0 }
  }

  const result: IngestResult = {
    reviews_fetched: reviews.length,
    reviews_new: 0,
    reviews_updated: 0,
  }

  // ------------------------------------------------------------------
  // 1. Consultar snapshots dos reviews que já existem no banco
  // ------------------------------------------------------------------
  const externalIds = reviews.map(r => r.external_id)

  const { data: existingRows, error: queryError } = await supabase
    .from('reviews')
    .select('external_id, rating, body, upvotes')
    .eq('channel', channel)
    .in('external_id', externalIds)

  if (queryError) {
    throw new Error(`Ingest: falha ao consultar reviews existentes: ${queryError.message}`)
  }

  const existingMap = new Map<string, ExistingReviewSnapshot>(
    (existingRows ?? []).map(row => [
      row.external_id as string,
      row as ExistingReviewSnapshot,
    ])
  )

  // ------------------------------------------------------------------
  // 2. Separar novos vs. potencialmente atualizados
  // ------------------------------------------------------------------
  const newReviews: NormalizedReview[] = []
  const changedReviews: NormalizedReview[] = []

  for (const review of reviews) {
    const existing = existingMap.get(review.external_id)

    if (!existing) {
      // Nunca visto antes — é novo
      newReviews.push(review)
    } else {
      // Já existe — verificar se algo mudou (evita write desnecessário)
      const ratingChanged = (existing.rating ?? null) !== (review.rating ?? null)
      const bodyChanged = (existing.body ?? null) !== (review.body ?? null)
      const upvotesChanged = (existing.upvotes ?? 0) !== (review.upvotes ?? 0)

      if (ratingChanged || bodyChanged || upvotesChanged) {
        changedReviews.push(review)
      }
      // Se nada mudou: ignora completamente — zero tráfego desnecessário
    }
  }

  logger.info('[ingest] Deduplicação concluída', {
    canal: channel,
    connector_id: connectorId,
    total: reviews.length,
    novos: newReviews.length,
    atualizados: changedReviews.length,
    ignorados: reviews.length - newReviews.length - changedReviews.length,
  })

  // ------------------------------------------------------------------
  // 3. Analisar sentimento dos reviews novos com IA (antes do upsert)
  //    Reviews atualizados só são reanalisados se o body mudou
  // ------------------------------------------------------------------
  if (newReviews.length > 0) {
    await analyzeBatch(newReviews)
  }

  // Para reviews atualizados, reanalisar apenas os que tiveram body alterado
  const changedWithNewBody = changedReviews.filter(r => {
    const existing = existingMap.get(r.external_id)
    return existing?.body !== r.body
  })
  if (changedWithNewBody.length > 0) {
    await analyzeBatch(changedWithNewBody)
  }

  // ------------------------------------------------------------------
  // 4. Fazer upsert apenas de novos + alterados
  // ------------------------------------------------------------------
  const toWrite = [...newReviews, ...changedReviews]

  if (toWrite.length > 0) {
    await upsertBatch(toWrite)
  }

  result.reviews_new = newReviews.length
  result.reviews_updated = changedReviews.length

  // ------------------------------------------------------------------
  // 5. Agregar stats diárias (chamar após escrita)
  // ------------------------------------------------------------------
  if (toWrite.length > 0) {
    const today = new Date().toISOString().split('T')[0]! // 'YYYY-MM-DD'
    const { error: statsError } = await supabase.rpc('aggregate_daily_stats', {
      p_business_id: businessId,
      p_channel: channel,
      p_date: today,
    })

    if (statsError) {
      // Logar mas não falhar — stats são recalculáveis
      logger.warn('[ingest] Falha ao agregar stats diárias', {
        canal: channel,
        business_id: businessId,
        error: statsError.message,
      })
    }
  }

  // ------------------------------------------------------------------
  // 6. Verificar alertas para reviews novos (inclui critical + negative)
  // ------------------------------------------------------------------
  if (newReviews.length > 0) {
    await checkAlerts(newReviews, businessId, channel)
  }

  return result
}

/**
 * Faz upsert de um array de reviews em lotes.
 * Constraint única: (channel, external_id).
 */
async function upsertBatch(reviews: NormalizedReview[]): Promise<void> {
  for (let i = 0; i < reviews.length; i += BATCH_SIZE) {
    const batch = reviews.slice(i, i + BATCH_SIZE)

    // Retry logic para lidar com 'fetch failed' ocasionais
    let retryCount = 0
    const maxRetries = 3
    let success = false

    while (retryCount < maxRetries && !success) {
      try {
        const { error } = await supabase
          .from('reviews')
          .upsert(batch, {
            onConflict: 'channel,external_id',
            ignoreDuplicates: false,
          })

        if (error) throw error
        success = true
      } catch (err) {
        retryCount++
        if (retryCount >= maxRetries) {
          throw new Error(`Ingest: upsert falhou após ${maxRetries} tentativas: ${err instanceof Error ? err.message : String(err)}`)
        }
        logger.warn(`[ingest] Falha no upsert, tentando novamente (${retryCount}/${maxRetries})...`)
        await new Promise(r => setTimeout(r, 1000 * retryCount))
      }
    }
  }
}
