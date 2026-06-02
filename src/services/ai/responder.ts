import { supabase } from '../../lib/supabase.js'
import { decrypt } from '../../lib/crypto.js'
import axios from 'axios'
import { logger } from '../../lib/logger.js'

/**
 * Serviço centralizado para envio de respostas aos canais originais
 */
export async function sendDirectResponse(reviewId: string, message: string, userId: string): Promise<{ success: boolean; error?: string }> {
  try {
    // 1. Buscar detalhes do review e do conector
    const { data: review, error: rError } = await supabase
      .from('reviews')
      .select('*, monitored_businesses(tenant_id)')
      .eq('id', reviewId)
      .single()

    if (rError || !review) throw new Error('Review não encontrado')

    const channel = review.channel
    const externalId = review.external_id

    // 2. Buscar conector para obter tokens (se necessário)
    const { data: connector, error: cError } = await supabase
      .from('channel_connectors')
      .select('*')
      .eq('business_id', review.business_id)
      .eq('channel', channel)
      .single()

    if (cError || !connector) {
      // Se não tem conector oficial, não podemos responder via API direta
      throw new Error(`Canal ${channel} não suporta resposta direta ou não está conectado oficialmente.`)
    }

    let success = false
    let apiError = ''

    // 3. Dispatch por canal
    if (channel === 'instagram' || channel === 'facebook') {
      success = await respondToMeta(connector, externalId, message)
    } else if (channel === 'google_maps') {
      // Google My Business exige OAuth e Business Profile API
      apiError = 'Resposta direta via Google Maps em implementação. Use o link do review por enquanto.'
    } else {
      apiError = `Resposta direta não suportada para o canal ${channel}.`
    }

    if (success) {
      // 4. Atualizar banco de dados
      await supabase.from('reviews').update({
        responded_at: new Date().toISOString(),
        response_text: message,
        responded_by: userId
      }).eq('id', reviewId)

      return { success: true }
    } else {
      return { success: false, error: apiError || 'Falha ao enviar resposta ao canal original.' }
    }

  } catch (err) {
    logger.error('[responder] Erro ao enviar resposta:', { error: err })
    return { success: false, error: err instanceof Error ? err.message : 'Erro interno ao processar resposta.' }
  }
}

async function respondToMeta(connector: any, commentId: string, message: string): Promise<boolean> {
  try {
    const pageTokenEnc = connector.config?.page_token_enc
    if (!pageTokenEnc) throw new Error('Token da página não encontrado')
    
    const pageToken = decrypt(pageTokenEnc)
    if (!pageToken) throw new Error('Falha ao descriptografar token')

    // Para Meta, respondemos ao comentário (commentId)
    // POST /{comment-id}/replies?message={text}
    const url = `https://graph.facebook.com/v20.0/${commentId}/replies`
    
    const res = await axios.post(url, {
      message: message,
      access_token: pageToken
    })

    return !!res.data.id
  } catch (err) {
    logger.error('[responder] Erro Meta API:', { error: err instanceof axios.AxiosError ? err.response?.data : err })
    return false
  }
}
