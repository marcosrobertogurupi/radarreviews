import axios from 'axios'
import { logger } from '../../lib/logger.js'

/**
 * Serviço de integração com a UAZAPI (WhatsApp API v2.0)
 */
export async function sendWhatsAppMessage(params: {
  baseUrl?: string
  token: string
  number: string
  text: string
}): Promise<{ success: boolean; messageId?: string; error?: string }> {
  const { baseUrl = 'https://api.uazapi.com', token, number, text } = params

  try {
    // Formatar número para o padrão internacional (apenas números)
    const formattedNumber = number.replace(/\D/g, '')

    const url = `${baseUrl}/message/text`
    
    const body = {
      number: formattedNumber,
      text: text,
    }

    console.log(`[uazapi] Enviando para ${url} (número: ${formattedNumber})`)

    const response = await axios.post(url, body, {
      headers: {
        'Content-Type': 'application/json',
        'token': token
      },
      timeout: 10000
    })

    if (response.data && response.data.id) {
      return { success: true, messageId: response.data.id }
    }

    return { success: false, error: 'Resposta inesperada da UAZAPI' }
  } catch (err) {
    logger.error('[uazapi] Erro ao enviar mensagem:', err instanceof axios.AxiosError ? err.response?.data : err)
    return { 
      success: false, 
      error: err instanceof axios.AxiosError ? (err.response?.data?.message || err.message) : String(err) 
    }
  }
}
