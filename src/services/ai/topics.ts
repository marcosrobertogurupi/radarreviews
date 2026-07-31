import 'dotenv/config'
import { GoogleGenerativeAI } from '@google/generative-ai'
import { supabase } from '../../lib/supabase.js'
import { logger } from '../../lib/logger.js'
import { AI_CONFIG } from '../../lib/ai-config.js'

/**
 * Serviço de análise de temas recorrentes usando Gemini
 */
export async function processBusinessTopics(businessId: string): Promise<void> {
  try {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
    
    // 1. Buscar reviews (tentar 30 dias, senão histórico recente)
    let { data: reviews } = await supabase
      .from('reviews')
      .select('body, sentiment, sentiment_topics')
      .eq('business_id', businessId)
      .gte('published_at', thirtyDaysAgo)
      .not('body', 'is', null)
      .limit(100)

    if (!reviews || reviews.length === 0) {
      const { data: recentRevs } = await supabase
        .from('reviews')
        .select('body, sentiment, sentiment_topics')
        .eq('business_id', businessId)
        .order('published_at', { ascending: false })
        .limit(100)
      reviews = recentRevs ?? []
    }

    if (reviews.length === 0) {
      logger.info(`[topics] Nenhum review com texto para a empresa (${businessId})`)
      return
    }

    let topics: Array<{ tema: string; positivo: number; negativo: number }> = []

    const apiKey = process.env['GEMINI_API_KEY']
    if (apiKey && reviews.length >= 3) {
      try {
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

Temas aceitáveis (use estes se possível): atendimento, limpeza, preço, localização, produto, entrega, espera, estacionamento, cardápio, wifi, ambiente, barulho, qualidade, outro.
`.trim()

        const result = await model.generateContent(prompt)
        const rawResponse = result.response.text()
        const jsonStr = rawResponse.replace(/```json|```/g, '').trim()
        topics = JSON.parse(jsonStr)
      } catch (geminiErr: any) {
        logger.warn(`[topics] Falha no Gemini para ${businessId}, usando fallback heurístico:`, { error: geminiErr?.message || geminiErr })
      }
    }

    // Fallback heurístico se IA não rodou ou não gerou tópicos
    if (!topics || topics.length === 0) {
      const topicMap: Record<string, { positivo: number; negativo: number }> = {}
      const KEYWORD_MAP: Record<string, string[]> = {
        atendimento: ['atendimento', 'atendente', 'recepcao', 'recepção', 'vendedor', 'equipe', 'suporte', 'atencioso', 'prestativo'],
        limpeza: ['limpeza', 'limpo', 'sujo', 'sujeira', 'higiene', 'higienizado'],
        preço: ['preço', 'preco', 'valor', 'caro', 'barato', 'cobrança', 'cobranca', 'taxa'],
        qualidade: ['qualidade', 'bom', 'otimo', 'ótimo', 'excelente', 'defeito', 'ruim', 'pessimo'],
        entrega: ['entrega', 'envio', 'prazo', 'atraso', 'atrasou', 'chegou', 'demorou', 'rapidez'],
        espera: ['espera', 'fila', 'demora', 'tempo de espera'],
        ambiente: ['ambiente', 'espaço', 'espaco', 'local', 'estacionamento', 'ar condicionado'],
        produto: ['produto', 'peça', 'peca', 'veiculo', 'veículo', 'carro', 'serviço', 'servico'],
      }

      for (const r of reviews) {
        const isPos = r.sentiment === 'positive'
        const isNeg = r.sentiment === 'negative' || r.sentiment === 'critical'
        let found = new Set<string>()

        if (Array.isArray(r.sentiment_topics)) {
          for (const t of r.sentiment_topics) {
            if (t && typeof t === 'string' && t !== 'outro') found.add(t.toLowerCase().trim())
          }
        }

        if (found.size === 0) {
          const bodyLower = (r.body || '').toLowerCase()
          for (const [topicKey, keywords] of Object.entries(KEYWORD_MAP)) {
            if (keywords.some(kw => bodyLower.includes(kw))) {
              found.add(topicKey)
            }
          }
        }

        for (const t of found) {
          if (!topicMap[t]) topicMap[t] = { positivo: 0, negativo: 0 }
          if (isPos) topicMap[t].positivo++
          if (isNeg) topicMap[t].negativo++
          if (!isPos && !isNeg) topicMap[t].positivo++
        }
      }

      topics = Object.entries(topicMap).map(([tema, c]) => ({
        tema,
        positivo: c.positivo,
        negativo: c.negativo,
      })).sort((a, b) => (b.positivo + b.negativo) - (a.positivo + a.negativo)).slice(0, 8)
    }

    // Salvar no cache review_topics
    const periodStart = thirtyDaysAgo.split('T')[0]
    const periodEnd = new Date().toISOString().split('T')[0]

    const { error: upsertErr } = await supabase.from('review_topics').upsert({
      business_id: businessId,
      period_start: periodStart,
      period_end: periodEnd,
      topics: topics,
      generated_at: new Date().toISOString()
    }, { onConflict: 'business_id, period_start, period_end' })

    if (upsertErr) {
      // Se não houver a constraint única de ON CONFLICT, fazer delete + insert
      await supabase.from('review_topics')
        .delete()
        .eq('business_id', businessId)
        .eq('period_start', periodStart)
        .eq('period_end', periodEnd)

      await supabase.from('review_topics').insert({
        business_id: businessId,
        period_start: periodStart,
        period_end: periodEnd,
        topics: topics,
        generated_at: new Date().toISOString()
      })
    }

    logger.info(`[topics] Temas atualizados para empresa ${businessId} (${topics.length} temas)`)
  } catch (err) {
    logger.error(`[topics] Erro ao processar temas para ${businessId}:`, { error: err })
  }
}
