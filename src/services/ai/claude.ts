import 'dotenv/config'
import axios from 'axios'
import { logger } from '../../lib/logger.js'

export interface ClaudeResponse {
  reply: string
}

/**
 * Serviço de IA usando Claude da Anthropic (via API REST)
 * Modelo: claude-3-haiku-20240307 (rápido e barato para o Copiloto)
 */
export async function askClaude(systemPrompt: string, message: string, history: Array<{ role: string; text: string }> = []): Promise<string> {
  const apiKey = process.env['ANTHROPIC_API_KEY']
  
  if (!apiKey) {
    logger.warn('[claude] ANTHROPIC_API_KEY não configurada. Usando fallback.')
    throw new Error('ANTHROPIC_API_KEY não configurada.')
  }

  const messages = [
    ...history.map(h => ({
      role: h.role === 'user' ? 'user' : 'assistant',
      content: h.text
    })),
    { role: 'user', content: message }
  ]

  try {
    const response = await axios.post('https://api.anthropic.com/v1/messages', {
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1024,
      system: systemPrompt,
      messages: messages
    }, {
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json'
      }
    })

    const reply = response.data.content[0].text
    return reply
  } catch (err) {
    logger.error('[claude] Erro na chamada API Anthropic:', { error: err })
    throw err
  }
}
