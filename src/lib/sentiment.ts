// Motor de Análise de Sentimento — powered by Google Gemini Flash
//
// Este é o diferencial do Radar de Reviews: uma análise de IA em português
// que entende o contexto específico de cada canal, detecta insatisfação real,
// identifica tópicos críticos (cobrança, cancelamento, fraude) e gera
// resumos acionáveis para o dashboard do cliente.
//
// Estratégia de análise em 3 camadas:
//   1. [Primária]  Gemini Flash — análise profunda via LLM, JSON estruturado
//   2. [Fallback]  Heurística — palavras-chave + rating quando Gemini indisponível
//   3. [Mínima]    Rating-only — apenas score numérico quando sem texto
//
// Performance:
//   - Cache em memória por hash do texto (evita reprocessar review idêntico)
//   - Sem chamada à API para reviews com sentiment já preenchido
//
// Variável de ambiente: GEMINI_API_KEY

import 'dotenv/config'
import { GoogleGenerativeAI } from '@google/generative-ai'
import { createHash } from 'node:crypto'
import { logger } from './logger.js'
import type {
  NormalizedReview,
  SentimentResult,
  SentimentTopic,
  SentimentType,
  SourceChannel,
} from '../types/review.js'

// -----------------------------------------------------------------------------
// Inicialização do SDK Gemini
// -----------------------------------------------------------------------------

function getGenAI(): GoogleGenerativeAI | null {
  const apiKey = process.env['GEMINI_API_KEY']
  if (!apiKey) return null
  return new GoogleGenerativeAI(apiKey)
}

// (Schema removido — gemini-2.5-flash usa JSON mode simples via responseMimeType)
// O prompt instrui a IA a retornar JSON válido diretamente.

// -----------------------------------------------------------------------------
// Cache em memória (hash do texto → resultado)
// Evita rechamar a API para reviews com texto idêntico
// -----------------------------------------------------------------------------

const analysisCache = new Map<string, SentimentResult>()

function cacheKey(text: string): string {
  return createHash('sha256').update(text).digest('hex').slice(0, 16)
}

// -----------------------------------------------------------------------------
// Contextos específicos por canal
// Injetados no prompt para calibrar a IA ao ambiente da plataforma
// -----------------------------------------------------------------------------

const CHANNEL_CONTEXT: Record<SourceChannel, string> = {
  google_maps: `
Contexto: Avaliação pública de estabelecimento no Google Maps.
- Escala de 1 a 5 estrelas. Visível para milhares de potenciais clientes diariamente.
- Reviews recentes têm peso maior no algoritmo do Google.
- 1-2 estrelas: experiência muito ruim, cliente improvável de retornar.
- 3 estrelas: experiência mediana, cliente insatisfeito mas não furioso.
- 4-5 estrelas: experiência boa/excelente, cliente satisfeito.`.trim(),

  tripadvisor: `
Contexto: Review de estabelecimento turístico no TripAdvisor.
- Plataforma de referência para viajantes. Alto impacto em decisão de compra.
- Clientes do TripAdvisor são tipicamente exigentes e detalhistas.
- Reviews negativos aqui costumam ser detalhados e influenciam fortemente a reputação.
- Foque em identificar problemas concretos vs. meras expectativas não atendidas.`.trim(),

  trustpilot: `
Contexto: Review em plataforma verificada de avaliações B2C (Trustpilot).
- Reviews verificados por compra real. Alto peso de credibilidade.
- Plataforma com grande visibilidade em buscas orgânicas.
- Score 1-2: cliente muito insatisfeito e motivado a avisar outros.
- Presença aqui indica problema sistemático (clientes não reclamam por capricho).`.trim(),

  reclame_aqui: `
CONTEXTO CRÍTICO: Reclamação formal no Reclame Aqui.
- TODO texto aqui é uma reclamação — não existe review positivo nesta plataforma.
- Severidade base: elevada. O cliente foi ao Reclame Aqui porque não conseguiu resolver antes.
- Foco na urgência: existe prazo legal para resposta da empresa.
- Detecte se envolve questões financeiras (cobrança indevida, fraude, não reembolso).
- Score de insatisfação deve começar em 50 no mínimo; problemas graves a partir de 75.`.trim(),

  consumidor_gov: `
CONTEXTO CRÍTICO: Reclamação formal ao Governo Federal (consumidor.gov.br).
- Canal oficial do Ministério da Justiça. Empresa tem prazo legal para responder.
- Denota falha grave: cliente foi ao governo após esgotar tentativas privadas.
- Alto risco legal se não respondido. Alta probabilidade de ação judicial.
- Score mínimo: 65. Problemas financeiros, de cancelamento ou dados: mínimo 80.`.trim(),

  reddit: `
Contexto: Menção espontânea em fórum público (Reddit).
- Usuários do Reddit são influentes e críticos. Posts virais são comuns.
- Não é reclamação formal: pode ser desabafo, alerta para outros usuários, ou meme.
- Alta potência de viralização negativa se comentário ganhar upvotes.
- Avalie o tom geral: ironia e sarcasmo são comuns e indicam insatisfação velada.
- Um post com alto engagement negativo é um sinal de alerta de crise.`.trim(),

  facebook: `
Contexto: Avaliação pública em Página do Facebook.
- Visível para todos os seguidores e visitantes da página.
- Reviews aqui impactam diretamente a pontuação da empresa no Facebook.
- 1-3 estrelas: cliente claramente insatisfeito que quis alertar publicamente.
- Avalanche de 1 estrela pode indicar campanha organizada — detecte padrões.`.trim(),

  instagram: `
Contexto: Comentário em post público do Instagram.
- Audiência ampla e visível. Risco de viralização via repost/stories.
- Comentários negativos em posts de produtos são especialmente prejudiciais.
- Filtragem por palavras-chave pode ter capturado este comentário relevante.
- Avalie se o sentimento negativo é pontual ou reflete insatisfação sistêmica.`.trim(),
}

// -----------------------------------------------------------------------------
// Função principal — analisar um review
// -----------------------------------------------------------------------------

/**
 * Analisa o sentimento de um review usando Gemini Flash.
 * Retorna um SentimentResult estruturado e preenchido.
 *
 * O resultado é aplicado diretamente nos campos do NormalizedReview
 * antes de persistir no banco.
 */
export async function analyzeSentiment(
  review: NormalizedReview
): Promise<SentimentResult> {
  // Se já foi analisado, retornar direto
  if (review.sentiment !== 'unanalyzed' && review.sentiment_result) {
    return review.sentiment_result
  }

  const text = buildReviewText(review)

  // Sem texto — usar análise apenas por rating
  if (!text.trim()) {
    return analyzeByRatingOnly(review)
  }

  // Verificar cache
  const key = cacheKey(text)
  const cached = analysisCache.get(key)
  if (cached) {
    logger.info('[sentiment] Cache hit', { key })
    return cached
  }

  // Tentar análise com Gemini
  const genAI = getGenAI()
  if (genAI) {
    try {
      const result = await analyzeWithGemini(genAI, review, text)
      analysisCache.set(key, result)
      return result
    } catch (error) {
      logger.warn('[sentiment] Gemini indisponível, usando heurística', {
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  // Fallback para heurística
  const heuristicResult = analyzeByHeuristic(review, text)
  analysisCache.set(key, heuristicResult)
  return heuristicResult
}

/**
 * Analisa um lote de reviews e aplica os resultados diretamente nos objetos.
 * Modifica os reviews in-place: preenche sentiment, dissatisfaction_score, etc.
 */
export async function analyzeBatch(reviews: NormalizedReview[]): Promise<void> {
  // Filtrar apenas os que precisam ser analisados
  const toAnalyze = reviews.filter(r => r.sentiment === 'unanalyzed')

  if (toAnalyze.length === 0) return

  logger.info('[sentiment] Analisando lote', { total: toAnalyze.length })

  // Processar em paralelo com limite de concorrência (máx 5 simultâneos)
  const CONCURRENCY = 5
  for (let i = 0; i < toAnalyze.length; i += CONCURRENCY) {
    const batch = toAnalyze.slice(i, i + CONCURRENCY)
    await Promise.all(
      batch.map(async (review) => {
        const result = await analyzeSentiment(review)
        applyResult(review, result)
      })
    )
  }

  const analyzed = toAnalyze.length
  const critical = toAnalyze.filter(r => r.sentiment === 'critical').length
  const negative = toAnalyze.filter(r => r.sentiment === 'negative').length

  logger.info('[sentiment] Lote concluído', { analyzed, critical, negative })
}

// -----------------------------------------------------------------------------
// Análise com Gemini Flash (camada 1 — primária)
// -----------------------------------------------------------------------------

async function analyzeWithGemini(
  genAI: GoogleGenerativeAI,
  review: NormalizedReview,
  text: string
): Promise<SentimentResult> {
  const model = genAI.getGenerativeModel({
    model: 'models/gemini-2.0-flash',
    generationConfig: {
      responseMimeType: 'application/json',
      temperature: 0.1,
      maxOutputTokens: 1024,
    },
  })

  const channelContext = CHANNEL_CONTEXT[review.channel]
  const ratingContext = review.rating !== undefined
    ? `\nNota: ${review.rating}/5 estrelas.`
    : ''

  const prompt = `
Analise o sentimento deste review brasileiro e retorne JSON.

CONTEXTO DO CANAL:
${channelContext}${ratingContext}

REVIEW:
"""
${text.slice(0, 800)}
"""

RETORNE APENAS este JSON (nenhum texto extra, nenhum markdown):
{"sentiment":"positive|neutral|negative|critical","dissatisfaction_score":0,"confidence":0.0,"topics":["atendimento|produto|cobrança|entrega|app_plataforma|cancelamento|dados_privados|reembolso|elogio|outro"],"summary":"...","alert_reason":"ação recomendada ou null"}

REGRAS DE SENTIMENTO:
- critical=ameaça judicial/fraude/não consegue cancelar
- negative=insatisfeito com problema real
- neutral=misto/mediano
- positive=satisfeito/elogio

REGRAS DO CAMPO summary (MUITO IMPORTANTE):
- Máximo 12 palavras, em português, iniciando com letra maiúscula, sem ponto final
- Descreva o PROBLEMA ESPECÍFICO mencionado: o que aconteceu + produto/serviço envolvido
- NÃO use palavras genéricas como "cliente insatisfeito", "problema relatado", "reclamação sobre"
- NÃO mencione o nome da plataforma (Reclame Aqui, Google, etc.)
- USE verbos concretos: cobrado, bloqueado, cancelado, não entregue, não reembolsado, etc.
- Exemplos RUINS: "Cliente insatisfeito sobre cobrança", "Problema relatado pelo usuário"
- Exemplos BONS: "Cobrança indevida após cancelamento sem reembolso", "Cartão bloqueado sem aviso e sem solução", "Internet não ativada após 15 dias de pagamento"
`.trim()

  const response = await model.generateContent(prompt)
  const raw = response.response.text().trim()

  // Extrair o bloco JSON — remove markdown se presente (```json ... ```)
  let jsonStr = raw
    .replace(/^```(?:json)?\s*/im, '')
    .replace(/\s*```$/im, '')
    .trim()

  // Sanitização: o Gemini às vezes usa aspas simples em vez de duplas
  // Usa uma abordagem segura: localiza o objeto JSON e faz um parse robusto
  // Estratégia: tentar JSON.parse direto → se falhar, tentar limpar o string
  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(jsonStr)
  } catch {
    // Tentar extrair apenas o bloco {} do início ao fim
    const match = jsonStr.match(/\{[\s\S]*\}/)
    if (match) {
      try {
        parsed = JSON.parse(match[0])
      } catch {
        // Última tentativa: substituir aspas simples por duplas em keys/values simples
        const sanitized = match[0]
          .replace(/'/g, '"')                          // aspas simples → duplas
          .replace(/,\s*([}\]])/g, '$1')              // trailing comma
          .replace(/([{,]\s*)(\w+)\s*:/g, '$1"$2":')  // keys sem aspas
        parsed = JSON.parse(sanitized)
      }
    } else {
      throw new Error(`JSON inválido retornado pelo Gemini: ${jsonStr.slice(0, 100)}`)
    }
  }

  // Validar campos obrigatórios
  const validSentiments = ['positive', 'neutral', 'negative', 'critical']
  if (!validSentiments.includes(parsed['sentiment'] as string)) {
    throw new Error(`Sentimento inválido recebido do Gemini: ${String(parsed['sentiment'])}`)
  }

  return {
    sentiment: parsed.sentiment as SentimentType,
    dissatisfaction_score: Math.round(Math.max(0, Math.min(100, Number(parsed.dissatisfaction_score) || 0))),
    confidence: Math.max(0, Math.min(1, Number(parsed.confidence) || 0.8)),
    topics: Array.isArray(parsed.topics) ? parsed.topics as SentimentTopic[] : ['outro'],
    summary: String(parsed.summary ?? ''),
    ...(parsed['alert_reason'] ? { alert_reason: String(parsed['alert_reason']) } : {}),
    method: 'gemini',
  }
}

// -----------------------------------------------------------------------------
// Análise por heurística (camada 2 — fallback)
// -----------------------------------------------------------------------------

// Palavras-chave negativas e seus pesos (1-3)
const NEGATIVE_KEYWORDS: Array<[RegExp, number, SentimentTopic]> = [
  // Crítico (peso 3)
  [/fraude|golpe|estelionato/i, 3, 'dados_privados'],
  [/processo|judicial|procon|decon|anatel|banco central/i, 3, 'atendimento'],
  [/n[ãa]o consigo cancelar|n[ãa]o cancela/i, 3, 'cancelamento'],
  [/vaza(mento|ram|ndo)/i, 3, 'dados_privados'],
  [/cobr(aram|ando|ança) indevid/i, 3, 'cobrança'],
  [/nunca resolveu|sem resposta|ignorado/i, 3, 'atendimento'],
  // Negativo (peso 2)
  [/absurdo|inacceit[áa]vel|vergonha|horrível|p[ée]ssimo/i, 2, 'outro'],
  [/cobr(aram|ando) (errado|a mais|sem autoriza)/i, 2, 'cobrança'],
  [/n[ãa]o funciona|quebrou|defeito|com defeito/i, 2, 'produto'],
  [/demissão|demitida|demitido/i, 2, 'outro'],
  [/app (caiu|n[ãa]o abre|travou|erro)/i, 2, 'app_plataforma'],
  [/at[ea]ndimento (p[ée]ssimo|horrível|demor|ruim)/i, 2, 'atendimento'],
  [/n[ãa]o recebi|n[ãa]o chegou|extravio/i, 2, 'entrega'],
  [/reembolso|estorno (negado|n[ãa]o|recusado)/i, 2, 'reembolso'],
  // Leve (peso 1)
  [/decepcionante|decepcionado|insatisfeito|frustr/i, 1, 'outro'],
  [/demorou|demorada|demora|lento/i, 1, 'atendimento'],
  [/cuidado|aten[çc][ãa]o|cuidado|evitem/i, 1, 'outro'],
  [/ruim|mal|não gostei/i, 1, 'outro'],
]

const POSITIVE_KEYWORDS: RegExp[] = [
  /excelente|perfeito|amei|maravilhoso|fantástico|incrível/i,
  /recomendo|recomenda[çc][ãa]o|parabéns/i,
  /satisfeito|satisfação|feliz|contente/i,
  /rápido|ráp[iî]d[ao]|eficiente|resolveram/i,
]

function analyzeByHeuristic(review: NormalizedReview, text: string): SentimentResult {
  let score = 0
  const topics = new Set<SentimentTopic>()

  // Aplicar palavras-chave negativas
  for (const [regex, weight, topic] of NEGATIVE_KEYWORDS) {
    if (regex.test(text)) {
      score += weight * 20
      topics.add(topic)
    }
  }

  // Bônus de rating para canais com nota
  if (review.rating !== undefined) {
    if (review.rating <= 1) score = Math.max(score, 80)
    else if (review.rating <= 2) score = Math.max(score, 60)
    else if (review.rating <= 3) score = Math.max(score, 30)
    else if (review.rating >= 4) score = Math.min(score, 25)
  }

  // Bônus de canal (Reclame Aqui e consumidor.gov são sempre negativos)
  if (review.channel === 'reclame_aqui') score = Math.max(score, 60)
  if (review.channel === 'consumidor_gov') score = Math.max(score, 65)

  // Diminuir score para palavras positivas
  const hasPositive = POSITIVE_KEYWORDS.some(r => r.test(text))
  if (hasPositive && score < 30) score = Math.max(0, score - 10)
  if (hasPositive) topics.add('elogio')

  // Limitar a 100
  score = Math.min(100, score)

  const sentiment = scoreToSentiment(score)
  const topicList = Array.from(topics).length > 0 ? Array.from(topics) : ['outro' as SentimentTopic]

  return {
    sentiment,
    dissatisfaction_score: score,
    confidence: 0.6, // confiança menor que a IA
    topics: topicList,
    summary: buildHeuristicSummary(sentiment, review.channel, topicList),
    ...(sentiment === 'negative' || sentiment === 'critical'
      ? { alert_reason: buildAlertReason(topicList, review.channel) }
      : {}),
    method: 'heuristic',
  }
}

// -----------------------------------------------------------------------------
// Análise apenas por rating (camada 3 — mínima)
// -----------------------------------------------------------------------------

function analyzeByRatingOnly(review: NormalizedReview): SentimentResult {
  const rating = review.rating

  if (rating === undefined) {
    return {
      sentiment: 'unanalyzed',
      dissatisfaction_score: 0,
      confidence: 0,
      topics: [],
      summary: 'Review sem texto para análise.',
      method: 'rating_only',
    }
  }

  const score = ratingToScore(rating)
  const sentiment = scoreToSentiment(score)

  return {
    sentiment,
    dissatisfaction_score: score,
    confidence: 0.7,
    topics: sentiment === 'positive' ? ['elogio'] : ['outro'],
    summary: `Cliente atribuiu ${rating} estrela${rating !== 1 ? 's' : ''} sem deixar comentário.`,
    method: 'rating_only',
  }
}

// -----------------------------------------------------------------------------
// Aplicar resultado no NormalizedReview
// -----------------------------------------------------------------------------

function applyResult(review: NormalizedReview, result: SentimentResult): void {
  review.sentiment = result.sentiment
  review.dissatisfaction_score = result.dissatisfaction_score
  review.sentiment_topics = result.topics
  review.sentiment_summary = result.summary
  review.sentiment_result = result
}

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

/** Constrói o texto de entrada para análise a partir dos campos disponíveis */
function buildReviewText(review: NormalizedReview): string {
  const parts: string[] = []
  if (review.title) parts.push(review.title)
  if (review.body) parts.push(review.body)
  return stripHtml(parts.join('\n\n').trim())
}

function stripHtml(text: string): string {
  return text
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ').replace(/&quot;/g, '"')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

function scoreToSentiment(score: number): SentimentType {
  if (score >= 81) return 'critical'
  if (score >= 56) return 'negative'
  if (score >= 31) return 'neutral'
  return 'positive'
}

function ratingToScore(rating: number): number {
  // Inverter escala: 1 estrela = score 90, 5 estrelas = score 5
  const map: Record<number, number> = { 1: 90, 2: 65, 3: 35, 4: 15, 5: 5 }
  return map[Math.round(rating)] ?? 50
}

function buildHeuristicSummary(
  sentiment: SentimentType,
  channel: SourceChannel,
  topics: SentimentTopic[]
): string {
  const channelName: Record<SourceChannel, string> = {
    google_maps: 'Google Maps',
    tripadvisor: 'TripAdvisor',
    trustpilot: 'Trustpilot',
    reclame_aqui: 'Reclame Aqui',
    consumidor_gov: 'Consumidor.gov',
    reddit: 'Reddit',
    facebook: 'Facebook',
    instagram: 'Instagram',
  }

  const topicNames: Record<string, string> = {
    atendimento: 'atendimento', cobrança: 'cobrança', produto: 'produto',
    entrega: 'entrega', app_plataforma: 'app/plataforma', cancelamento: 'cancelamento',
    dados_privados: 'dados pessoais', reembolso: 'reembolso', elogio: 'elogio', outro: '',
  }

  if (sentiment === 'positive') return `Cliente satisfeito em ${channelName[channel]}.`
  if (sentiment === 'neutral') return `Feedback misto em ${channelName[channel]}.`

  const meaningfulTopics = topics.map(t => topicNames[t] ?? '').filter(Boolean)
  const topicLabel = meaningfulTopics.length > 0
    ? ` — problema de ${meaningfulTopics.slice(0, 2).join(' e ')}`
    : ''
  const prefix = sentiment === 'critical' ? 'Reclamação grave' : 'Reclamação'
  return `${prefix}${topicLabel} em ${channelName[channel]}.`
}

function buildAlertReason(topics: SentimentTopic[], channel: SourceChannel): string {
  const urgentTopics = ['cobrança', 'dados_privados', 'cancelamento', 'reembolso']
  const hasUrgent = topics.some(t => urgentTopics.includes(t))

  if (channel === 'reclame_aqui' || channel === 'consumidor_gov') {
    return `Nova reclamação formal em ${channel === 'reclame_aqui' ? 'Reclame Aqui' : 'Consumidor.gov'}. Responda dentro do prazo para evitar penalidade.`
  }

  if (hasUrgent) {
    const urgentFound = topics.filter(t => urgentTopics.includes(t))
    return `Problema urgente detectado: ${urgentFound.join(', ')}. Verifique imediatamente.`
  }

  return `Review negativo detectado em ${topics.join(', ')}. Avalie se requer resposta pública.`
}

// Exportar para uso nos testes
export { analyzeByHeuristic, analyzeByRatingOnly, applyResult, CHANNEL_CONTEXT }
