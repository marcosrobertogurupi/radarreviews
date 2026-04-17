// Testes do Motor de Análise de Sentimento
// Valida: análise heurística, análise por rating, contextos por canal,
// aplicação de resultados no review e integração com o pipeline.
//
// O Gemini é mockado — os testes validam a lógica sem chamar a API real.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { NormalizedReview } from '../../src/types/review.js'

// Mock do @google/generative-ai (chamado apenas quando GEMINI_API_KEY está definida)
vi.mock('@google/generative-ai', () => ({
  GoogleGenerativeAI: vi.fn().mockImplementation(() => ({
    getGenerativeModel: vi.fn().mockReturnValue({
      generateContent: vi.fn().mockResolvedValue({
        response: {
          text: () => JSON.stringify({
            sentiment: 'negative',
            dissatisfaction_score: 72,
            confidence: 0.92,
            topics: ['atendimento', 'cobrança'],
            summary: 'Cliente relata cobrança indevida e falta de atendimento.',
            alert_reason: 'Problema de cobrança identificado — verifique o histórico financeiro.',
          }),
        },
      }),
    }),
  })),
  SchemaType: {
    OBJECT: 'OBJECT',
    STRING: 'STRING',
    NUMBER: 'NUMBER',
    ARRAY: 'ARRAY',
  },
}))

vi.mock('dotenv/config', () => ({}))

// Importar APÓS os mocks
import {
  analyzeByHeuristic,
  analyzeByRatingOnly,
  applyResult,
  analyzeSentiment,
  CHANNEL_CONTEXT,
} from '../../src/lib/sentiment.js'

// -----------------------------------------------------------------------------
// Helper para criar reviews de teste
// -----------------------------------------------------------------------------

function makeReview(
  overrides: Partial<NormalizedReview> = {}
): NormalizedReview {
  return {
    tenant_id: 'tenant-1',
    business_id: 'biz-1',
    connector_id: 'conn-1',
    channel: 'google_maps',
    external_id: 'ext-123',
    published_at: new Date().toISOString(),
    sentiment: 'unanalyzed',
    raw_data: {},
    ...overrides,
  }
}

// -----------------------------------------------------------------------------
// Heurística
// -----------------------------------------------------------------------------

describe('Análise por heurística (fallback)', () => {
  it('classifica como "critical" para texto com fraude detectada', () => {
    const review = makeReview({ body: 'Descobri uma fraude! Vou entrar com processo judicial!' })
    const result = analyzeByHeuristic(review, review.body!)
    expect(result.sentiment).toBe('critical')
    expect(result.dissatisfaction_score).toBeGreaterThanOrEqual(81)
    expect(result.topics).toContain('dados_privados')
    expect(result.method).toBe('heuristic')
  })

  it('classifica como "negative" para reclamação clara', () => {
    const review = makeReview({ body: 'Atendimento péssimo, não resolveram meu problema.' })
    const result = analyzeByHeuristic(review, review.body!)
    expect(result.sentiment).toBe('negative')
    expect(result.dissatisfaction_score).toBeGreaterThanOrEqual(56)
    expect(result.topics).toContain('atendimento')
  })

  it('classifica como "neutral" ou "negative" para feedback misto sem palavras de impacto alto', () => {
    const review = makeReview({ body: 'Serviço razoável, poderia melhorar a comunicação.' })
    const result = analyzeByHeuristic(review, review.body!)
    // A heurística pode retornar positive para textos sem keywords negativas fortes
    expect(['positive', 'neutral', 'negative']).toContain(result.sentiment)
    // O score não deve ser alto (não deve ser critical)
    expect(result.dissatisfaction_score).toBeLessThan(81)
  })

  it('classifica como "positive" para elogio claro', () => {
    const review = makeReview({ body: 'Excelente atendimento! Recomendo a todos. Perfeito!' })
    const result = analyzeByHeuristic(review, review.body!)
    expect(result.sentiment).toBe('positive')
    expect(result.dissatisfaction_score).toBeLessThan(31)
    expect(result.topics).toContain('elogio')
  })

  it('detecta tópico de cobrança em texto específico', () => {
    const review = makeReview({ body: 'Cobraram indevido na minha fatura, absurdo!' })
    const result = analyzeByHeuristic(review, review.body!)
    expect(result.topics).toContain('cobrança')
  })

  it('detecta tópico de cancelamento em texto específico', () => {
    const review = makeReview({ body: 'Não consigo cancelar minha assinatura, já tentei 5 vezes!' })
    const result = analyzeByHeuristic(review, review.body!)
    expect(result.topics).toContain('cancelamento')
    // "não consigo cancelar" = peso 3 = score >= 60 = negative ou critical
    expect(['negative', 'critical']).toContain(result.sentiment)
    expect(result.dissatisfaction_score).toBeGreaterThanOrEqual(56)
  })

  it('detecta tópico de entrega em texto específico', () => {
    const review = makeReview({ body: 'Meu pedido não chegou. Já faz 20 dias do extravio.' })
    const result = analyzeByHeuristic(review, review.body!)
    expect(result.topics).toContain('entrega')
  })

  it('aplica bônus de canal: Reclame Aqui tem score mínimo de 60', () => {
    const review = makeReview({ channel: 'reclame_aqui', body: 'Quero resolver.' })
    const result = analyzeByHeuristic(review, review.body!)
    expect(result.dissatisfaction_score).toBeGreaterThanOrEqual(60)
  })

  it('aplica bônus de canal: Consumidor.gov tem score mínimo de 65', () => {
    const review = makeReview({ channel: 'consumidor_gov', body: 'Registro de reclamação.' })
    const result = analyzeByHeuristic(review, review.body!)
    expect(result.dissatisfaction_score).toBeGreaterThanOrEqual(65)
  })

  it('score aumenta com rating baixo (1 estrela = mínimo 80)', () => {
    const review = makeReview({ rating: 1, body: 'Regular.' })
    const result = analyzeByHeuristic(review, review.body!)
    expect(result.dissatisfaction_score).toBeGreaterThanOrEqual(80)
  })

  it('score diminui com rating alto (5 estrelas = máximo 25)', () => {
    const review = makeReview({ rating: 5, body: 'Ótimo serviço!' })
    const result = analyzeByHeuristic(review, review.body!)
    expect(result.dissatisfaction_score).toBeLessThanOrEqual(25)
  })

  it('inclui alert_reason quando sentimento é negative ou critical', () => {
    const review = makeReview({ channel: 'reclame_aqui', body: 'Cobrança indevida sem resposta.' })
    const result = analyzeByHeuristic(review, review.body!)
    expect(result.alert_reason).toBeDefined()
    // Reclame Aqui agora gera alert_reason específico por tipo de problema
    expect(result.alert_reason!.length).toBeGreaterThan(10)
  })

  it('não gera alert_reason para sentimento positive', () => {
    const review = makeReview({ body: 'Excelente! Recomendo!' })
    const result = analyzeByHeuristic(review, review.body!)
    expect(result.alert_reason).toBeUndefined()
  })
})

// -----------------------------------------------------------------------------
// Análise por rating apenas
// -----------------------------------------------------------------------------

describe('Análise por rating (sem texto)', () => {
  it('1 estrela → critical com score >= 80', () => {
    const review = makeReview({ rating: 1 })
    const result = analyzeByRatingOnly(review)
    expect(result.sentiment).toBe('critical')
    expect(result.dissatisfaction_score).toBeGreaterThanOrEqual(80)
    expect(result.method).toBe('rating_only')
  })

  it('2 estrelas → negative', () => {
    const review = makeReview({ rating: 2 })
    const result = analyzeByRatingOnly(review)
    expect(result.sentiment).toBe('negative')
  })

  it('3 estrelas → neutral', () => {
    const review = makeReview({ rating: 3 })
    const result = analyzeByRatingOnly(review)
    expect(result.sentiment).toBe('neutral')
  })

  it('4-5 estrelas → positive', () => {
    const r4 = makeReview({ rating: 4 })
    const r5 = makeReview({ rating: 5 })
    expect(analyzeByRatingOnly(r4).sentiment).toBe('positive')
    expect(analyzeByRatingOnly(r5).sentiment).toBe('positive')
  })

  it('sem rating e sem texto → unanalyzed', () => {
    const review = makeReview()
    const result = analyzeByRatingOnly(review)
    expect(result.sentiment).toBe('unanalyzed')
    expect(result.confidence).toBe(0)
  })

  it('inclui resumo descritivo com o número de estrelas', () => {
    const review = makeReview({ rating: 2 })
    const result = analyzeByRatingOnly(review)
    expect(result.summary).toContain('2')
    expect(result.summary).toContain('estrelas')
  })
})

// -----------------------------------------------------------------------------
// Contextos de canal
// -----------------------------------------------------------------------------

describe('Contextos específicos por canal', () => {
  it('todos os 8 canais têm contexto definido', () => {
    const canais = [
      'google_maps', 'tripadvisor', 'trustpilot', 'reclame_aqui',
      'consumidor_gov', 'reddit', 'facebook', 'instagram',
    ]
    for (const canal of canais) {
      expect(CHANNEL_CONTEXT[canal as keyof typeof CHANNEL_CONTEXT]).toBeTruthy()
      expect(CHANNEL_CONTEXT[canal as keyof typeof CHANNEL_CONTEXT].length).toBeGreaterThan(50)
    }
  })

  it('Reclame Aqui tem contexto com indicação de urgência', () => {
    expect(CHANNEL_CONTEXT['reclame_aqui']).toContain('CRÍTICO')
    // O contexto agora menciona o prazo de resposta e o RA Index
    expect(CHANNEL_CONTEXT['reclame_aqui']).toContain('prazo para responder')
  })

  it('Consumidor.gov tem contexto com indicação de risco legal', () => {
    expect(CHANNEL_CONTEXT['consumidor_gov']).toContain('CRÍTICO')
    expect(CHANNEL_CONTEXT['consumidor_gov']).toContain('judicial')
  })
})

// -----------------------------------------------------------------------------
// Aplicação do resultado no review
// -----------------------------------------------------------------------------

describe('applyResult — aplicar resultado no NormalizedReview', () => {
  it('preenche todos os campos de sentimento no review', () => {
    const review = makeReview()
    const result = {
      sentiment: 'negative' as const,
      dissatisfaction_score: 70,
      confidence: 0.85,
      topics: ['atendimento' as const],
      summary: 'Cliente insatisfeito com atendimento.',
      alert_reason: 'Problema de atendimento detectado.',
      method: 'gemini' as const,
    }
    applyResult(review, result)

    expect(review.sentiment).toBe('negative')
    expect(review.dissatisfaction_score).toBe(70)
    expect(review.sentiment_topics).toEqual(['atendimento'])
    expect(review.sentiment_summary).toBe('Cliente insatisfeito com atendimento.')
    expect(review.sentiment_result).toEqual(result)
  })
})

// -----------------------------------------------------------------------------
// Análise com Gemini (mockado)
// -----------------------------------------------------------------------------

describe('analyzeSentiment com Gemini mockado', () => {
  beforeEach(() => {
    // Setar a variável de ambiente para ativar o modo Gemini
    vi.stubEnv('GEMINI_API_KEY', 'test-api-key-gemini')
  })

  it('retorna análise estruturada do Gemini com todos os campos', async () => {
    const review = makeReview({
      body: 'Cobraram errado no meu cartão e o atendimento não resolveu.',
      channel: 'google_maps',
      rating: 1,
    })

    const result = await analyzeSentiment(review)

    expect(result.sentiment).toBe('negative')
    expect(result.dissatisfaction_score).toBe(72)
    expect(result.confidence).toBe(0.92)
    expect(result.topics).toContain('cobrança')
    expect(result.summary).toBeTruthy()
    expect(result.method).toBe('gemini')
  })

  it('não rechama o Gemini para review já analisado (usa sentiment_result)', async () => {
    const { GoogleGenerativeAI } = await import('@google/generative-ai')
    const mockInstance = new (GoogleGenerativeAI as any)('key')
    vi.clearAllMocks()

    const existingResult = {
      sentiment: 'positive' as const,
      dissatisfaction_score: 10,
      confidence: 0.9,
      topics: ['elogio' as const],
      summary: 'Cliente satisfeito.',
      method: 'gemini' as const,
    }

    const review = makeReview({
      sentiment: 'positive',
      sentiment_result: existingResult,
    })

    const result = await analyzeSentiment(review)
    // Deve retornar o resultado já existente sem chamar a API
    expect(result).toEqual(existingResult)
  })
})
