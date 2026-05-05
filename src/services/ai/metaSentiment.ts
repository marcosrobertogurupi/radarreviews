import 'dotenv/config'
import { GoogleGenerativeAI } from '@google/generative-ai'
import { logger } from '../../lib/logger.js'
import { AI_CONFIG } from '../../lib/ai-config.js'

export interface MetaSentimentResult {
  label: 'positive' | 'negative' | 'neutral'
  score: number               // 0.0 (muito positivo) a 1.0 (muito negativo)
  satisfaction_level: 'muito_negativo' | 'negativo' | 'neutro' | 'positivo' | 'muito_positivo'
  negative_keywords: string[] // palavras que dispararam negatividade
  summary: string             // resumo em 1 linha do que o comentário diz
}

/**
 * Analisa o sentimento de um comentário de rede social (Facebook/Instagram)
 * usando Gemini 1.5 Flash com score detalhado de insatisfação.
 */
export async function analyzeMetaSentiment(text: string): Promise<MetaSentimentResult> {
  const apiKey = process.env['GEMINI_API_KEY']
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY não configurada.')
  }

  const genAI = new GoogleGenerativeAI(apiKey)
  const model = genAI.getGenerativeModel({
    model: AI_CONFIG.model,
    generationConfig: {
      responseMimeType: AI_CONFIG.responseMimeType,
      temperature: AI_CONFIG.temperature,
    },
  })

  const prompt = `
Analise o sentimento deste comentário de cliente em português brasileiro em uma rede social (Facebook/Instagram).

Comentário: "${text}"

Responda APENAS com JSON válido neste formato exato:
{
  "label": "positive" | "negative" | "neutral",
  "score": número de 0.0 a 1.0 onde 1.0 é máxima negatividade e insatisfação,
  "satisfaction_level": "muito_negativo" | "negativo" | "neutro" | "positivo" | "muito_positivo",
  "negative_keywords": ["palavra1", "palavra2"],
  "summary": "resumo em até 10 palavras do que o cliente diz"
}

Critérios de Score:
- 0.8 a 1.0: muito_negativo (reclamação grave, xingamento, ameaça, problema crítico)
- 0.5 a 0.79: negativo (insatisfação clara, reclamação de serviço ou produto)
- 0.3 a 0.49: neutro (dúvida, comentário informativo, sugestão)
- 0.0 a 0.29: positivo (elogio, agradecimento, recomendação)
`.trim()

  try {
    const result = await model.generateContent(prompt)
    const rawResponse = result.response.text()
    const parsed = JSON.parse(rawResponse) as MetaSentimentResult
    return parsed
  } catch (err) {
    logger.error('[meta-sentiment] Erro na análise de IA:', err)
    // Fallback conservador
    return {
      label: 'neutral',
      score: 0.5,
      satisfaction_level: 'neutro',
      negative_keywords: [],
      summary: 'Análise automática indisponível'
    }
  }
}
