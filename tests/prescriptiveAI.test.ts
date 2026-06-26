import { describe, it, expect, vi, beforeEach } from 'vitest'

const mocks = vi.hoisted(() => {
  const state = {
    alertRules: [] as any[],
    alertEvents: [] as any[],
    businesses: [] as any[],
    tenants: [] as any[],
    reviewStatsDaily: [] as any[],
    reviews: [] as any[]
  }

  const fromFn = (table: string) => {
    let selectCols: string | null = null
    let eqField: string | null = null
    let eqValue: any = null
    let gteField: string | null = null
    let gteValue: any = null
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
      lt: () => query,
      not: () => query,
      limit: () => query,
      in: () => query,
      maybeSingle: () => {
        isSingle = true
        return query
      },
      single: () => {
        isSingle = true
        return query
      },
      insert: (data: any) => {
        const arr = Array.isArray(data) ? data : [data]
        const result = arr.map(item => ({ id: `id-${Math.random()}`, ...item }))
        if (table === 'alert_rules') {
          state.alertRules.push(...result)
        } else if (table === 'alert_events') {
          state.alertEvents.push(...result)
        }
        return {
          select: () => ({
            single: () => Promise.resolve({ data: result[0], error: null })
          }),
          then: (onfulfilled: any) => Promise.resolve({ data: result[0], error: null }).then(onfulfilled)
        }
      },
      then: (onfulfilled: any) => {
        let data: any = null
        let error: any = null

        if (table === 'monitored_businesses') {
          let list = [...state.businesses]
          if (eqField === 'tenant_id') {
            list = list.filter(b => b.tenant_id === eqValue)
          }
          data = list
        } else if (table === 'tenants') {
          data = [...state.tenants]
        } else if (table === 'review_stats_daily') {
          data = [...state.reviewStatsDaily]
        } else if (table === 'reviews') {
          data = [...state.reviews]
        } else if (table === 'alert_rules') {
          data = state.alertRules.find(r => r.tenant_id === eqValue && r.condition_type === 'prescriptive_insight') || null
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

// Mock do SDK do Gemini
const mockGenerateContent = vi.fn().mockResolvedValue({
  response: {
    text: () => JSON.stringify({
      insights: [
        {
          business_id: 'biz-1',
          business_name: 'Unidade Centro',
          category: 'atendimento',
          urgency: 'high',
          insight: 'Realizar treinamento de atendimento no Centro, pois a nota de reviews despencou no último mês.',
          metric_context: 'Queda de 0.8 estrelas na média mensal',
          confidence: 0.95
        }
      ]
    })
  }
})

vi.mock('@google/generative-ai', () => {
  return {
    GoogleGenerativeAI: vi.fn().mockImplementation(() => {
      return {
        getGenerativeModel: vi.fn().mockReturnValue({
          generateContent: mockGenerateContent
        })
      }
    })
  }
})

vi.mock('../src/lib/logger.js', () => {
  return {
    logger: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn((msg, meta) => console.error('[TEST ERROR LOG]', msg, meta))
    }
  }
})

import { runPrescriptiveAnalysisJob } from '../src/services/prescriptiveAnalysis.js'

describe('F12-E7: IA Prescritiva', () => {
  beforeEach(() => {
    process.env['GEMINI_API_KEY'] = 'mock-gemini-key'
    mocks.state.alertRules = []
    mocks.state.alertEvents = []
    mocks.state.businesses = []
    mocks.state.tenants = []
    mocks.state.reviewStatsDaily = []
    mocks.state.reviews = []
    vi.clearAllMocks()
  })

  it('deve rodar o job prescritivo com sucesso, coletar dados, chamar Gemini e criar alert_events de insight', async () => {
    const tenantId = 'tenant-1'
    mocks.state.tenants = [
      { id: tenantId, is_active: true, subscription_status: 'active' }
    ]
    mocks.state.businesses = [
      { id: 'biz-1', tenant_id: tenantId, name: 'Unidade Centro', is_active: true }
    ]
    mocks.state.reviewStatsDaily = [
      { business_id: 'biz-1', avg_rating: 4.5, total_reviews: 10, negative_count: 0, date: '2026-06-25' }
    ]
    mocks.state.reviews = [
      { business_id: 'biz-1', sentiment_topics: ['atendimento'], published_at: new Date().toISOString() }
    ]

    await runPrescriptiveAnalysisJob()

    // O job deve ter chamado a geração de insights
    expect(mockGenerateContent).toHaveBeenCalled()

    // Deve ter criado 1 regra de alerta do tipo prescriptive_insight e 1 alert_event do mesmo tipo
    expect(mocks.state.alertRules.length).toBe(1)
    expect(mocks.state.alertRules[0].condition_type).toBe('prescriptive_insight')

    expect(mocks.state.alertEvents.length).toBe(1)
    expect(mocks.state.alertEvents[0].detail.type).toBe('prescriptive_insight')
    expect(mocks.state.alertEvents[0].detail.insight).toBe('Realizar treinamento de atendimento no Centro, pois a nota de reviews despencou no último mês.')
  })
})
