import { describe, it, expect } from 'vitest'
import { calculateEstimatedCostUsd } from '../../src/lib/telemetry'

describe('Telemetry & FinOps Unit Tests', () => {
  it('calcula corretamente o custo estimado de tokens Gemini', () => {
    // Gemini 2.5 Flash: 1.000.000 tokens ≈ $0.15
    const cost = calculateEstimatedCostUsd('gemini', 'tokens', 1_000_000)
    expect(cost).toBeCloseTo(0.15, 2)
  })

  it('calcula corretamente o custo estimado de execuções Apify', () => {
    // Apify: 100 execuções * $0.003 = $0.30
    const cost = calculateEstimatedCostUsd('apify', 'executions', 100)
    expect(cost).toBeCloseTo(0.30, 2)
  })

  it('calcula corretamente o custo de tempo de compute do Railway', () => {
    // Railway: 1.000 segundos de compute * $0.000005 = $0.005
    const cost = calculateEstimatedCostUsd('railway', 'cpu_ram_seconds', 1000)
    expect(cost).toBe(0.005)
  })

  it('retorna valor positivo para métrica desconhecida', () => {
    const cost = calculateEstimatedCostUsd('vercel', 'requests', 100)
    expect(cost).toBeGreaterThan(0)
  })
})
