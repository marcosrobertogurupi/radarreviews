import { describe, it, expect, vi, beforeEach } from 'vitest'
import axios from 'axios'

// Criar estados compartilhados usando vi.hoisted para evitar problemas de hoisting no Vitest
const mocks = vi.hoisted(() => {
  const state = {
    rules: [] as any[],
    reviews: [] as any[],
    stats: [] as any[],
    tenant: { admin_whatsapp: '5511999999999', admin_email: 'test@tenant.com' },
    insertedEvents: [] as any[],
    updatedEvents: [] as any[],
  }

  const fromFn = (table: string) => {
    let isSingle = false
    let resolveVal: any = null

    const query: any = {
      select: () => query,
      eq: () => query,
      or: () => query,
      gte: () => query,
      single: () => {
        isSingle = true
        return query
      },
      insert: (events: any) => {
        const inserted = (Array.isArray(events) ? events : [events]).map((e, index) => ({
          id: `event-${index}-${Math.random().toString(36).substring(2, 9)}`,
          ...e
        }))
        state.insertedEvents.push(...inserted)
        resolveVal = { data: inserted, error: null }
        return query
      },
      update: (updateData: any) => {
        state.updatedEvents.push(updateData)
        resolveVal = { data: [], error: null }
        return query
      },
      then: (onfulfilled: any) => {
        if (resolveVal) {
          return Promise.resolve(resolveVal).then(onfulfilled)
        }
        let resolvedValue: any = { data: [] as any[], error: null }
        if (table === 'alert_rules') {
          resolvedValue = { data: state.rules, error: null }
        } else if (table === 'reviews') {
          resolvedValue = { data: state.reviews, error: null }
        } else if (table === 'review_stats_daily') {
          resolvedValue = { data: state.stats, error: null }
        } else if (table === 'tenants') {
          resolvedValue = { data: state.tenant, error: null }
        }
        return Promise.resolve(resolvedValue).then(onfulfilled)
      }
    }

    return query
  }

  return { state, fromFn }
})

// Mock do supabase antes do import de checkAlerts
vi.mock('../src/lib/supabase.js', () => {
  const client = {
    from: mocks.fromFn,
    rpc: vi.fn().mockResolvedValue({ data: [], error: null }),
  }
  return {
    supabase: client,
    supabaseAdmin: client,
  }
})

// Mock do axios
vi.mock('axios', () => {
  return {
    default: {
      post: vi.fn().mockResolvedValue({ data: {} }),
    }
  }
})

// Agora sim podemos importar o modulo a ser testado
import { checkAlerts } from '../src/lib/alerts.js'

describe('Motor de Regras de Alertas - Reputei', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.state.rules = []
    mocks.state.reviews = []
    mocks.state.stats = []
    mocks.state.insertedEvents = []
    mocks.state.updatedEvents = []
  })

  it('deve disparar alerta rating_drop se o rating for menor ou igual ao threshold', async () => {
    mocks.state.rules = [{
      id: 'rule-1',
      tenant_id: 'tenant-1',
      business_id: 'biz-1',
      name: 'Nota baixa',
      channel: null,
      condition_type: 'rating_drop',
      threshold: 2,
      keywords: null,
      notify_email: true,
      notify_webhook: 'https://webhook.site/test',
      is_active: true
    }]

    const newReviews = [{
      tenant_id: 'tenant-1',
      business_id: 'biz-1',
      connector_id: 'conn-1',
      channel: 'google_maps' as const,
      external_id: 'ext-1',
      rating: 1,
      body: 'Péssimo atendimento',
      sentiment: 'negative' as const,
      published_at: new Date().toISOString(),
      raw_data: {}
    }]

    await checkAlerts(newReviews, 'biz-1', 'google_maps')

    expect(mocks.state.insertedEvents.length).toBe(1)
    expect(mocks.state.insertedEvents[0].rule_id).toBe('rule-1')
    expect(axios.post).toHaveBeenCalled()
    expect(mocks.state.updatedEvents.length).toBe(1)
    expect(mocks.state.updatedEvents[0].notified).toBe(true)
  })

  it('deve disparar alerta keyword se a palavra-chave configurada estiver presente no review', async () => {
    mocks.state.rules = [{
      id: 'rule-2',
      tenant_id: 'tenant-1',
      business_id: 'biz-1',
      name: 'Alerta de processo',
      channel: null,
      condition_type: 'keyword',
      threshold: null,
      keywords: ['processar', 'advogado'],
      notify_email: true,
      notify_webhook: 'https://webhook.site/test',
      is_active: true
    }]

    const newReviews = [{
      tenant_id: 'tenant-1',
      business_id: 'biz-1',
      connector_id: 'conn-1',
      channel: 'google_maps' as const,
      external_id: 'ext-2',
      body: 'Vou processar vocês na justiça',
      sentiment: 'negative' as const,
      published_at: new Date().toISOString(),
      raw_data: {}
    }]

    await checkAlerts(newReviews, 'biz-1', 'google_maps')

    expect(mocks.state.insertedEvents.length).toBe(1)
    expect(mocks.state.insertedEvents[0].rule_id).toBe('rule-2')
  })

  it('deve disparar alerta volume_spike estático quando o volume de reviews excede o limiar', async () => {
    mocks.state.rules = [{
      id: 'rule-3',
      tenant_id: 'tenant-1',
      business_id: 'biz-1',
      name: 'Pico de Volume',
      channel: null,
      condition_type: 'volume_spike',
      threshold: 5,
      keywords: null,
      notify_email: true,
      notify_webhook: 'https://webhook.site/test',
      is_active: true
    }]

    mocks.state.reviews = [
      { external_id: 'ext-old-1', sentiment: 'positive' },
      { external_id: 'ext-old-2', sentiment: 'neutral' },
      { external_id: 'ext-old-3', sentiment: 'positive' },
      { external_id: 'ext-old-4', sentiment: 'positive' },
    ]

    const newReviews = [{
      tenant_id: 'tenant-1',
      business_id: 'biz-1',
      connector_id: 'conn-1',
      channel: 'google_maps' as const,
      external_id: 'ext-new-1',
      rating: 5,
      body: 'Ok',
      sentiment: 'positive' as const,
      published_at: new Date().toISOString(),
      raw_data: {}
    }]

    await checkAlerts(newReviews, 'biz-1', 'google_maps')

    expect(mocks.state.insertedEvents.length).toBe(1)
    expect(mocks.state.insertedEvents[0].rule_id).toBe('rule-3')
  })

  it('deve disparar alerta volume_spike dinâmico (2x média histórica) quando não houver limiar configurado', async () => {
    mocks.state.rules = [{
      id: 'rule-4',
      tenant_id: 'tenant-1',
      business_id: 'biz-1',
      name: 'Pico de Volume Dinâmico',
      channel: null,
      condition_type: 'volume_spike',
      threshold: null,
      keywords: null,
      notify_email: true,
      notify_webhook: 'https://webhook.site/test',
      is_active: true
    }]

    mocks.state.stats = [
      { date: '2026-06-22', total_reviews: 2, negative_count: 0, channel: 'google_maps' },
      { date: '2026-06-23', total_reviews: 4, negative_count: 0, channel: 'google_maps' },
      { date: '2026-06-24', total_reviews: 3, negative_count: 0, channel: 'google_maps' },
    ]

    mocks.state.reviews = [
      { external_id: 'ext-old-1', sentiment: 'positive' },
      { external_id: 'ext-old-2', sentiment: 'neutral' },
      { external_id: 'ext-old-3', sentiment: 'positive' },
      { external_id: 'ext-old-4', sentiment: 'positive' },
      { external_id: 'ext-old-5', sentiment: 'positive' },
    ]

    const newReviews = [{
      tenant_id: 'tenant-1',
      business_id: 'biz-1',
      connector_id: 'conn-1',
      channel: 'google_maps' as const,
      external_id: 'ext-new-2',
      rating: 4,
      body: 'Bom',
      sentiment: 'positive' as const,
      published_at: new Date().toISOString(),
      raw_data: {}
    }]

    await checkAlerts(newReviews, 'biz-1', 'google_maps')

    expect(mocks.state.insertedEvents.length).toBe(1)
    expect(mocks.state.insertedEvents[0].rule_id).toBe('rule-4')
  })

  it('deve disparar alerta negative_surge estático quando o volume de negativos excede o limiar', async () => {
    mocks.state.rules = [{
      id: 'rule-5',
      tenant_id: 'tenant-1',
      business_id: 'biz-1',
      name: 'Surto de Negativos Estático',
      channel: null,
      condition_type: 'negative_surge',
      threshold: 3,
      keywords: null,
      notify_email: true,
      notify_webhook: 'https://webhook.site/test',
      is_active: true
    }]

    mocks.state.reviews = [
      { external_id: 'ext-old-1', sentiment: 'negative' },
      { external_id: 'ext-old-2', sentiment: 'critical' },
    ]

    const newReviews = [{
      tenant_id: 'tenant-1',
      business_id: 'biz-1',
      connector_id: 'conn-1',
      channel: 'google_maps' as const,
      external_id: 'ext-new-3',
      rating: 1,
      body: 'Terrível',
      sentiment: 'negative' as const,
      published_at: new Date().toISOString(),
      raw_data: {}
    }]

    await checkAlerts(newReviews, 'biz-1', 'google_maps')

    expect(mocks.state.insertedEvents.length).toBe(1)
    expect(mocks.state.insertedEvents[0].rule_id).toBe('rule-5')
  })

  it('deve disparar alerta negative_surge dinâmico (2x média histórica) quando não houver limiar configurado', async () => {
    mocks.state.rules = [{
      id: 'rule-6',
      tenant_id: 'tenant-1',
      business_id: 'biz-1',
      name: 'Surto de Negativos Dinâmico',
      channel: null,
      condition_type: 'negative_surge',
      threshold: null,
      keywords: null,
      notify_email: true,
      notify_webhook: 'https://webhook.site/test',
      is_active: true
    }]

    mocks.state.stats = [
      { date: '2026-06-22', total_reviews: 10, negative_count: 2, channel: 'google_maps' },
      { date: '2026-06-23', total_reviews: 10, negative_count: 1, channel: 'google_maps' },
      { date: '2026-06-24', total_reviews: 10, negative_count: 3, channel: 'google_maps' },
    ]

    mocks.state.reviews = [
      { external_id: 'ext-old-1', sentiment: 'negative' },
      { external_id: 'ext-old-2', sentiment: 'critical' },
      { external_id: 'ext-old-3', sentiment: 'negative' },
    ]

    const newReviews = [{
      tenant_id: 'tenant-1',
      business_id: 'biz-1',
      connector_id: 'conn-1',
      channel: 'google_maps' as const,
      external_id: 'ext-new-4',
      rating: 1,
      body: 'Ruim demais',
      sentiment: 'critical' as const,
      published_at: new Date().toISOString(),
      raw_data: {}
    }]

    await checkAlerts(newReviews, 'biz-1', 'google_maps')

    expect(mocks.state.insertedEvents.length).toBe(1)
    expect(mocks.state.insertedEvents[0].rule_id).toBe('rule-6')
  })

  it('não deve disparar volume_spike mais de uma vez no mesmo lote', async () => {
    mocks.state.rules = [{
      id: 'rule-8',
      tenant_id: 'tenant-1',
      business_id: 'biz-1',
      name: 'Pico de Volume Único',
      channel: null,
      condition_type: 'volume_spike',
      threshold: 2,
      keywords: null,
      notify_email: true,
      notify_webhook: 'https://webhook.site/test',
      is_active: true
    }]

    const newReviews = [
      {
        tenant_id: 'tenant-1',
        business_id: 'biz-1',
        connector_id: 'conn-1',
        channel: 'google_maps' as const,
        external_id: 'ext-vol-1',
        rating: 4,
        body: 'Legal',
        sentiment: 'positive' as const,
        published_at: new Date().toISOString(),
        raw_data: {}
      },
      {
        tenant_id: 'tenant-1',
        business_id: 'biz-1',
        connector_id: 'conn-1',
        channel: 'google_maps' as const,
        external_id: 'ext-vol-2',
        rating: 5,
        body: 'Incrível',
        sentiment: 'positive' as const,
        published_at: new Date().toISOString(),
        raw_data: {}
      }
    ]

    await checkAlerts(newReviews, 'biz-1', 'google_maps')

    expect(mocks.state.insertedEvents.length).toBe(1)
    expect(mocks.state.insertedEvents[0].rule_id).toBe('rule-8')
  })
})
