import { describe, it, expect, vi, beforeEach } from 'vitest'
import { getPlanReviewBudget, checkTenantScrapeQuota } from '../src/lib/apify-quota.js'

// Mock do cliente Supabase
vi.mock('../src/lib/supabase.js', () => ({
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      insert: vi.fn().mockReturnThis(),
      update: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({
        data: {
          id: 'quota-123',
          tenant_id: 'tenant-123',
          channel: 'google_maps',
          monthly_review_budget: 100,
          consumed_this_cycle: 10,
          cycle_reset_at: new Date(Date.now() + 86400000).toISOString(),
          hard_cap: true
        },
        error: null
      })
    }))
  }
}))

describe('Apify Quota & Budget Service', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('deve retornar o orçamento correto por plano', () => {
    expect(getPlanReviewBudget('trial')).toBe(200)
    expect(getPlanReviewBudget('basico')).toBe(1000)
    expect(getPlanReviewBudget('completo')).toBe(5000)
    expect(getPlanReviewBudget('enterprise')).toBe(20000)
    expect(getPlanReviewBudget('desconhecido')).toBe(1000)
  })

  it('deve permitir chamadas dentro do orçamento para jobs incrementais', async () => {
    const res = await checkTenantScrapeQuota('tenant-123', 'google_maps', 20, 'incremental')
    expect(res.allowed).toBe(true)
    expect(res.safeLimit).toBeLessThanOrEqual(20)
    expect(res.estimatedCostUsd).toBeGreaterThan(0)
  })

  it('deve limitar safeLimit se solicitado exceder cota restante', async () => {
    const { supabase } = await import('../src/lib/supabase.js')
    vi.mocked(supabase.from).mockReturnValueOnce({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValueOnce({
        data: {
          id: 'quota-123',
          tenant_id: 'tenant-123',
          channel: 'google_maps',
          monthly_review_budget: 100,
          consumed_this_cycle: 95, // Faltam 5
          cycle_reset_at: new Date(Date.now() + 86400000).toISOString(),
          hard_cap: true
        },
        error: null
      })
    } as any)

    const res = await checkTenantScrapeQuota('tenant-123', 'google_maps', 50, 'incremental')
    expect(res.allowed).toBe(true)
    expect(res.safeLimit).toBe(5) // Limitado a 5 restantes
  })

  it('deve bloquear a chamada se a cota foi atingida', async () => {
    const { supabase } = await import('../src/lib/supabase.js')
    vi.mocked(supabase.from).mockReturnValueOnce({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValueOnce({
        data: {
          id: 'quota-123',
          tenant_id: 'tenant-123',
          channel: 'google_maps',
          monthly_review_budget: 100,
          consumed_this_cycle: 100, // Cota estourada
          cycle_reset_at: new Date(Date.now() + 86400000).toISOString(),
          hard_cap: true
        },
        error: null
      })
    } as any)

    const res = await checkTenantScrapeQuota('tenant-123', 'google_maps', 20, 'incremental')
    expect(res.allowed).toBe(false)
    expect(res.safeLimit).toBe(0)
    expect(res.reason).toContain('Cota mensal de reviews excedida')
  })
})
