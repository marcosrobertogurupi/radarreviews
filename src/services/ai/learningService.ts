import 'dotenv/config'
import { GoogleGenerativeAI } from '@google/generative-ai'
import { supabaseAdmin } from '../../lib/supabase.js'
import { logger } from '../../lib/logger.js'
import type { SourceChannel } from '../../types/review.js'

function getGenAI(): GoogleGenerativeAI | null {
  const apiKey = process.env['GEMINI_API_KEY']
  if (!apiKey) return null
  return new GoogleGenerativeAI(apiKey)
}

/**
 * Gera um embedding vetorial de 768 dimensões usando Gemini (text-embedding-004)
 */
export async function generateEmbedding(text: string): Promise<number[] | null> {
  try {
    const ai = getGenAI()
    if (!ai) return null

    let modelName = 'text-embedding-004'
    let model = ai.getGenerativeModel({ model: modelName })
    let result
    try {
      result = await model.embedContent(text)
    } catch {
      modelName = 'models/text-embedding-004'
      model = ai.getGenerativeModel({ model: modelName })
      result = await model.embedContent(text)
    }
    const embedding = result.embedding?.values

    if (embedding && embedding.length === 768) {
      return embedding
    }
    return null
  } catch (err) {
    logger.warn('[learningService] Erro ao gerar embedding no Gemini:', { error: err })
    return null
  }
}

/**
 * Salva uma resposta aprovada/editada pelo usuário na memória vetorial do Tenant
 */
export async function recordApprovedReply(params: {
  tenantId: string
  businessId?: string
  reviewId?: string
  channel: SourceChannel
  rating?: number
  reviewText: string
  userApprovedText: string
  wasEditedByUser: boolean
}): Promise<boolean> {
  try {
    if (!params.reviewText || !params.userApprovedText) return false

    // 1. Gera o embedding da combinação do review + contexto
    const embedding = await generateEmbedding(params.reviewText)

    // 2. Insere na tabela de memória de aprendizado
    const { error } = await supabaseAdmin.from('review_reply_examples').insert({
      tenant_id: params.tenantId,
      business_id: params.businessId || null,
      review_id: params.reviewId || null,
      channel: params.channel,
      rating: params.rating || null,
      review_text: params.reviewText,
      user_approved_text: params.userApprovedText,
      embedding: embedding ? JSON.stringify(embedding) : null,
      was_edited_by_user: params.wasEditedByUser,
    })

    if (error) {
      logger.error('[learningService] Erro ao inserir exemplo de aprendizado:', { error })
      return false
    }

    logger.info('[learningService] Exemplo de aprendizado gravado com sucesso:', {
      tenantId: params.tenantId,
      channel: params.channel,
      wasEditedByUser: params.wasEditedByUser,
    })

    return true
  } catch (err) {
    logger.error('[learningService] Erro inesperado ao gravar exemplo de aprendizado:', { error: err })
    return false
  }
}

export interface PastReplyExample {
  id: string
  review_text: string
  user_approved_text: string
  rating?: number
  similarity?: number
}

/**
 * Busca até N exemplos de respostas anteriores aprovadas/editadas pelo assinante para casos semelhantes (RAG)
 */
export async function getRelevantReplyExamples(
  tenantId: string,
  reviewText: string,
  limit = 3
): Promise<PastReplyExample[]> {
  try {
    const queryEmbedding = await generateEmbedding(reviewText)

    if (queryEmbedding) {
      // 1. Tenta busca vetorial via RPC search_reply_examples
      const { data, error } = await supabaseAdmin.rpc('search_reply_examples', {
        p_tenant_id: tenantId,
        p_query_embedding: JSON.stringify(queryEmbedding),
        p_match_threshold: 0.55,
        p_match_count: limit,
      })

      if (!error && data && Array.isArray(data) && data.length > 0) {
        return data.map((item: any) => ({
          id: item.id,
          review_text: item.review_text,
          user_approved_text: item.user_approved_text,
          rating: item.rating,
          similarity: item.similarity,
        }))
      }
    }

    // 2. Fallback: busca exemplos recentes aprovados do tenant
    const { data: fallbackData } = await supabaseAdmin
      .from('review_reply_examples')
      .select('id, review_text, user_approved_text, rating')
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false })
      .limit(limit)

    return fallbackData || []
  } catch (err) {
    logger.warn('[learningService] Falha na busca semântica de exemplos, usando fallback:', { error: err })
    return []
  }
}
