import 'dotenv/config'
import axios from 'axios'
import { logger } from '../../lib/logger.js'

export interface ClaudeDetailedResponse {
  reply: string
  promptTokens: number
  completionTokens: number
}

/**
 * Serviço de IA usando Claude da Anthropic (via API REST)
 * Modelo: claude-3-5-haiku-20241022
 */
export async function askClaudeDetailed(systemPrompt: string, message: string, history: Array<{ role: string; text: string }> = []): Promise<ClaudeDetailedResponse> {
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
      model: 'claude-3-5-haiku-20241022',
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
    const promptTokens = response.data.usage?.input_tokens ?? 0
    const completionTokens = response.data.usage?.output_tokens ?? 0
    return { reply, promptTokens, completionTokens }
  } catch (err) {
    logger.error('[claude] Erro na chamada API Anthropic:', { error: err })
    throw err
  }
}

export async function askClaude(systemPrompt: string, message: string, history: Array<{ role: string; text: string }> = []): Promise<string> {
  const res = await askClaudeDetailed(systemPrompt, message, history)
  return res.reply
}
