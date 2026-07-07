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
import { callGeminiWithRetry } from './gemini-rate-limiter.js'
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
CONTEXTO CRÍTICO: Reclamação formal no Reclame Aqui — plataforma de última instância do consumidor brasileiro.

JORNADA DO CLIENTE: Quando chega ao Reclame Aqui, o cliente JÁ tentou resolver antes (SAC, chat, loja) e foi ignorado ou mal atendido. Este é o último recurso antes do Procon/Juizado.

IMPACTO NO NEGÓCIO:
- A empresa tem prazo para responder (geralmente 7-10 dias). A não-resposta penaliza o RA Index publicamente.
- O RA Index (reputação calculada pelo Reclame Aqui) é exibido para milhões de consumidores na busca.
- Uma resposta insatisfatória é tão prejudicial quanto a não-resposta.

CATEGORIAS DE DOR MAIS COMUNS (identifique qual se aplica):
- FINANCEIRO: cobrança indevida, cobrança após cancelamento, débito não autorizado, não reembolso, estorno negado
- CANCELAMENTO: plano/assinatura que não cancela, taxa de cancelamento abusiva, prazo de fidelidade irregular
- PRAZO: produto/serviço não entregue no prazo prometido, instalação que não aconteceu, ativação que não ocorreu
- SUPORTE: impossível contatar a empresa, bot que não resolve, atendimento que não responde, transferências infinitas
- DADOS: conta bloqueada indevidamente, dados alterados sem autorização, acesso negado à própria conta
- FRAUDE: cobrança de serviço não contratado, golpe, clonagem

CALIBRAÇÃO DE SCORE:
- Problema financeiro (cobrança indevida, não reembolso): mínimo 70
- Cancelamento não efetivado: mínimo 65
- Prazo descumprido: mínimo 60
- Suporte inexistente (meses sem resposta): mínimo 75
- Fraude / ameaça judicial: mínimo 85
- Qualquer outra reclamação: mínimo 50`.trim(),

  consumidor_gov: `
CONTEXTO CRÍTICO: Reclamação formal ao Governo Federal — consumidor.gov.br (Senacon/Ministério da Justiça).

JORNADA DO CLIENTE: O cliente foi ao governo porque ESGOTOU tentativas com a empresa (SAC, chat, loja, Reclame Aqui). Esta é a escalada máxima antes do Procon ou ação judicial.

PESO LEGAL DA PLATAFORMA:
- A empresa tem prazo OBRIGATÓRIO de 10 dias para responder. Não responder gera autuação pelo Senacon.
- O histórico de reclamações é público e consultado por órgãos de defesa do consumidor.
- Alta probabilidade de ação judicial se não resolvido — especialmente problemas financeiros e dados.
- A nota dada pelo consumidor ao final (0-10) impacta o índice público da empresa.

ASSUNTOS MAIS GRAVES (identifique qual se aplica):
- FINANCEIRO: cobrança indevida, débito não autorizado, estorno negado, reembolso não pago, duplicidade de cobrança
- CANCELAMENTO: plano que não cancela, portabilidade negada, fidelidade irregular, multa abusiva
- DADOS PESSOAIS: conta bloqueada indevidamente, dados vazados, acesso negado à própria conta, alteração não autorizada
- QUALIDADE: produto com defeito grave, serviço não prestado, propaganda enganosa
- ENTREGA/PRAZO: produto não entregue, serviço não ativado, prazo prometido descumprido

CALIBRAÇÃO DE SCORE (mais severa que o Reclame Aqui — este canal é o último recurso):
- Problema financeiro (cobrança, reembolso, estorno): mínimo 75
- Dados pessoais, cancelamento não efetivado: mínimo 80
- Fraude, ameaça judicial, produto com defeito grave: mínimo 85
- Qualquer outra reclamação: mínimo 65`.trim(),

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
// Metadados extras para Reclame Aqui
// Injetados no prompt além do contexto do canal para calibrar melhor a análise
// -----------------------------------------------------------------------------

function buildReclameAquiExtra(review: NormalizedReview): string {
  const parts: string[] = []
  const tags = review.tags ?? []
  const fullText = [review.title ?? '', review.body ?? ''].join(' ').toLowerCase()

  // Status da reclamação na plataforma
  const isResolved = tags.some(t => /resolvido|avaliado/i.test(t))
  const isInProgress = tags.some(t => /andamento|respondido/i.test(t))
  const isUnresolved = tags.some(t => /n.o resolvido|n.o respondida|arquivado/i.test(t))

  if (isResolved) {
    parts.push('STATUS DA RECLAMAÇÃO: Resolvida — a empresa respondeu e o cliente avaliou como resolvido.')
  } else if (isInProgress) {
    parts.push('STATUS DA RECLAMAÇÃO: Em andamento — a empresa respondeu mas o caso ainda não foi encerrado.')
  } else if (isUnresolved) {
    parts.push('STATUS DA RECLAMAÇÃO: NÃO RESOLVIDA — a empresa não conseguiu resolver o problema. Penaliza gravemente o RA Index.')
  } else {
    parts.push('STATUS DA RECLAMAÇÃO: Aguardando resposta da empresa — prazo legal ainda não expirou.')
  }

  // Detectar menção a valor financeiro
  if (/r\$\s*\d|reais|\d+,\d{2}|valor de|cobr(aram|ança|ado)|débito|estorno|reembolso/i.test(fullText)) {
    parts.push('ALERTA FINANCEIRO: A reclamação menciona valor monetário ou cobrança — prioridade elevada.')
  }

  // Detectar ameaça legal
  if (/procon|juizado|judicial|processo|anatel|bacen|banco central|ministerio|ministério|senacon/i.test(fullText)) {
    parts.push('ALERTA LEGAL: O cliente menciona órgão regulador ou ação judicial — risco jurídico imediato.')
  }

  // Detectar tempo sem resolução
  const monthsMatch = fullText.match(/(\d+)\s*mes(es)?|(\d+)\s*semana/i)
  if (monthsMatch) {
    parts.push(`TEMPO SEM RESOLUÇÃO: O cliente relata problema há ${monthsMatch[0]} — frustração acumulada elevada.`)
  }

  return parts.length > 0 ? '\n\nMETADADOS DA RECLAMAÇÃO:\n' + parts.join('\n') : ''
}

// -----------------------------------------------------------------------------
// Metadados extras para Consumidor.gov
// Aproveita os campos estruturados do CSV do governo federal:
//   is_resolved, response_time_days, title (assunto), tags (area/segmento)
// -----------------------------------------------------------------------------

function buildConsumidorGovExtra(review: NormalizedReview): string {
  const parts: string[] = []
  const fullText = [review.title ?? '', review.body ?? ''].join(' ').toLowerCase()

  // Status de resolução (vem diretamente do campo RESOLVIDO do CSV)
  if (review.is_resolved === true) {
    parts.push('STATUS: RESOLVIDA — a empresa resolveu o problema. A nota do consumidor reflete a qualidade da resolução.')
  } else if (review.is_resolved === false) {
    parts.push('STATUS: NÃO RESOLVIDA — a empresa não conseguiu resolver. Impacta severamente o índice público da empresa no Senacon.')
  } else {
    parts.push('STATUS: Aguardando resolução — prazo obrigatório de 10 dias em curso.')
  }

  // Tempo de resposta (campo estruturado do CSV)
  if (review.response_time_days !== undefined) {
    if (review.response_time_days === 0) {
      parts.push('TEMPO DE RESPOSTA: Respondida no mesmo dia.')
    } else if (review.response_time_days <= 3) {
      parts.push(`TEMPO DE RESPOSTA: Respondida em ${review.response_time_days} dia(s) — dentro do prazo.`)
    } else if (review.response_time_days <= 10) {
      parts.push(`TEMPO DE RESPOSTA: Respondida em ${review.response_time_days} dias — no limite do prazo legal.`)
    } else {
      parts.push(`TEMPO DE RESPOSTA: ${review.response_time_days} dias — PRAZO EXPIRADO. Empresa pode ter sido autuada pelo Senacon.`)
    }
  }

  // Assunto classificado pelo Senacon (campo ASSUNTO do CSV — vem no title)
  if (review.title) {
    parts.push(`ASSUNTO CLASSIFICADO: "${review.title}" — categoria oficial atribuída pelo Senacon ao registrar a reclamação.`)
  }

  // Segmento e área (vêm nas tags do CSV)
  const tags = (review.tags ?? []).filter(t => t && !['consumidor_gov'].includes(t))
  if (tags.length > 0) {
    parts.push(`SEGMENTO/ÁREA: ${tags.join(' / ')} — contexto setorial da reclamação.`)
  }

  // Nota de satisfação (0-10 dada pelo consumidor ao fechar a reclamação)
  if (review.rating !== undefined) {
    const ratingLabel = review.rating <= 3 ? 'PÉSSIMO' : review.rating <= 6 ? 'RUIM' : 'REGULAR'
    parts.push(`NOTA DE SATISFAÇÃO: ${review.rating}/10 (${ratingLabel}) — avaliação do consumidor sobre a resolução.`)
  }

  // Detectar menção a valor financeiro no texto
  if (/r\$\s*\d|reais|\d+,\d{2}|cobr(aram|ança|ado)|débito|estorno|reembolso/i.test(fullText)) {
    parts.push('ALERTA FINANCEIRO: A reclamação menciona valor monetário — risco de ação judicial por dano material.')
  }

  // Detectar ameaça legal
  if (/procon|juizado|judicial|processo|anatel|bacen|banco central|senacon/i.test(fullText)) {
    parts.push('ALERTA LEGAL: O cliente menciona ação judicial ou órgão regulador — risco jurídico imediato e iminente.')
  }

  return parts.length > 0 ? '\n\nMETADADOS ESTRUTURADOS DO GOVERNO:\n' + parts.join('\n') : ''
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
      const result = await callGeminiWithRetry(() => analyzeWithGemini(genAI, review, text))
      logger.info(
        '[sentiment] Análise via Gemini 3.5 Flash',
        { model: AI_CONFIG.model, method: 'gemini', review_id: review.external_id }
      )
      analysisCache.set(key, result)
      return result
    } catch (error) {
      logger.warn('[sentiment] Gemini indisponível, usando heurística', {
        model: AI_CONFIG.model,
        method: 'heuristic',
        review_id: review.external_id,
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

import { AI_CONFIG } from './ai-config.js'

async function analyzeWithGemini(
  genAI: GoogleGenerativeAI,
  review: NormalizedReview,
  text: string
): Promise<SentimentResult> {
  const model = genAI.getGenerativeModel({
    model: AI_CONFIG.model,
    generationConfig: {
      responseMimeType: AI_CONFIG.responseMimeType,
      temperature: AI_CONFIG.temperature,
      maxOutputTokens: AI_CONFIG.maxOutputTokens,
    },
  })

  const channelContext = CHANNEL_CONTEXT[review.channel]
  const isReclameAqui = review.channel === 'reclame_aqui'
  const isConsumidorGov = review.channel === 'consumidor_gov'
  const ratingContext = review.rating !== undefined
    ? `\nNota: ${review.rating}/5 estrelas.`
    : ''

  // Para Reclame Aqui e Consumidor.gov: injeta metadados extras e amplia limite de texto
  const extraContext = isReclameAqui 
    ? buildReclameAquiExtra(review) 
    : (isConsumidorGov ? buildConsumidorGovExtra(review) : '')
  const textLimit = (isReclameAqui || isConsumidorGov) ? 2000 : 800

  // Seção especializada de instruções apenas para Reclame Aqui
  const raSpecificSection = isReclameAqui ? `

INSTRUÇÕES ESPECÍFICAS PARA RECLAME AQUI:
- Identifique a DOR CENTRAL: o que o cliente perdeu (dinheiro, tempo, acesso, serviço)?
- Identifique o PADRÃO DE FALHA: a empresa cobrou indevidamente? Não cancelou? Não respondeu? Não entregou?
- O dissatisfaction_score deve refletir: gravidade do problema + tempo sem resolução + impacto financeiro
- Se há valor monetário mencionado (R$), eleve o score pelo menos 10 pontos
- Se o cliente menciona meses sem resolução, eleve o score pelo menos 15 pontos
- Se há ameaça legal (procon, juizado), classifique como "critical" e eleve score para no mínimo 85
- alert_reason deve ser uma AÇÃO ESPECÍFICA: não use frases genéricas, diga o QUE fazer e POR QUÊ é urgente` : ''

  // Seção especializada de instruções apenas para Consumidor.gov
  const cgSpecificSection = isConsumidorGov ? `

INSTRUÇÕES ESPECÍFICAS PARA CONSUMIDOR.GOV:
- Este é um canal OFICIAL DO GOVERNO. A severidade deve ser TRATADA COMO MÁXIMA.
- Analise os METADADOS ESTRUTURADOS: o tempo de resposta e o status de resolução são fundamentais.
- Identifique se o problema envolve DIREITOS DO CONSUMIDOR básicos ou FALHA GRAVE de segurança/financeira.
- O dissatisfaction_score deve ser calibrado de forma severa: este é o último recurso do cliente.
- Se o prazo de 10 dias expirou, o score deve ser no mínimo 90.
- alert_reason deve focar no RISCO LEGAL e na necessidade de resolução definitiva para evitar multas Senacon.` : ''

  const prompt = `
Analise o sentimento desta reclamação brasileira e retorne JSON.

CONTEXTO DO CANAL:
${channelContext}${ratingContext}${extraContext}${raSpecificSection}${cgSpecificSection}

TEXTO DA RECLAMAÇÃO:
"""
${text.slice(0, textLimit)}
"""

RETORNE APENAS este JSON (nenhum texto extra, nenhum markdown):
{"sentiment":"positive|neutral|negative|critical","dissatisfaction_score":0,"confidence":0.0,"topics":["topic1","topic2"],"summary":"O que aconteceu","sentiment_translation":"Explique em 1 frase por que o cliente está assim (traduza o sentimento)","action_suggestion":"O que a empresa deve fazer agora (máx 15 palavras)"}

TÓPICOS DISPONÍVEIS (escolha 1 a 3, os mais específicos):
- atendimento = mau atendimento, ignorado, sem resposta, funcionário rude, manutenção não feita, suporte precário
- produto = produto defeituoso, qualidade ruim do produto/serviço entregue, estrutura física deteriorada
- cobrança = cobrança indevida, valor errado, taxa abusiva, propaganda enganosa de preço, divergência de valores
- entrega = produto/serviço não entregue, entrega errada, atraso na entrega
- app_plataforma = app travando, site fora do ar, plataforma com erro, problema técnico no sistema
- cancelamento = não consegue cancelar, cancelamento negado, impossível encerrar contrato/reserva
- dados_privados = vazamento de dados, uso indevido de informações pessoais
- reembolso = dinheiro não devolvido, estorno negado, crédito não recebido após cancelamento ou devolução
- prazo = demora excessiva, promessa de prazo não cumprida, aguardando resolução há muito tempo
- suporte_inexistente = impossível falar com suporte, nenhum canal de atendimento funciona, empresa não responde
- cancelamento_nao_efetivado = solicitou cancelamento mas continua sendo cobrado ou contrato ativo
- elogio = experiência positiva, satisfeito, recomenda, agradece
- outro = APENAS quando NENHUM dos tópicos acima se encaixa — evite ao máximo

REGRAS DE SENTIMENTO:
- critical=ameaça judicial/fraude/não consegue cancelar/bloqueio indevido de conta
- negative=insatisfeito com problema real não resolvido
- neutral=misto/mediano/dúvida
- positive=satisfeito/elogio

REGRAS DO CAMPO sentiment_translation:
- Seja o "intérprete" do cliente. Ex: "O cliente sente que foi enganado pela promessa de preço", "Está frustrado com a falta de retorno após várias tentativas"
- Use linguagem empática e direta

REGRAS DO CAMPO action_suggestion:
- Dê um comando acionável. Ex: "Ligar para o cliente e oferecer o reembolso imediato", "Responder pedindo desculpas e agendar a visita técnica"
- Se for positivo, sugira agradecer e pedir para compartilhar nas redes sociais.
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

  const topics = Array.isArray(parsed.topics) ? parsed.topics as SentimentTopic[] : ['outro']
  let rawScore = Math.round(Math.max(0, Math.min(100, Number(parsed.dissatisfaction_score) || 0)))

  // Aplicar floor de score mínimo por canal — a IA pode subestimar a gravidade
  if (review.channel === 'reclame_aqui') {
    const financialSet = new Set<string>(['cobrança', 'reembolso'])
    const urgentSet = new Set<string>(['cancelamento_nao_efetivado', 'suporte_inexistente', 'dados_privados'])
    const hasFinancial = topics.some(t => financialSet.has(t as string))
    const hasUrgent = topics.some(t => urgentSet.has(t as string))
    if (hasFinancial) rawScore = Math.max(rawScore, 70)
    else if (hasUrgent) rawScore = Math.max(rawScore, 65)
    else rawScore = Math.max(rawScore, 50)
  } else if (review.channel === 'consumidor_gov') {
    rawScore = Math.max(rawScore, 65)
  }

  // Enriquecer alert_reason para Reclame Aqui e Consumidor.gov com ação específica
  let alertReason = parsed['alert_reason'] ? String(parsed['alert_reason']) : undefined
  if (review.channel === 'reclame_aqui' && !alertReason) {
    alertReason = buildReclameAquiAlertReason(topics, review.tags ?? [])
  } else if (review.channel === 'consumidor_gov' && !alertReason) {
    alertReason = buildConsumidorGovAlertReason(topics, review.tags ?? [], review.is_resolved, review.response_time_days)
  } else if (review.channel === 'reclame_aqui' && alertReason) {
    // Complementar com urgência do status se não mencionado
    const tags = review.tags ?? []
    const isUnresolved = tags.some(t => /n.o resolvido|n.o respondida|arquivado/i.test(t))
    if (isUnresolved && !alertReason.toLowerCase().includes('índice')) {
      alertReason += ' RA Index em risco — reclamação marcada como não resolvida.'
    }
  } else if (review.channel === 'consumidor_gov' && alertReason) {
    // Complementar com risco legal se não mencionado
    if (review.is_resolved === false && !alertReason.toLowerCase().includes('legal')) {
      alertReason += ' Risco legal elevado — reclamação oficial marcada como não resolvida.'
    }
  }

  return {
    sentiment: parsed.sentiment as SentimentType,
    dissatisfaction_score: rawScore,
    confidence: Math.max(0, Math.min(1, Number(parsed.confidence) || 0.8)),
    topics: topics as SentimentTopic[],
    summary: parsed.sentiment_translation ? `${parsed.summary} — ${parsed.sentiment_translation}` : String(parsed.summary ?? ''),
    alert_reason: alertReason,
    action_suggestion: parsed['action_suggestion'] ? String(parsed['action_suggestion']) : undefined,
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
  // Léve (peso 1)
  [/decepcionante|decepcionado|insatisfeito|frustr/i, 1, 'outro'],
  [/demorou|demorada|demora|lento/i, 1, 'atendimento'],
  [/cuidado|aten[çc][ãa]o|cuidado|evitem/i, 1, 'outro'],
  [/ruim|mal|não gostei/i, 1, 'outro'],
  // Novos tópicos específicos de Reclame Aqui
  [/prazo|prometido|não ativou|não foi instalado|não foi entregue no prazo/i, 2, 'prazo'],
  [/não consigo falar|não atende|ninguém responde|robô|bot|transfer[eê]ncia|fila de espera/i, 2, 'suporte_inexistente'],
  [/não cancela|não foi cancelado|tenta cancelar|impossível cancelar|recusa cancelamento/i, 3, 'cancelamento_nao_efetivado'],
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
    alert_reason: (sentiment === 'negative' || sentiment === 'critical') ? buildAlertReason(topicList, review.channel) : undefined,
    action_suggestion: (sentiment === 'negative' || sentiment === 'critical') ? 'Analise o comentário e responda com empatia, buscando resolver o problema citado.' : undefined,
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
  review.sentiment_suggestion = result.action_suggestion
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
    dados_privados: 'dados pessoais', reembolso: 'reembolso',
    prazo: 'prazo não cumprido', suporte_inexistente: 'suporte inacessível',
    cancelamento_nao_efetivado: 'cancelamento não efetivado',
    elogio: 'elogio', outro: '',
  }

  const meaningfulTopics = topics
    .filter(t => t !== 'elogio') // Nunca listar elogio como tópico de "problema"
    .map(t => topicNames[t] ?? '')
    .filter(Boolean)

  const topicLabel = meaningfulTopics.length > 0
    ? ` — problema de ${meaningfulTopics.slice(0, 2).join(' e ')}`
    : ''

  if (sentiment === 'positive') return `Cliente satisfeito em ${channelName[channel]}.`
  if (sentiment === 'neutral') return `Feedback misto em ${channelName[channel]}.`

  const prefix = sentiment === 'critical' ? 'Reclamação grave' : 'Reclamação'
  return `${prefix}${topicLabel} em ${channelName[channel]}.`
}

function buildAlertReason(topics: SentimentTopic[], channel: SourceChannel): string {
  const urgentTopics = ['cobrança', 'dados_privados', 'cancelamento', 'reembolso', 'cancelamento_nao_efetivado']
  const hasUrgent = topics.some(t => urgentTopics.includes(t))

  if (channel === 'reclame_aqui') {
    return buildReclameAquiAlertReason(topics, [])
  }

  if (channel === 'consumidor_gov') {
    return 'Reclamação formal ao governo — risco legal. Responda dentro do prazo obrigatório e resolva o problema documentado.'
  }

  if (hasUrgent) {
    const urgentFound = topics.filter(t => urgentTopics.includes(t))
    return `Problema urgente detectado: ${urgentFound.join(', ')}. Verifique imediatamente.`
  }

  return `Review negativo detectado em ${topics.join(', ')}. Avalie se requer resposta pública.`
}

/**
 * Gera um alert_reason específico para reclações do Reclame Aqui.
 * Baseado no tipo de problema detectado e no status atual da reclamação.
 */
function buildReclameAquiAlertReason(topics: string[], tags: string[]): string {
  const isUnresolved = tags.some(t => /n.o resolvido|n.o respondida|arquivado/i.test(t))
  const isInProgress = tags.some(t => /andamento|respondido/i.test(t))

  // Prioridade: tipo de problema
  if (topics.includes('cancelamento_nao_efetivado')) {
    return 'URGENTE: Cliente não consegue cancelar — cobranças continuam. Cancele imediatamente e confirme por escrito no RA.'
  }
  if (topics.includes('dados_privados')) {
    return 'URGENTE: Problema envolvendo dados pessoais ou acesso à conta — risco jurídico imediato. Acione equipe de segurança.'
  }
  if (topics.includes('cobrança') || topics.includes('reembolso')) {
    const suffix = isUnresolved ? ' RA Index já penalizado — resolva e peça reavaliação.' : ''
    return `Problema financeiro relatado — verifique cobrança e processe reembolso se devido.${suffix}`
  }
  if (topics.includes('suporte_inexistente')) {
    return 'Cliente sem acesso ao suporte — frustração máxima. Responda com canal de contato direto e nome do responsável.'
  }
  if (topics.includes('prazo')) {
    return 'Prazo prometido não cumprido — confirme nova data e ofereça compensação se aplicável.'
  }

  // Status como fallback
  if (isUnresolved) {
    return 'Reclamação marcada como NÃO RESOLVIDA — RA Index em risco. Retome contato e resolva ou justifique.'
  }
  if (isInProgress) {
    return 'Reclamação em andamento — prossiga com a resolução e peça avaliação do cliente ao concluir.'
  }

  return 'Nova reclamação no Reclame Aqui — responda dentro do prazo (7-10 dias) para manter o RA Index.'
}

/**
 * Gera um alert_reason específico para reclamações do Consumidor.gov.
 * Baseado no tipo de problema e no status oficial do governo.
 */
function buildConsumidorGovAlertReason(
  topics: string[],
  tags: string[],
  isResolved?: boolean,
  responseTime?: number
): string {
  const isUnresolved = isResolved === false
  const overdue = (responseTime ?? 0) > 10

  if (topics.includes('dados_privados')) {
    return 'CRÍTICO: Violação de dados ou acesso em canal oficial do governo. Acione jurídico e compliance imediatamente.'
  }
  if (topics.includes('cancelamento_nao_efetivado')) {
    return 'URGENTE: Falha no cancelamento reportada ao governo. Risco de multa Senacon por descumprimento de norma setorial.'
  }
  if (topics.includes('cobrança') || topics.includes('reembolso')) {
    return `Problema financeiro em canal governamental. Verifique se houve erro sistêmico e processe o estorno com prioridade.${isUnresolved ? ' Caso marcado como não resolvido.' : ''}`
  }
  if (overdue) {
    return 'ALERTA: Prazo legal de 10 dias expirado nesta reclamação. Risco de autuação administrativa imediata.'
  }
  if (isUnresolved) {
    return 'Reclamação oficial NÃO RESOLVIDA. Verifique se cabe proposta de acordo para evitar judicialização.'
  }

  return 'Nova reclamação no Consumidor.gov — canal oficial com prazo de 10 dias. Requer resposta técnica detalhada.'
}

// Exportar para uso nos testes
export { analyzeByHeuristic, analyzeByRatingOnly, applyResult, CHANNEL_CONTEXT }
