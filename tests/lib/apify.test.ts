import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  normalizeActorId,
  ACTOR_SAFETY_LIMITS,
  calculateAndClampLimit,
} from '../../src/lib/apify.js'

describe('Apify Integration & Safety Limits', () => {
  const originalEnv = process.env.APIFY_MAX_COST_PER_RUN

  beforeEach(() => {
    delete process.env.APIFY_MAX_COST_PER_RUN
  })

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env.APIFY_MAX_COST_PER_RUN = originalEnv
    } else {
      delete process.env.APIFY_MAX_COST_PER_RUN
    }
  })

  describe('normalizeActorId', () => {
    it('deve converter a barra em til para atores de terceiros da comunidade', () => {
      expect(normalizeActorId('viralanalyzer/reclameaqui-scraper')).toBe('viralanalyzer~reclameaqui-scraper')
      expect(normalizeActorId('pear_fight/trustpilot-scraper')).toBe('pear_fight~trustpilot-scraper')
    })

    it('deve manter o ID inalterado quando já utiliza o til', () => {
      expect(normalizeActorId('viralanalyzer~reclameaqui-scraper')).toBe('viralanalyzer~reclameaqui-scraper')
      expect(normalizeActorId('apify~instagram-comment-scraper')).toBe('apify~instagram-comment-scraper')
    })

    it('deve lidar adequadamente com strings vazias ou nulas', () => {
      expect(normalizeActorId('')).toBe('')
    })
  })

  describe('ACTOR_SAFETY_LIMITS', () => {
    it('deve possuir limites seguros predefinidos para Reclame Aqui e Trustpilot', () => {
      expect(ACTOR_SAFETY_LIMITS.reclame_aqui).toBeDefined()
      expect(ACTOR_SAFETY_LIMITS.reclame_aqui.maxItems).toBe(10)
      expect(ACTOR_SAFETY_LIMITS.reclame_aqui.costPerItem).toBe(0.05)

      expect(ACTOR_SAFETY_LIMITS.trustpilot).toBeDefined()
      expect(ACTOR_SAFETY_LIMITS.trustpilot.maxItems).toBe(15)
      expect(ACTOR_SAFETY_LIMITS.trustpilot.costPerItem).toBe(0.0015)
    })
  })

  describe('calculateAndClampLimit (Guard-Rail de Custo)', () => {
    it('deve aplicar o teto máximo de itens do canal quando o valor solicitado for alto', () => {
      const { safeLimit, estimatedCostUsd } = calculateAndClampLimit('reclame_aqui', 100)
      expect(safeLimit).toBe(10)
      expect(estimatedCostUsd).toBeCloseTo(0.50, 4)
    })

    it('deve aplicar o teto do Trustpilot corretamente', () => {
      const { safeLimit, estimatedCostUsd } = calculateAndClampLimit('trustpilot', 50)
      expect(safeLimit).toBe(15)
      expect(estimatedCostUsd).toBeCloseTo(0.0225, 4)
    })

    it('deve respeitar limites baixos dentro do teto permitido', () => {
      const { safeLimit, estimatedCostUsd } = calculateAndClampLimit('reclame_aqui', 5)
      expect(safeLimit).toBe(5)
      expect(estimatedCostUsd).toBeCloseTo(0.25, 4)
    })

    it('deve reduzir o limite automaticamente quando o orcamento APIFY_MAX_COST_PER_RUN for menor que o custo normal', () => {
      process.env.APIFY_MAX_COST_PER_RUN = '0.15' // $0.15 USD max
      // Para o Reclame Aqui ($0.05/item), $0.15 só permite 3 itens
      const { safeLimit, estimatedCostUsd } = calculateAndClampLimit('reclame_aqui', 10)
      expect(safeLimit).toBe(3)
      expect(estimatedCostUsd).toBeCloseTo(0.15, 4)
    })
  })
})
