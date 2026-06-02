import 'dotenv/config'
import { GoogleGenerativeAI } from '@google/generative-ai'
import { supabase } from '../../lib/supabase.js'
import { logger } from '../../lib/logger.js'
import { AI_CONFIG } from '../../lib/ai-config.js'

/**
 * Serviço de análise de temas recorrentes usando Gemini
 */
export async function processBusinessTopics(businessId: string): Promise<void> {
  const apiKey = process.env['GEMINI_API_KEY']
  if (!apiKey) return

  try {
    // 1. Buscar reviews dos últimos 30 dias que tenham corpo de texto
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
    const { data: reviews } = await supabase
      .from('reviews')
      .select('body, sentiment')
      .eq('business_id', businessId)
      .gte('published_at', thirtyDaysAgo)
      .not('body', 'is', null)
      .limit(100)

    if (!reviews || reviews.length < 5) {
      logger.info(`[topics] Poucos reviews para analisar temas (${businessId})`)
      return
    }

    const reviewsText = reviews.map(r => `[${r.sentiment}] ${r.body}`).join('\n---\n')

    const genAI = new GoogleGenerativeAI(apiKey)
    const model = genAI.getGenerativeModel({ model: AI_CONFIG.model })

    const prompt = `
Analise os seguintes reviews de clientes e extraia os 8 temas mais recorrentes mencionados.
Para cada tema, identifique a quantidade de menções positivas e negativas.

Reviews:
${reviewsText}

Responda APENAS com um JSON válido no seguinte formato:
[
  {"tema": "atendimento", "positivo": 5, "negativo": 2},
  {"tema": "limpeza", "positivo": 3, "negativo": 0}
]

Temas aceitáveis (use estes se possível): atendimento, limpeza, preço, localização, produto, entrega, espera, estacionamento, cardápio, wifi, ambiente, barulho, outro.
`.trim()

    const result = await model.generateContent(prompt)
    const rawResponse = result.response.text()
    
    // Limpar markdown se necessário
    const jsonStr = rawResponse.replace(/```json|```/g, '').trim()
    const topics = JSON.parse(jsonStr)

    // Salvar no cache
    const periodStart = thirtyDaysAgo.split('T')[0]
    const periodEnd = new Date().toISOString().split('T')[0]

    await supabase.from('review_topics').upsert({
      business_id: businessId,
      period_start: periodStart,
      period_end: periodEnd,
      topics: topics,
      generated_at: new Date().toISOString()
    }, { onConflict: 'business_id, period_start, period_end' })

    logger.info(`[topics] Temas atualizados para empresa ${businessId}`)
  } catch (err) {
    logger.error(`[topics] Erro ao processar temas para ${businessId}:`, { error: err })
  }
}
