import { describe, it, expect, vi, beforeEach } from 'vitest'

const mocks = vi.hoisted(() => {
  const state = {
    reviews: [] as any[],
    reputationScores: [] as any[],
    reputationHistory: [] as any[],
    businesses: [] as any[],
    tenants: [] as any[]
  }

  const fromFn = (table: string) => {
    let selectCols: string | null = null
    let eqField: string | null = null
    let eqValue: any = null
    let gteField: string | null = null
    let gteValue: any = null
    let orderCol: string | null = null
    let orderOpts: any = null
    let isSingle = false

    const query: any = {
      select: (cols?: string) => {
        selectCols = cols || '*'
        return query
      },
      eq: (field: string, val: any) => {
        eqField = field
        eqValue = val
        return query
      },
      gte: (field: string, val: any) => {
        gteField = field
        gteValue = val
        return query
      },
      order: (col: string, opts?: any) => {
        orderCol = col
        orderOpts = opts
        return query
      },
      single: () => {
        isSingle = true
        return query
      },
      upsert: (data: any, _opts?: any) => {
        const arr = Array.isArray(data) ? data : [data]
        if (table === 'reputation_scores') {
          for (const item of arr) {
            const idx = state.reputationScores.findIndex(x => x.business_id === item.business_id)
            if (idx >= 0) {
              state.reputationScores[idx] = { ...state.reputationScores[idx], ...item }
            } else {
              state.reputationScores.push(item)
            }
          }
        } else if (table === 'reputation_score_history') {
          for (const item of arr) {
            const idx = state.reputationHistory.findIndex(x => x.business_id === item.business_id && x.snapshot_date === item.snapshot_date)
            if (idx >= 0) {
              state.reputationHistory[idx] = { ...state.reputationHistory[idx], ...item }
            } else {
              state.reputationHistory.push(item)
            }
          }
        }
        return Promise.resolve({ error: null })
      },
      then: (onfulfilled: any) => {
        let data: any = null
        let error: any = null

        if (table === 'reviews') {
          let list = [...state.reviews]
          if (eqField === 'business_id') {
            list = list.filter(r => r.business_id === eqValue)
          }
          data = list
        } else if (table === 'monitored_businesses') {
          let list = [...state.businesses]
          if (eqField === 'tenant_id') {
            list = list.filter(b => b.tenant_id === eqValue)
          }
          data = list
        } else if (table === 'tenants') {
          data = [...state.tenants]
        }

        if (isSingle && Array.isArray(data)) {
          data = data[0] || null
        }

        return Promise.resolve({ data, error }).then(onfulfilled)
      }
    }
    return query
  }

  return { state, fromFn }
})

vi.mock('../src/lib/supabase.js', () => {
  const client = {
    from: mocks.fromFn,
    rpc: vi.fn().mockResolvedValue({ data: [], error: null })
  }
  return {
    supabase: client,
    supabaseAdmin: client
  }
})

// Mocks do logger para não sujar o terminal
vi.mock('../src/lib/logger.js', () => {
  return {
    logger: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn()
    }
  }
})

import { calculateReputationScore, calculateAllScoresForTenant, runReputationScoreJob } from '../src/services/reputationScore.js'

describe('F12-E8: Reputation Score Engine', () => {
  beforeEach(() => {
    mocks.state.reviews = []
    mocks.state.reputationScores = []
    mocks.state.reputationHistory = []
    mocks.state.businesses = []
    mocks.state.tenants = []
    vi.clearAllMocks()
  })

  it('deve calcular corretamente o reputation score (0-1000) e aplicar os pesos dos componentes', async () => {
    const tenantId = 'tenant-1'
    const businessId = 'biz-1'

    // Mock de reviews do período
    mocks.state.reviews = [
      // 3 reviews positivos no Google Maps com rating 5
      { business_id: businessId, rating: 5, sentiment: 'positive', has_response: true, channel: 'google_maps', is_resolved: false, published_at: new Date().toISOString() },
      { business_id: businessId, rating: 5, sentiment: 'positive', has_response: true, channel: 'google_maps', is_resolved: false, published_at: new Date().toISOString() },
      { business_id: businessId, rating: 5, sentiment: 'positive', has_response: true, channel: 'google_maps', is_resolved: false, published_at: new Date().toISOString() },
      // 1 review no Reclame Aqui com nota e resolvido
      { business_id: businessId, rating: 4, sentiment: 'neutral', has_response: true, channel: 'reclame_aqui', is_resolved: true, published_at: new Date(Date.now() - 40 * 86400000).toISOString() },
      // 1 review no Consumidor.gov com nota e resolvido
      { business_id: businessId, rating: 4, sentiment: 'neutral', has_response: true, channel: 'consumidor_gov', is_resolved: true, published_at: new Date(Date.now() - 70 * 86400000).toISOString() }
    ]

    const result = await calculateReputationScore(businessId, tenantId)

    // O score deve ser alto dado que todos têm notas altas, sentimento positivo/neutro, taxa de resposta 100%, resolvidos no RA e Consumidor.gov
    expect(result.business_id).toBe(businessId)
    expect(result.tenant_id).toBe(tenantId)
    expect(result.score).toBeGreaterThan(500)
    expect(result.score).toBeLessThanOrEqual(1000)

    // Verificar se persistiu nos mocks
    expect(mocks.state.reputationScores.length).toBe(1)
    expect(mocks.state.reputationScores[0].score).toBe(result.score)
    expect(mocks.state.reputationHistory.length).toBe(1)
    expect(mocks.state.reputationHistory[0].score).toBe(result.score)
  })

  it('deve calcular scores para todas as unidades de um tenant', async () => {
    const tenantId = 'tenant-1'
    mocks.state.businesses = [
      { id: 'biz-1', tenant_id: tenantId, name: 'Unidade 1', is_active: true },
      { id: 'biz-2', tenant_id: tenantId, name: 'Unidade 2', is_active: true }
    ]

    mocks.state.reviews = [
      { business_id: 'biz-1', rating: 5, sentiment: 'positive', has_response: true, channel: 'google_maps', is_resolved: false, published_at: new Date().toISOString() },
      { business_id: 'biz-2', rating: 4, sentiment: 'positive', has_response: true, channel: 'google_maps', is_resolved: false, published_at: new Date().toISOString() }
    ]

    const results = await calculateAllScoresForTenant(tenantId)
    expect(results.length).toBe(2)
    expect(mocks.state.reputationScores.length).toBe(2)
  })

  it('deve rodar o job periódico para todos os tenants ativos', async () => {
    mocks.state.tenants = [
      { id: 'tenant-1', is_active: true },
      { id: 'tenant-2', is_active: true }
    ]

    mocks.state.businesses = [
      { id: 'biz-1', tenant_id: 'tenant-1', name: 'Biz 1', is_active: true },
      { id: 'biz-2', tenant_id: 'tenant-2', name: 'Biz 2', is_active: true }
    ]

    await runReputationScoreJob()
    expect(mocks.state.reputationScores.length).toBe(2)
  })
})
